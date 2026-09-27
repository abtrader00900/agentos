/**
 * AgentOS VS Code extension (Issue #2).
 * Zero API dependency: shells out to the local `agentos` CLI and
 * parses its `--json` output (FR-8.1).
 */
import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import * as path from "node:path";

let output: vscode.OutputChannel;
let statusBar: vscode.StatusBarItem;
let checkTimer: NodeJS.Timeout | undefined;

const HARNESSES = ["claude-code", "codex", "antigravity", "cursor", "windsurf"];
const PACKAGE = "@basit0090/agent-os";

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fix?: string;
}

interface SkillItem {
  name: string;
  description: string;
  installed: boolean;
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("AgentOS");
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = "agentos.doctor";
  context.subscriptions.push(output, statusBar);

  // Without an open folder there is no project: the extension host's cwd is VS Code's
  // install directory, and commands would write HANDOFF.md/.agentos/ into it.
  const inRoot = (fn: (root: string) => unknown) => () => {
    const root = workspaceRoot();
    if (!root) {
      void vscode.window.showWarningMessage("AgentOS: open a project folder first.");
      return;
    }
    return fn(root);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("agentos.sync", inRoot((root) => runCliToOutput(["sync"], root, "Sync"))),
    vscode.commands.registerCommand("agentos.doctor", inRoot((root) => showDoctor(root))),
    vscode.commands.registerCommand("agentos.status", inRoot((root) => runCliToOutput(["status"], root, "Status"))),
    vscode.commands.registerCommand("agentos.learn", inRoot((root) => runCliToOutput(["learn"], root, "Learn"))),
    vscode.commands.registerCommand("agentos.handoff", inRoot((root) => handoffWizard(root))),
    vscode.commands.registerCommand("agentos.refreshSkills", () =>
      vscode.commands.executeCommand("agentosSkills.refresh")
    ),
    vscode.commands.registerCommand("agentos.installSkill", async (item?: SkillNode) => {
      const root = workspaceRoot();
      if (!root) {
        void vscode.window.showWarningMessage("AgentOS: open a project folder first.");
        return;
      }
      if (item?.skill) return installSkill(item.skill.name, root);
      // called from command palette — pick from available skills
      const r = await runCli(["skill", "list", "--json"], root);
      if (r.code !== 0) return;
      try {
        const skills = (JSON.parse(r.stdout) as SkillItem[]).filter((sk) => !sk.installed);
        const pick = await vscode.window.showQuickPick(
          skills.map((sk) => ({ label: sk.name, description: sk.description })),
          { placeHolder: "Install which skill?" }
        );
        if (pick) await installSkill(pick.label, root);
      } catch {
        /* CLI missing */
      }
    })
  );

  // skills tree
  const provider = new SkillsProvider(workspaceRoot);
  vscode.window.registerTreeDataProvider("agentosSkills", provider);
  context.subscriptions.push(
    vscode.commands.registerCommand("agentosSkills.refresh", () => provider.refresh())
  );

  // hasConfig context key → shows the tree only in agentos projects
  syncContextKeys(workspaceRoot());
  void refreshStatusBar(workspaceRoot());

  // lightweight re-check on save (debounced)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      if (!config().get<boolean>("checkOnSave", true)) return;
      if (checkTimer) clearTimeout(checkTimer);
      checkTimer = setTimeout(() => {
        // the saved file may be a new agent.config.yaml
        syncContextKeys(workspaceRoot());
        void refreshStatusBar(workspaceRoot());
      }, 1500);
    })
  );

  // config change → CLI path may have changed
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("agentos")) {
        syncContextKeys(workspaceRoot());
        void refreshStatusBar(workspaceRoot());
        provider.refresh();
      }
    })
  );
}

export function deactivate(): void {
  if (checkTimer) clearTimeout(checkTimer);
}

// ---------- CLI resolution & running ----------

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("agentos");
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

const hasConfig = (root: string | undefined): root is string =>
  !!root && existsSync(path.join(root, "agent.config.yaml"));

interface CliInvocation {
  cmd: string;
  prefix: string[];
  env?: NodeJS.ProcessEnv;
}

/**
 * The extension host is Electron: running a script through process.execPath
 * needs ELECTRON_RUN_AS_NODE, otherwise VS Code opens a new window instead.
 */
const asNode = (script: string): CliInvocation => ({
  cmd: process.execPath,
  prefix: [script],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});

/** Resolve how to invoke the CLI. */
export function resolveCli(): CliInvocation {
  const p = config().get<string>("cliPath", "").trim();
  if (!p) {
    // Global install. On Windows the PATH entry is agentos.cmd, which spawn()
    // refuses to run without a shell — so run the script behind the shim.
    const script = globalCliScript();
    return script ? asNode(script) : { cmd: "agentos", prefix: [] };
  }

  // direct file
  if (existsSync(p) && !isDir(p)) return asNode(p);

  // repo checkout: prefer dist/cli.js, fall back to tsx
  const dist = path.join(p, "dist", "cli.js");
  if (existsSync(dist)) return asNode(dist);
  const src = path.join(p, "src", "cli.ts");
  const tsx = path.join(p, "node_modules", "tsx", "dist", "cli.mjs");
  if (existsSync(src) && existsSync(tsx)) return { ...asNode(tsx), prefix: [tsx, src] };

  // bare name → must be on PATH (on Windows, run the script behind its .cmd shim)
  const behind = globalCliScript(p);
  return behind ? asNode(behind) : { cmd: p, prefix: [] };
}

/**
 * The JS entry point behind a CLI shim on PATH (npm, pnpm and yarn global installs).
 * Windows shims are .cmd files spawn() cannot run without a shell (and a shell would
 * re-parse user text such as the handoff task), so the script they wrap is run directly.
 */
function globalCliScript(name = "agentos"): string | null {
  const exts = process.platform === "win32" ? ["", ".cmd", ".bat"] : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).map((d) => d.replace(/^"|"$/g, "")).filter(Boolean)) {
    for (const ext of exts) {
      const shim = path.join(dir, name + ext);
      if (!existsSync(shim) || isDir(shim)) continue;
      if (name === "agentos") {
        // npm on Windows: <prefix>\node_modules\<pkg>
        const sibling = path.join(dir, "node_modules", PACKAGE, "dist", "cli.js");
        if (existsSync(sibling)) return sibling;
      }
      if (/\.(cmd|bat)$/i.test(shim)) {
        // npm/pnpm/yarn .cmd shims end in: "%_prog%" "%dp0%\..\path\to\cli.js" %*
        try {
          const m = readFileSync(shim, "utf8").match(/"%~?dp0%?\\?([^"%]+?\.[cm]?js)"/i);
          if (m) {
            const target = path.resolve(dir, m[1]);
            if (existsSync(target)) return target;
          }
        } catch {
          /* unreadable shim */
        }
        continue;
      }
      try {
        // Unix: the shim is usually a symlink into lib/node_modules
        const real = realpathSync(shim);
        if (/\.[cm]?js$/.test(real)) return real;
      } catch {
        /* not a symlink */
      }
    }
  }
  return null;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function runCli(args: string[], cwd: string): Promise<CliResult> {
  const { cmd, prefix, env } = resolveCli();
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, [...prefix, ...args], { cwd, shell: false, env });
    } catch (err) {
      // spawn throws synchronously for e.g. EINVAL (a .cmd without a shell on Windows)
      resolve({ code: -1, stdout: "", stderr: String(err) });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: String(err) }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function runCliToOutput(args: string[], cwd: string, label: string): Promise<void> {
  output.show(true);
  output.appendLine(`$ agentos ${args.join(" ")}`);
  const r = await runCli(args, cwd);
  if (r.stdout) output.appendLine(r.stdout.trimEnd());
  if (r.stderr) output.appendLine(r.stderr.trimEnd());
  if (r.code !== 0) {
    output.appendLine(`(exit ${r.code} — see https://github.com/abtrader00900/agentos#quick-start)`);
    vscode.window.showWarningMessage(`AgentOS ${label} finished with warnings/errors — see Output.`);
  } else {
    vscode.window.showInformationMessage(`AgentOS: ${label} ✓`);
  }
}

// ---------- Doctor / status bar ----------

async function refreshStatusBar(cwd: string | undefined): Promise<void> {
  // only agentos projects get a status: elsewhere doctor would report "no config" as a red failure
  if (!hasConfig(cwd)) {
    statusBar.hide();
    return;
  }
  const r = await runCli(["doctor", "--json"], cwd);
  if (r.code === -1) {
    // CLI not found — stay silent (avoid nagging non-agentos workspaces)
    statusBar.hide();
    return;
  }
  try {
    const { checks } = JSON.parse(r.stdout) as { checks: DoctorCheck[] };
    const fails = checks.filter((c) => c.status === "fail").length;
    const warns = checks.filter((c) => c.status === "warn").length;
    if (fails > 0) {
      statusBar.text = `$(error) AgentOS: ${fails} fail`;
      statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    } else if (warns > 0) {
      statusBar.text = `$(warning) AgentOS: ${warns} warn`;
      statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else {
      statusBar.text = `$(check) AgentOS: ${checks.length} pass`;
      statusBar.backgroundColor = undefined;
    }
    statusBar.tooltip = checks.map((c) => `${c.status === "pass" ? "✓" : c.status === "warn" ? "⚠" : "✗"} ${c.name}: ${c.detail}`).join("\n");
    statusBar.show();
  } catch {
    statusBar.hide();
  }
}

async function showDoctor(cwd: string): Promise<void> {
  const r = await runCli(["doctor", "--json"], cwd);
  output.show(true);
  if (r.code === -1) {
    output.appendLine("agentos CLI not found.");
    output.appendLine(`Fix: set \`agentos.cliPath\` in Settings, or install globally: npm install -g ${PACKAGE}`);
    return;
  }
  try {
    const { checks } = JSON.parse(r.stdout) as { checks: DoctorCheck[] };
    for (const c of checks) {
      const icon = c.status === "pass" ? "✓" : c.status === "warn" ? "⚠" : "✗";
      output.appendLine(`${icon} ${c.name}: ${c.detail}`);
      if (c.fix) output.appendLine(`    fix → ${c.fix}`);
    }
    const fails = checks.filter((c) => c.status === "fail").length;
    if (fails) {
      const pick = await vscode.window.showWarningMessage(
        `${fails} doctor check(s) failing.`,
        "Open Output",
        "Run Sync"
      );
      if (pick === "Run Sync") void runCliToOutput(["sync"], cwd, "Sync");
      if (pick === "Open Output") output.show();
    }
  } catch {
    output.appendLine(r.stdout || r.stderr || "doctor failed");
  }
}

// ---------- Skills tree ----------

class SkillNode extends vscode.TreeItem {
  constructor(public readonly skill: SkillItem) {
    super(skill.name, vscode.TreeItemCollapsibleState.None);
    this.description = skill.installed ? "installed" : "";
    this.tooltip = skill.description;
    this.iconPath = new vscode.ThemeIcon(skill.installed ? "pass-filled" : "circle-outline");
    // the inline Install action is bound to "agentos.skill" only: reinstalling would wipe local edits
    this.contextValue = skill.installed ? "agentos.skill.installed" : "agentos.skill";
    this.command = skill.installed
      ? undefined
      : { command: "agentos.installSkill", title: "Install", arguments: [this] };
  }
}

class SkillsProvider implements vscode.TreeDataProvider<SkillNode> {
  private emitter = new vscode.EventEmitter<SkillNode | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private cwd: () => string | undefined) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(el: SkillNode): vscode.TreeItem {
    return el;
  }

  async getChildren(): Promise<SkillNode[]> {
    const root = this.cwd();
    if (!root) return [];
    const r = await runCli(["skill", "list", "--json"], root);
    if (r.code !== 0) return [];
    try {
      const skills = JSON.parse(r.stdout) as SkillItem[];
      return skills.map((s) => new SkillNode(s));
    } catch {
      return [];
    }
  }
}

async function installSkill(name: string, cwd: string): Promise<void> {
  await runCliToOutput(["skill", "install", name], cwd, `Install ${name}`);
  vscode.commands.executeCommand("agentosSkills.refresh");
}

// ---------- Handoff wizard ----------

async function handoffWizard(cwd: string): Promise<void> {
  const to = await vscode.window.showQuickPick(
    [...HARNESSES, "any"],
    { placeHolder: "Hand off to which harness?" }
  );
  if (!to) return;

  const task = await vscode.window.showInputBox({
    prompt: "What was being worked on + current state? (required)",
    placeHolder: "e.g. Invoice PDF export half-done: queue job written, blade template missing",
  });
  if (!task) return;

  const files = await vscode.window.showInputBox({
    prompt: "Files in progress (comma-separated, optional)",
    placeHolder: "app/Jobs/GenerateInvoicePdf.php, resources/views/invoices/pdf.blade.php",
  });
  const decisions = await vscode.window.showInputBox({
    prompt: "Pending decisions (comma-separated, optional)",
  });

  const args = ["handoff", "--to", to, "--task", task];
  if (files) args.push("--files", files);
  if (decisions) args.push("--decisions", decisions);
  await runCliToOutput(args, cwd, "Handoff");
}

// ---------- context keys ----------

async function syncContextKeys(cwd: string | undefined): Promise<void> {
  await vscode.commands.executeCommand("setContext", "agentos:hasConfig", hasConfig(cwd));
}
