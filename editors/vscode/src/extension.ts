/**
 * AgentOS VS Code extension (Issue #2).
 * Zero API dependency: shells out to the local `agentos` CLI and
 * parses its `--json` output (FR-8.1).
 */
import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import * as path from "node:path";

let output: vscode.OutputChannel;
let statusBar: vscode.StatusBarItem;
let checkTimer: NodeJS.Timeout | undefined;

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

  const cwd = () => workspaceRoot();

  context.subscriptions.push(
    vscode.commands.registerCommand("agentos.sync", () => runCliToOutput(["sync"], cwd(), "Sync")),
    vscode.commands.registerCommand("agentos.doctor", () => showDoctor(cwd())),
    vscode.commands.registerCommand("agentos.status", () => runCliToOutput(["status"], cwd(), "Status")),
    vscode.commands.registerCommand("agentos.learn", () => runCliToOutput(["learn"], cwd(), "Learn")),
    vscode.commands.registerCommand("agentos.handoff", () => handoffWizard(cwd())),
    vscode.commands.registerCommand("agentos.refreshSkills", () =>
      vscode.commands.executeCommand("agentosSkills.refresh")
    ),
    vscode.commands.registerCommand("agentos.installSkill", async (item?: SkillNode) => {
      if (item?.skill) return installSkill(item.skill.name, cwd());
      // called from command palette — pick from available skills
      const r = await runCli(["skill", "list", "--json"], cwd());
      if (r.code !== 0) return;
      try {
        const skills = (JSON.parse(r.stdout) as SkillItem[]).filter((sk) => !sk.installed);
        const pick = await vscode.window.showQuickPick(
          skills.map((sk) => ({ label: sk.name, description: sk.description })),
          { placeHolder: "Install which skill?" }
        );
        if (pick) await installSkill(pick.label, cwd());
      } catch {
        /* CLI missing */
      }
    })
  );

  // skills tree
  const provider = new SkillsProvider(cwd);
  vscode.window.registerTreeDataProvider("agentosSkills", provider);
  context.subscriptions.push(
    vscode.commands.registerCommand("agentosSkills.refresh", () => provider.refresh())
  );

  // hasConfig context key → shows the tree only in agentos projects
  syncContextKeys(cwd());
  if (vscode.workspace.workspaceFolders) {
    void refreshStatusBar(cwd());
  }

  // lightweight re-check on save (debounced)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      if (!config().get<boolean>("checkOnSave", true)) return;
      if (checkTimer) clearTimeout(checkTimer);
      checkTimer = setTimeout(() => void refreshStatusBar(cwd()), 1500);
    })
  );

  // config change → CLI path may have changed
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("agentos")) {
        syncContextKeys(cwd());
        void refreshStatusBar(cwd());
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

function workspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

/** Resolve how to invoke the CLI. Returns [command, argsPrefix]. */
export function resolveCli(): { cmd: string; prefix: string[] } {
  const p = config().get<string>("cliPath", "").trim();
  if (!p) return { cmd: "agentos", prefix: [] };

  // direct file
  if (existsSync(p) && !isDir(p)) return { cmd: process.execPath, prefix: [p] };

  // repo checkout: prefer dist/cli.js, fall back to tsx
  const dist = path.join(p, "dist", "cli.js");
  if (existsSync(dist)) return { cmd: process.execPath, prefix: [dist] };
  const src = path.join(p, "src", "cli.ts");
  if (existsSync(src)) return { cmd: "npx", prefix: ["--no-install", "tsx", src] };

  // bare name → must be on PATH
  return { cmd: p, prefix: [] };
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function runCli(args: string[], cwd: string): Promise<CliResult> {
  const { cmd, prefix } = resolveCli();
  return new Promise((resolve) => {
    const child = spawn(cmd, [...prefix, ...args], { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
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

async function refreshStatusBar(cwd: string): Promise<void> {
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
    output.appendLine("Fix: set `agentos.cliPath` in Settings, or install globally: npm install -g <path-to-agentos>.");
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
    this.contextValue = "agentos.skill";
    this.command = skill.installed
      ? undefined
      : { command: "agentos.installSkill", title: "Install", arguments: [this] };
  }
}

class SkillsProvider implements vscode.TreeDataProvider<SkillNode> {
  private emitter = new vscode.EventEmitter<SkillNode | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private cwd: () => string) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(el: SkillNode): vscode.TreeItem {
    return el;
  }

  async getChildren(): Promise<SkillNode[]> {
    const r = await runCli(["skill", "list", "--json"], this.cwd());
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
    ["claude-code", "codex", "antigravity", "any"],
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

async function syncContextKeys(cwd: string): Promise<void> {
  const has = existsSync(path.join(cwd, "agent.config.yaml"));
  await vscode.commands.executeCommand("setContext", "agentos:hasConfig", has);
}
