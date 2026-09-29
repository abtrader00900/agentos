// Findings from two days of agentos on a real project (the Al Madina ERP), 0.2.2.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sync } from "../src/commands/sync.js";
import { doctor, trustedCodexProjects, sameCodexPath } from "../src/commands/doctor.js";
import { handoff } from "../src/commands/handoff.js";
import { loadConfig } from "../src/core/loader.js";
import { exportHandoff, writeHandoff, bundleToMarkdown, latestHandoffDir } from "../src/core/handoff.js";
import { MemoryStore } from "../src/mcp/memory/store.js";
import { generators } from "../src/generators/index.js";
import { VERSION } from "../src/version.js";
import type { AgentConfig } from "../src/core/schema.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = "@basit0090/agent-os";
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const CONFIG = `project: { name: erp }
mcpServers:
  - name: memory
    command: npx
    args: ["-y", "${PKG}", "mcp", "memory"]
`;

let dir: string;
let codexHome: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agentos-022-"));
  // never read the real ~/.codex from a test
  codexHome = path.join(dir, "no-codex-home");
  vi.stubEnv("CODEX_HOME", codexHome);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

function write(files: Record<string, string>): void {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    writeFileSync(path.join(dir, p), c);
  }
}
const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "ignore"], env: GIT_ENV, encoding: "utf8" });
function gitInit(): void {
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["commit", "-qm", "first"]);
}
const emptyCommits = (n: number) => { for (let i = 0; i < n; i++) git(["commit", "-q", "--allow-empty", "-m", `c${i}`]); };
const check = (name: string) => doctor({ cwd: dir, quiet: true }).checks.find((c) => c.name === name);
const cfg = (over: Partial<AgentConfig> = {}): AgentConfig =>
  ({ project: { name: "p" }, stack: [], rules: [], skills: [], mcpServers: [], ...over }) as AgentConfig;
const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
const noLists = { filesInProgress: [], pendingDecisions: [], openQuestions: [] };

// ------------------------------------------------ 1. generated MCP configs pin the CLI's version

describe("MCP configs pin the agentos version", () => {
  const servers = cfg({
    mcpServers: [
      { name: "memory", command: "npx", args: ["-y", PKG, "mcp", "memory"] },
      { name: "codegraph", command: "npx", args: ["-y", `${PKG}@latest`, "mcp", "codegraph"] },
      { name: "pinned", command: "npx", args: ["-y", `${PKG}@0.1.0`, "mcp", "supersearch"] },
      { name: "other", command: "npx", args: ["-y", "some-other-mcp"] },
    ],
  });
  const files: [keyof typeof generators, string][] = [
    ["claude-code", ".mcp.json"], ["codex", ".codex/config.toml"], ["cursor", ".cursor/mcp.json"], ["antigravity", ".agents/mcp_config.json"],
  ];

  // npx caches by spec: the ERP's unversioned `npx -y @basit0090/agent-os` kept running 0.2.0 after 0.2.1 shipped
  it.each(files)("%s writes %s with @<CLI version> for agentos servers and leaves others alone", (h, file) => {
    const content = generators[h].generate(servers).find((f) => f.path === file)!.content;
    expect(content.match(new RegExp(`"${PKG}@${VERSION.replace(/\./g, "\\.")}"`, "g"))).toHaveLength(2);
    expect(content).not.toContain(`"${PKG}"`);
    expect(content).not.toContain(`${PKG}@latest`);
    expect(content).toContain(`"${PKG}@0.1.0"`);
    expect(content).toContain(`"some-other-mcp"`);
  });

  it("doctor passes after sync and warns when a generated config pins another version or none", () => {
    write({ "agent.config.yaml": CONFIG });
    sync({ cwd: dir, quiet: true });
    expect(check("mcp:version")).toMatchObject({ status: "pass" });

    const mcp = path.join(dir, ".mcp.json");
    writeFileSync(mcp, readFileSync(mcp, "utf8").replace(`${PKG}@${VERSION}`, `${PKG}@0.2.0`));
    const toml = path.join(dir, ".codex/config.toml");
    writeFileSync(toml, readFileSync(toml, "utf8").replace(`${PKG}@${VERSION}`, PKG));
    const c = check("mcp:version")!;
    expect(c.status).toBe("warn");
    expect(c.detail).toContain(".mcp.json");
    expect(c.detail).toContain("0.2.0");
    expect(c.detail).toMatch(/\.codex\/config\.toml[^,]*unpinned/);
    expect(c.detail).toContain(VERSION);
    expect(c.fix).toContain("agentos sync");
  });
});

// ------------------------------------------------ 2. stale handoff

describe("stale handoff", () => {
  beforeEach(() => {
    write({ "agent.config.yaml": CONFIG, "a.ts": "x\n" });
    gitInit();
  });
  const handoffAt = (createdAt: string) => {
    const bundle = { ...exportHandoff(dir, { task: "ship invoices", ...noLists }), createdAt };
    writeHandoff(dir, bundle);
    return bundle;
  };

  it("bundle.json records the full HEAD commit", () => {
    const bundle = exportHandoff(dir, { task: "t", ...noLists });
    expect(bundle.git.head).toBe(git(["rev-parse", "HEAD"]).trim());
    writeHandoff(dir, bundle);
    expect(JSON.parse(readFileSync(path.join(latestHandoffDir(dir)!, "bundle.json"), "utf8")).git.head).toBe(bundle.git.head);
  });

  it("doctor: a fresh handoff passes, one older than 3 days warns", () => {
    handoffAt(daysAgo(1));
    expect(check("handoff")).toMatchObject({ status: "pass" });
    handoffAt(daysAgo(4));
    const c = check("handoff")!;
    expect(c.status).toBe("warn");
    expect(c.detail).toMatch(/4 days old/);
    expect(c.fix).toContain("agentos handoff --clear");
  });

  it("doctor warns once HEAD moved more than 20 commits past the handoff (limit configurable)", () => {
    handoffAt(new Date().toISOString());
    emptyCommits(20);
    expect(check("handoff")).toMatchObject({ status: "pass" });
    emptyCommits(1);
    expect(check("handoff")!.detail).toMatch(/21 commits/);
    expect(check("handoff")!.status).toBe("warn");

    write({ "agent.config.yaml": CONFIG + "staleAfter:\n  handoffCommits: 30\n" });
    expect(check("handoff")).toMatchObject({ status: "pass" });
  });

  it("an older bundle without git.head is measured from its first recent commit", () => {
    const bundle = handoffAt(new Date().toISOString());
    const file = path.join(latestHandoffDir(dir)!, "bundle.json");
    const { head: _, ...gitNoHead } = bundle.git;
    writeFileSync(file, JSON.stringify({ ...bundle, git: gitNoHead }));
    emptyCommits(21);
    expect(check("handoff")!.detail).toMatch(/21 commits/);
  });

  it("sync prints the same warning", () => {
    handoffAt(daysAgo(5));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    sync({ cwd: dir });
    const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/⚠.*handoff.*5 days old/i);
  });

  it("handoff --clear stops injecting a finished handoff; a hand-written HANDOFF.md is not deleted", () => {
    handoffAt(new Date().toISOString());
    sync({ cwd: dir, quiet: true });
    expect(readFileSync(path.join(dir, "CLAUDE.md"), "utf8")).toContain("Active Handoff");

    vi.spyOn(console, "log").mockImplementation(() => {});
    handoff({ cwd: dir, clear: true });
    expect(existsSync(path.join(dir, "HANDOFF.md"))).toBe(false);
    expect(existsSync(path.join(latestHandoffDir(dir)!, "bundle.json"))).toBe(true); // history stays
    sync({ cwd: dir, quiet: true });
    expect(readFileSync(path.join(dir, "CLAUDE.md"), "utf8")).not.toContain("Active Handoff");
    expect(check("handoff")).toBeUndefined();

    write({ "HANDOFF.md": "# our own notes\n" });
    expect(() => handoff({ cwd: dir, clear: true })).toThrow(/not written by agentos/);
    expect(existsSync(path.join(dir, "HANDOFF.md"))).toBe(true);
  });

  it("handoff --clear refuses to delete an agentos HANDOFF.md someone edited", () => {
    handoffAt(new Date().toISOString());
    const md = path.join(dir, "HANDOFF.md");
    writeFileSync(md, readFileSync(md, "utf8") + "\nOwner note: call the supplier first.\n");
    expect(() => handoff({ cwd: dir, clear: true })).toThrow(/edited/);
    expect(readFileSync(md, "utf8")).toContain("Owner note");
    // a CRLF checkout of an unedited one is not an edit
    writeHandoff(dir, exportHandoff(dir, { task: "t", ...noLists }));
    writeFileSync(md, readFileSync(md, "utf8").replace(/\n/g, "\r\n"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    handoff({ cwd: dir, clear: true });
    expect(existsSync(md)).toBe(false);
  });

  it("3.9 days old is past a 3-day limit", () => {
    handoffAt(daysAgo(3.9));
    expect(check("handoff")).toMatchObject({ status: "warn" });
  });

  it("staleAfter defaults: 3 days, 20 commits, 14 days for pinned facts", () => {
    expect(loadConfig(dir, dir).config.staleAfter).toEqual({ handoffDays: 3, handoffCommits: 20, pinnedFactDays: 14 });
  });
});

// ------------------------------------------------ 3. stale pinned memory

describe("stale pinned memory", () => {
  function seed(facts: { key: string; pinned: boolean; updated: string }[]): void {
    write({
      ".agentos/memory.json": JSON.stringify({
        facts: facts.map((f, i) => ({
          id: i + 1, topic: "security", key: f.key, value: `${f.key} value`, source: null,
          pinned: f.pinned ? 1 : 0, created_at: f.updated, updated_at: f.updated,
        })),
      }),
    });
  }

  it("the handoff memory snapshot shows each fact's last-updated date", () => {
    const s = new MemoryStore(path.join(dir, ".agentos/memory.json"));
    s.store({ topic: "security", key: "pins", value: "PINs not rotated yet", pinned: true });
    s.close();
    const today = new Date().toISOString().slice(0, 10);
    const md = bundleToMarkdown(exportHandoff(dir, { task: "t", ...noLists }));
    expect(md).toMatch(new RegExp(`\\[security/pins\\]\\*\\* 📌 PINs not rotated yet _\\(updated ${today}\\)_`));
  });

  it("doctor lists pinned facts not updated in 14 days", () => {
    write({ "agent.config.yaml": CONFIG });
    seed([
      { key: "pins-rotated", pinned: true, updated: daysAgo(20) },
      { key: "fresh", pinned: true, updated: daysAgo(2) },
      { key: "old-unpinned", pinned: false, updated: daysAgo(40) },
    ]);
    const c = check("memory:pinned")!;
    expect(c.status).toBe("warn");
    expect(c.detail).toContain("[security/pins-rotated]");
    expect(c.detail).toContain(daysAgo(20).slice(0, 10));
    expect(c.detail).not.toContain("fresh");
    expect(c.detail).not.toContain("old-unpinned");
    expect(c.fix).toContain("memory_store");

    seed([{ key: "fresh", pinned: true, updated: daysAgo(2) }]);
    expect(check("memory:pinned")).toMatchObject({ status: "pass" });
  });
});

// ------------------------------------------------ 4. handoff lists keep commas inside an item

describe("handoff list flags", () => {
  const bundle = () => JSON.parse(readFileSync(path.join(latestHandoffDir(dir)!, "bundle.json"), "utf8"));
  beforeEach(() => {
    write({ "agent.config.yaml": CONFIG });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("a question with commas stays one question; ; and newlines separate items; files still split on commas", () => {
    handoff({
      cwd: dir, task: "t",
      questions: "Should the React terminal be kept as a demo, updated, or retired?",
      decisions: "queue vs sync; PDF, or HTML, for receipts\ncost tracking",
      files: "a.ts, b.ts",
    });
    const b = bundle();
    expect(b.openQuestions).toEqual(["Should the React terminal be kept as a demo, updated, or retired?"]);
    expect(b.pendingDecisions).toEqual(["queue vs sync", "PDF, or HTML, for receipts", "cost tracking"]);
    expect(b.filesInProgress).toEqual(["a.ts", "b.ts"]);
  });

  it("the CLI accepts repeated --question / --decision / --file flags", () => {
    execFileSync(
      process.execPath,
      [
        path.join(rootDir, "node_modules/tsx/dist/cli.mjs"), path.join(rootDir, "src/cli.ts"), "handoff", "--task", "t",
        "--question", "Keep it, or retire it?", "--question", "Who owns it?",
        "--decision", "A, then B", "--decisions", "C",
        "--file", "x.ts", "--files", "y.ts,z.ts",
      ],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const b = bundle();
    expect(b.openQuestions).toEqual(["Keep it, or retire it?", "Who owns it?"]);
    expect(b.pendingDecisions).toEqual(["A, then B", "C"]);
    expect(b.filesInProgress).toEqual(["x.ts", "y.ts", "z.ts"]);
  });
});

// ------------------------------------------------ 5. Codex trust

describe("Codex project trust", () => {
  const GLOBAL = `model = "gpt-5"

[projects.'c:\\users\\basit\\documents\\other']
trust_level = "trusted"

[projects.'d:\\madina electric yasir\\al-madina-electric-erp']
trust_level = "trusted"

[projects."/home/u/proj"]
trust_level = "trusted"

[projects.'/home/u/untrusted']
trust_level = "untrusted"
`;

  it("reads trusted [projects.'<path>'] tables, literal and basic keys", () => {
    expect(trustedCodexProjects(GLOBAL)).toEqual([
      "c:\\users\\basit\\documents\\other",
      "d:\\madina electric yasir\\al-madina-electric-erp",
      "/home/u/proj",
    ]);
  });

  it("Windows paths compare case-insensitively and with either slash; POSIX paths exactly", () => {
    expect(sameCodexPath("d:\\madina electric yasir\\al-madina-electric-erp", "D:/Madina Electric yasir/al-madina-electric-erp", "win32")).toBe(true);
    expect(sameCodexPath("D:\\Madina Electric yasir\\al-madina-electric-erp\\", "d:\\madina electric yasir\\al-madina-electric-erp", "win32")).toBe(true);
    expect(sameCodexPath("d:\\madina", "d:\\madina-2", "win32")).toBe(false);
    expect(sameCodexPath("/home/u/proj", "/home/u/Proj", "linux")).toBe(false);
    expect(sameCodexPath("/home/u/proj/", "/home/u/proj", "linux")).toBe(true);
  });

  it("doctor warns about an untrusted project with instructions, never edits ~/.codex/config.toml, and passes once trusted", () => {
    write({ "agent.config.yaml": CONFIG });
    sync({ cwd: dir, quiet: true });
    mkdirSync(codexHome, { recursive: true });
    const globalToml = path.join(codexHome, "config.toml");
    writeFileSync(globalToml, GLOBAL);

    const c = check("codex:trust")!;
    expect(c.status).toBe("warn");
    expect(c.fix).toMatch(/Codex/);
    expect(c.fix).toMatch(/trust/i);
    expect(readFileSync(globalToml, "utf8")).toBe(GLOBAL);

    // Codex writes the key lower-cased on Windows
    const key = process.platform === "win32" ? dir.toLowerCase() : dir;
    writeFileSync(globalToml, GLOBAL + `\n[projects.'${key}']\ntrust_level = "trusted"\n`);
    expect(check("codex:trust")).toMatchObject({ status: "pass" });
  });

  it("no MCP servers in .codex/config.toml: no trust check", () => {
    write({ "agent.config.yaml": "project: { name: bare }\n" });
    sync({ cwd: dir, quiet: true });
    mkdirSync(codexHome, { recursive: true });
    expect(check("codex:trust")).toBeUndefined();
  });

  it("no Codex install, or no Codex target in the project: no check", () => {
    write({ "agent.config.yaml": CONFIG });
    sync({ cwd: dir, quiet: true });
    expect(check("codex:trust")).toBeUndefined(); // CODEX_HOME does not exist
    mkdirSync(codexHome, { recursive: true });
    rmSync(path.join(dir, ".codex"), { recursive: true });
    expect(check("codex:trust")).toBeUndefined();
  });
});
