// Regression tests for the round-2 audit (2026-09-27): each `it` names the defect it pins.
// Every one of them fails on the code before the round-2 fixes.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { sync } from "../src/commands/sync.js";
import { install } from "../src/commands/install.js";
import { doctor } from "../src/commands/doctor.js";
import { handoff } from "../src/commands/handoff.js";
import { skillInstall } from "../src/commands/skill.js";
import { applyLearnedRules, learnFromHistory } from "../src/commands/learn.js";
import { loadConfig } from "../src/core/loader.js";
import { detectDrift, readManifest, writeManifest, hashContent } from "../src/core/manifest.js";
import { projectRoot } from "../src/core/project.js";
import { installSkillsFromDir, installSkillsFromGit, searchSkills } from "../src/core/registry.js";
import { exportHandoff, writeHandoff, importHandoff, latestHandoffDir, bundleToMarkdown } from "../src/core/handoff.js";
import { MemoryStore } from "../src/mcp/memory/store.js";
import { searchText, searchTextBuiltin } from "../src/mcp/supersearch/searcher.js";
import { searchSymbols } from "../src/mcp/supersearch/symbols.js";
import { blameFile, searchHistory } from "../src/mcp/supersearch/gitsearch.js";
import { GraphStore, resolveModule, extractImports } from "../src/mcp/codegraph/graph.js";
import { initTreeSitter, extractWithTreeSitter } from "../src/mcp/codegraph/tsparser.js";
import { createCodegraphServer } from "../src/mcp/codegraph/server.js";
import { generators } from "../src/generators/index.js";
import type { AgentConfig } from "../src/core/schema.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = "project:\n  name: r2\nstack: [typescript]\n";
const SKILL_MD = (name: string) =>
  `---\nname: ${name}\ndescription: Does a thing. Use when the thing must be done.\n---\n\n## Workflow\n\nx\n\n## Rules\n\ny\n`;
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "agentos-r2-")); });
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); });

function write(files: Record<string, string>, root = dir): void {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    writeFileSync(path.join(root, p), c);
  }
}
const git = (cwd: string, args: string[], env: NodeJS.ProcessEnv = GIT_ENV) =>
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"], env, encoding: "utf8" });
function commitAll(cwd: string, msg = "c", env?: NodeJS.ProcessEnv): void {
  git(cwd, ["add", "-A"], env);
  git(cwd, ["commit", "-qm", msg], env);
}
const cfg = (over: Partial<AgentConfig> = {}): AgentConfig =>
  ({ project: { name: "p" }, stack: [], rules: [], skills: [], mcpServers: [], ...over }) as AgentConfig;

// ---------------------------------------------------------------- drift / sync / manifest

describe("sync and drift", () => {
  it("a CRLF checkout (core.autocrlf=true) of generated files is not drift", () => {
    write({ "agent.config.yaml": CONFIG });
    sync({ cwd: dir, quiet: true });
    for (const f of readManifest(dir)!.files) {
      const abs = path.join(dir, f.path);
      writeFileSync(abs, readFileSync(abs, "utf8").replace(/\n/g, "\r\n"));
    }
    expect(detectDrift(dir).drifted).toEqual([]);
    sync({ cwd: dir, quiet: true }); // no --force needed
    expect(readdirSync(dir).some((n) => n.endsWith(".bak"))).toBe(false);
  });

  it("a manifest entry pointing outside the project is never deleted or trusted", () => {
    write({ "agent.config.yaml": CONFIG });
    sync({ cwd: dir, quiet: true });
    const outside = path.join(path.dirname(dir), `victim-${path.basename(dir)}.txt`);
    writeFileSync(outside, "precious");
    try {
      const h = hashContent("precious");
      writeManifest(dir, [...readManifest(dir)!.files,
        { path: `../${path.basename(outside)}`, generatedHash: h, writtenHash: h },
        { path: outside, generatedHash: h, writtenHash: h }]);
      sync({ cwd: dir, quiet: true });
      expect(readFileSync(outside, "utf8")).toBe("precious");
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("a malformed manifest does not crash sync, status or doctor", () => {
    write({ "agent.config.yaml": CONFIG, ".agentos/manifest.json": JSON.stringify({ files: [{ nope: 1 }, null] }) });
    expect(() => sync({ cwd: dir, quiet: true })).not.toThrow();
    writeFileSync(path.join(dir, ".agentos/manifest.json"), "[]");
    expect(() => doctor({ cwd: dir, quiet: true })).not.toThrow();
    expect(detectDrift(dir).drifted).toEqual([]);
  });

  it("a second forced sync keeps the first .bak instead of overwriting it", () => {
    write({ "agent.config.yaml": CONFIG, "CLAUDE.md": "original notes\n" });
    sync({ cwd: dir, quiet: true, force: true });
    writeFileSync(path.join(dir, "CLAUDE.md"), "second edit\n");
    sync({ cwd: dir, quiet: true, force: true });
    expect(readFileSync(path.join(dir, "CLAUDE.md.bak"), "utf8")).toBe("original notes\n");
    expect(readFileSync(path.join(dir, "CLAUDE.md.bak.1"), "utf8")).toBe("second edit\n");
  });

  it("sync/install refuse to run with only the global config (no project agent.config.yaml)", () => {
    const home = path.join(dir, "home");
    write({ "home/.agentos/agent.config.yaml": CONFIG });
    const work = path.join(dir, "not-a-project");
    mkdirSync(work);
    expect(loadConfig(work, home).hasProject).toBe(false);
    vi.spyOn(process, "cwd").mockReturnValue(work);
    // loadConfig default home is os.homedir(); drive the check through loadConfig's result instead
    expect(() => sync({ cwd: work, quiet: true })).toThrow(/agent\.config\.yaml/);
    expect(readdirSync(work)).toEqual([]);
  });

  it("the handoff injected into rule files is bounded (Windsurf reads 12,000 chars)", () => {
    write({ "agent.config.yaml": CONFIG, "HANDOFF.md": "# Agent Handoff\n\n" + "- a long line of context\n".repeat(2000) });
    sync({ cwd: dir, quiet: true });
    const windsurf = readFileSync(path.join(dir, ".windsurf/rules/agentos.md"), "utf8");
    expect(windsurf.length).toBeLessThan(12_000);
    expect(windsurf).toContain("HANDOFF.md");
  });

  it("warns that env from agent.config.local.yaml is written into shareable MCP files", () => {
    write({
      "agent.config.yaml": CONFIG,
      "agent.config.local.yaml": 'mcpServers:\n  - name: memory\n    command: npx\n    args: []\n    env: { API_KEY: "sk-secret" }\n',
    });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m: string) => { logs.push(String(m)); });
    sync({ cwd: dir });
    expect(logs.join("\n")).toMatch(/agent\.config\.local\.yaml/);
  });
});

// ---------------------------------------------------------------- loader / project root

describe("config loading", () => {
  it("a plain list in the local layer replaces the project's list (stack: [vue] means vue)", () => {
    write({ "agent.config.yaml": "project: { name: x }\nstack: [react, sqlite]\n", "agent.config.local.yaml": "stack: [vue]\n" });
    expect(loadConfig(dir, path.join(dir, "no-home")).config.stack).toEqual(["vue"]);
  });

  it("a layer that is a YAML list is rejected, not silently ignored", () => {
    write({ "agent.config.yaml": CONFIG, "agent.config.local.yaml": "- rules\n- oops\n" });
    expect(() => loadConfig(dir, path.join(dir, "no-home"))).toThrow(/mapping/);
  });

  it("the global ~/.agentos directory is not mistaken for a project root", () => {
    const home = path.join(dir, "home");
    write({ "home/.agentos/agent.config.yaml": CONFIG, "home/code/deep/x.ts": "" });
    const from = path.join(home, "code", "deep");
    const prev = process.env.AGENTOS_PROJECT;
    delete process.env.AGENTOS_PROJECT;
    try {
      expect(projectRoot(from, home)).toBe(from);
    } finally {
      if (prev !== undefined) process.env.AGENTOS_PROJECT = prev;
    }
  });

  it("AGENTOS_PROJECT is resolved, and ignored when it names no directory", () => {
    const prev = process.env.AGENTOS_PROJECT;
    try {
      process.env.AGENTOS_PROJECT = path.join(dir, "does-not-exist");
      expect(projectRoot(dir)).toBe(path.resolve(dir));
    } finally {
      if (prev === undefined) delete process.env.AGENTOS_PROJECT; else process.env.AGENTOS_PROJECT = prev;
    }
  });
});

// ---------------------------------------------------------------- skills / registry

describe("skills", () => {
  function skillRepo(skills: Record<string, string>): string {
    const repo = path.join(dir, `repo-${Object.keys(skills).length}-${readdirSync(dir).length}`);
    for (const [rel, name] of Object.entries(skills)) {
      write({ [path.posix.join(rel, "SKILL.md")]: SKILL_MD(name), [path.posix.join(rel, "test/skill.test.mjs")]: "" }, repo);
    }
    git(repo, ["init", "-q"]);
    commitAll(repo);
    return repo;
  }

  it("re-installing a skill from its own installed location does not delete it", () => {
    write({ "src/my-skill/SKILL.md": SKILL_MD("my-skill"), "src/my-skill/test/t.mjs": "" });
    installSkillsFromDir(path.join(dir, "src/my-skill"), dir);
    const installed = path.join(dir, ".agentos/skills/my-skill");
    // installed copies have no test/ dir, so validate as an installed skill would be
    writeFileSync(path.join(installed, "extra.md"), "mine");
    mkdirSync(path.join(installed, "test"), { recursive: true });
    installSkillsFromDir(installed, dir);
    expect(existsSync(path.join(installed, "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(installed, "extra.md"))).toBe(true);
  });

  it("a single-skill repo (SKILL.md at the root) installs under its frontmatter name", () => {
    const repo = path.join(dir, "solo-repo");
    write({ "SKILL.md": SKILL_MD("solo"), "test/skill.test.mjs": "" }, repo);
    git(repo, ["init", "-q"]);
    commitAll(repo);
    const project = path.join(dir, "p");
    mkdirSync(project);
    expect(installSkillsFromGit(repo, project)).toEqual(["solo"]);
    expect(existsSync(path.join(project, ".agentos/skills/solo/SKILL.md"))).toBe(true);
  });

  it("a source that looks like a git option is refused before git runs", () => {
    const marker = path.join(dir, "pwned.txt");
    expect(() => installSkillsFromGit(`--upload-pack=touch ${marker}`, dir)).toThrow(/option/);
    expect(existsSync(marker)).toBe(false);
  });

  it("a missing local path is an error, not a clone of github.com/./missing", () => {
    expect(() => installSkillsFromGit("./missing-skill", dir)).toThrow(/No such skill directory/);
  });

  it("skill install <registry name> installs that one skill, not the whole repo", async () => {
    const repo = skillRepo({ "skills/wanted": "wanted", "skills/other": "other" });
    const project = path.join(dir, "project");
    const index = path.join(dir, "index.json");
    writeFileSync(index, JSON.stringify({ version: 1, skills: [{ name: "wanted", description: "d", repo }] }));
    write({ "agent.config.yaml": CONFIG + `skillRegistry: ${JSON.stringify(index)}\n` }, project);
    await skillInstall("wanted", { cwd: project });
    expect(readdirSync(path.join(project, ".agentos/skills"))).toEqual(["wanted"]);
  });

  it("skills in dot-directories (.claude/skills/<name>) are found", () => {
    const repo = skillRepo({ ".claude/skills/dotted": "dotted" });
    const project = path.join(dir, "p2");
    mkdirSync(project);
    expect(installSkillsFromGit(repo, project)).toEqual(["dotted"]);
  });

  it("installed skills carry no test/ dir (the user's vitest would run it)", () => {
    write({ "agent.config.yaml": CONFIG + "skills:\n  - name: tdd-laravel\n" });
    install({ cwd: dir, quiet: true });
    expect(existsSync(path.join(dir, ".agentos/skills/tdd-laravel/SKILL.md"))).toBe(true);
    expect(existsSync(path.join(dir, ".agentos/skills/tdd-laravel/test"))).toBe(false);
    expect(doctor({ cwd: dir, quiet: true }).checks.find((c) => c.name === "skills:installed")?.status).toBe("pass");
  });

  it("re-running install keeps local edits to an installed skill", () => {
    write({ "agent.config.yaml": CONFIG + "skills:\n  - name: tdd-laravel\n" });
    install({ cwd: dir, quiet: true });
    const md = path.join(dir, ".agentos/skills/tdd-laravel/SKILL.md");
    writeFileSync(md, readFileSync(md, "utf8") + "\n## Team notes\n\nkeep me\n");
    install({ cwd: dir, quiet: true });
    expect(readFileSync(md, "utf8")).toContain("keep me");
  });

  it("skill search lists a skill once even when the registry mirrors the bundled set", async () => {
    write({ "agent.config.yaml": CONFIG + `skillRegistry: ${JSON.stringify(path.join(rootDir, "skills/registry.json"))}\n` });
    const hits = await searchSkills("tdd-laravel", dir);
    expect(hits.filter((h) => h.name === "tdd-laravel")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- memory

describe("memory", () => {
  it("two processes storing at once lose nothing", async () => {
    const file = path.join(dir, "memory.json");
    const script = path.join(dir, "writer.mts");
    writeFileSync(script, [
      `import { MemoryStore } from ${JSON.stringify(pathToFileURL(path.join(rootDir, "src/mcp/memory/store.ts")).href)};`,
      `const s = new MemoryStore(process.argv[2]);`,
      `for (let i = 0; i < 40; i++) s.store({ topic: process.argv[3], key: "k" + i, value: "v" });`,
    ].join("\n"));
    const run = (topic: string) => new Promise<number>((resolve) => {
      const p = spawn(process.execPath, [path.join(rootDir, "node_modules/tsx/dist/cli.mjs"), script, file, topic], { stdio: "ignore" });
      p.on("close", (code) => resolve(code ?? -1));
    });
    expect(await Promise.all([run("A"), run("B")])).toEqual([0, 0]);
    const facts = JSON.parse(readFileSync(file, "utf8")).facts as { id: number }[];
    expect(facts).toHaveLength(80);
    expect(new Set(facts.map((f) => f.id)).size).toBe(80);
    expect(readdirSync(dir).filter((n) => n.includes(".tmp") || n.endsWith(".lock"))).toEqual([]);
  }, 60_000);

  it("an I/O error reading the store is not treated as corruption", () => {
    const file = path.join(dir, "memory.json");
    mkdirSync(file); // reading a directory fails with EISDIR
    expect(() => new MemoryStore(file)).toThrow();
    expect(readdirSync(dir)).toEqual(["memory.json"]);
  });

  it("re-storing a fact without `pinned` keeps it pinned", () => {
    const s = new MemoryStore(path.join(dir, "m.json"));
    s.store({ topic: "t", key: "k", value: "v1", pinned: true, source: "src/a.ts" });
    s.store({ topic: "t", key: "k", value: "v2" });
    expect(s.get("t", "k")).toMatchObject({ value: "v2", pinned: 1, source: "src/a.ts" });
  });

  it("recall does not reorder the stored facts", () => {
    const file = path.join(dir, "m.json");
    const s = new MemoryStore(file);
    s.store({ topic: "t", key: "old", value: "1" });
    s.store({ topic: "t", key: "new", value: "2" });
    s.recall();
    s.store({ topic: "t", key: "third", value: "3" });
    expect(JSON.parse(readFileSync(file, "utf8")).facts.map((f: { key: string }) => f.key)).toEqual(["old", "new", "third"]);
  });

  it("multi-line facts stay one list item in the markdown export", () => {
    const s = new MemoryStore(path.join(dir, "m.json"));
    s.store({ topic: "t", key: "k", value: "line one\n## not a heading\n- not an item" });
    const md = s.exportMarkdown();
    expect(md).not.toMatch(/^## not a heading/m);
    expect(md).not.toMatch(/^- not an item/m);
  });

  it("doctor reports a corrupt memory.json without moving it", () => {
    write({ "agent.config.yaml": CONFIG, ".agentos/memory.json": "{broken" });
    const c = doctor({ cwd: dir, quiet: true }).checks.find((x) => x.name === "memory")!;
    expect(c.status).toBe("fail");
    expect(readFileSync(path.join(dir, ".agentos/memory.json"), "utf8")).toBe("{broken");
  });
});

// ---------------------------------------------------------------- handoff / doctor / learn

describe("handoff", () => {
  it("a hand-written HANDOFF.md is backed up before being replaced", () => {
    write({ "HANDOFF.md": "# our release checklist\n" });
    writeHandoff(dir, exportHandoff(dir, { task: "t", filesInProgress: [], pendingDecisions: [], openQuestions: [] }));
    expect(readFileSync(path.join(dir, "HANDOFF.md.bak"), "utf8")).toBe("# our release checklist\n");
  });

  it("HANDOFF.md shows pinned + recent facts and points at bundle.json for the rest", () => {
    const s = new MemoryStore(path.join(dir, ".agentos/memory.json"));
    for (let i = 0; i < 80; i++) s.store({ topic: "t", key: `k${i}`, value: "v" });
    const bundle = exportHandoff(dir, { task: "t", filesInProgress: [], pendingDecisions: [], openQuestions: [] });
    expect(bundle.memory).toHaveLength(80);
    const md = bundleToMarkdown(bundle);
    expect(md.match(/^- \*\*\[t\//gm)!.length).toBeLessThan(80);
    expect(md).toContain("bundle.json");
  });

  it("handoff:show survives a partial bundle and ignores non-bundle directories", () => {
    write({
      ".agentos/handoffs/2026-09-01T00-00-00-000Z/bundle.json": JSON.stringify({ format: "agentos-handoff", version: 1, task: "x" }),
      ".agentos/handoffs/zz-notes/readme.txt": "not a bundle",
    });
    const latest = latestHandoffDir(dir)!;
    expect(path.basename(latest)).toBe("2026-09-01T00-00-00-000Z");
    expect(() => bundleToMarkdown(importHandoff(path.join(latest, "bundle.json")))).not.toThrow();
  });

  it("an unknown --to harness is rejected", () => {
    expect(() => handoff({ cwd: dir, to: "codx", task: "t" })).toThrow(/Unknown harness/);
  });
});

describe("doctor", () => {
  it("fails an MCP server whose script does not exist", () => {
    write({ "agent.config.yaml": CONFIG + 'mcpServers:\n  - name: m\n    command: node\n    args: ["missing/server.js"]\n' });
    expect(doctor({ cwd: dir, quiet: true }).checks.find((c) => c.name === "mcp:m")?.status).toBe("fail");
  });

  it("the fix for a wrong npx package does not tell users to overwrite their config", () => {
    write({ "agent.config.yaml": CONFIG + 'mcpServers:\n  - name: m\n    command: npx\n    args: ["-y", "agentos", "mcp", "memory"]\n' });
    const c = doctor({ cwd: dir, quiet: true }).checks.find((x) => x.name === "mcp:m")!;
    expect(c.fix).not.toMatch(/init --force/);
  });

  it("a skill entry with a source is not reported 'declared but not installed' forever", () => {
    write({
      "agent.config.yaml": CONFIG + "skills:\n  - name: pack\n    source: ./vendor-skills\n",
      "vendor-skills/one/SKILL.md": SKILL_MD("one"), "vendor-skills/one/test/t.mjs": "",
    });
    install({ cwd: dir, quiet: true });
    expect(doctor({ cwd: dir, quiet: true }).checks.find((c) => c.name === "skills:installed")?.status).toBe("pass");
  });
});

describe("learn", () => {
  it("--apply keeps the comments in agent.config.local.yaml", () => {
    write({ "agent.config.local.yaml": "# my personal overrides\nstack: [vue] # temporary\n" });
    applyLearnedRules(dir, [{ id: "learned-x", text: "t", evidence: "e" }]);
    const text = readFileSync(path.join(dir, "agent.config.local.yaml"), "utf8");
    expect(text).toContain("# my personal overrides");
    expect(text).toContain("# temporary");
    expect(parseYaml(text).rules).toEqual([{ id: "learned-x", text: "t" }]);
  });

  it("non-ASCII file names come through unescaped", () => {
    git(dir, ["init", "-q"]);
    for (let i = 0; i < 5; i++) {
      write({ "src/äpfel.ts": `export const a = ${i};`, "src/birne.ts": `export const b = ${i};` });
      commitAll(dir, `c${i}`);
    }
    const text = learnFromHistory(dir).rules.map((r) => r.text).join("\n");
    expect(text).toContain("src/äpfel.ts");
  });
});

// ---------------------------------------------------------------- supersearch

describe("supersearch", () => {
  it("ripgrep path returns matches from CRLF files, `$` anchors work, text has no \\r", () => {
    write({ "a.ts": "const x = 1;\r\nfinal line\r\n" });
    const hits = searchText({ cwd: dir, pattern: "line$" });
    expect(hits).toEqual([{ file: "a.ts", line: 2, text: "final line" }]);
  });

  it("builtin scanner handles CRLF the same way", () => {
    write({ "a.ts": "const x = 1;\r\nfinal line\r\n" });
    expect(searchTextBuiltin({ cwd: dir, pattern: "line$" })).toEqual([{ file: "a.ts", line: 2, text: "final line" }]);
  });

  it("a single huge matching line is truncated", () => {
    write({ "min.js": "needle" + "x".repeat(20_000) });
    expect(searchText({ cwd: dir, pattern: "needle" })[0].text.length).toBeLessThanOrEqual(500);
  });

  it("a glob written with backslashes works", () => {
    write({ "src/a/x.ts": "needle", "other/y.ts": "needle" });
    expect(searchText({ cwd: dir, pattern: "needle", glob: "src\\**" }).map((m) => m.file)).toEqual(["src/a/x.ts"]);
    expect(searchTextBuiltin({ cwd: dir, pattern: "needle", glob: "src\\**" }).map((m) => m.file)).toEqual(["src/a/x.ts"]);
  });

  it("builtin: gitignore negation, nested .gitignore, hidden files and brace globs match ripgrep", () => {
    write({
      ".gitignore": "*.log\n!keep.log\n",
      "a.log": "needle", "keep.log": "needle",
      "sub/.gitignore": "secret.ts\n", "sub/secret.ts": "needle", "sub/open.ts": "needle",
      ".hidden.ts": "needle", "c.tsx": "needle",
    });
    const sorted = (xs: { file: string }[]) => xs.map((m) => m.file).sort();
    expect(sorted(searchTextBuiltin({ cwd: dir, pattern: "needle" }))).toEqual(["c.tsx", "keep.log", "sub/open.ts"]);
    expect(sorted(searchText({ cwd: dir, pattern: "needle" }))).toEqual(["c.tsx", "keep.log", "sub/open.ts"]);
    expect(sorted(searchTextBuiltin({ cwd: dir, pattern: "needle", glob: "*.{ts,tsx}" }))).toEqual(["c.tsx", "sub/open.ts"]);
  });

  it("symbol search: abstract classes, Python methods, PHP traits/enums, Java enums/records/constructors", () => {
    write({
      "a.ts": "export abstract class Base { abstract run(): void; }\n",
      "b.py": "def top():\n    pass\nclass Thing:\n    def meth(self):\n        pass\n",
      "c.php": "<?php\ntrait Greets { }\nenum Suit { case Hearts; }\n",
      "D.java": "enum Color { RED }\nrecord Point(int x) {}\nclass J { J() {} }\n",
    });
    const got = searchSymbols({ cwd: dir }).map((m) => `${m.kind}:${m.name}`);
    expect(got).toEqual(expect.arrayContaining([
      "class:Base", "function:top", "method:meth", "class:Thing", "class:Greets", "class:Suit",
      "class:Color", "class:Point", "method:J",
    ]));
    expect(got).not.toContain("function:meth");
  });

  it("symbol search `file` accepts ./x, x\\y and absolute paths", () => {
    write({ "src/a.ts": "export function foo() {}\n", "src/b.ts": "export function bar() {}\n" });
    for (const f of ["./src/a.ts", "src\\a.ts", path.join(dir, "src", "a.ts")]) {
      expect(searchSymbols({ cwd: dir, file: f }).map((m) => m.name)).toEqual(["foo"]);
    }
  });

  it("blame asks git for only the requested lines of a huge file", () => {
    git(dir, ["init", "-q"]);
    write({ "big.txt": Array.from({ length: 60_000 }, (_, i) => `line ${i}`).join("\n") + "\n" });
    commitAll(dir);
    const t = Date.now();
    const lines = blameFile(dir, "big.txt", 5);
    expect(lines.map((l) => l.line)).toEqual([1, 2, 3, 4, 5]);
    expect(Date.now() - t).toBeLessThan(5_000);
  }, 60_000);

  it("blame and history agree on a commit's date (the author's own calendar day)", () => {
    git(dir, ["init", "-q"]);
    write({ "a.ts": "export const marker = 1;\n" });
    const env = { ...GIT_ENV, GIT_AUTHOR_DATE: "2026-01-02T02:00:00+05:00", GIT_COMMITTER_DATE: "2026-01-02T02:00:00+05:00" };
    commitAll(dir, "c", env);
    expect(searchHistory(dir, "marker")[0].date).toBe("2026-01-02");
    expect(blameFile(dir, "a.ts")[0].date).toBe("2026-01-02");
  });
});

// ---------------------------------------------------------------- codegraph

describe("codegraph", () => {
  it("Go: module-path and relative imports link to the package's files", () => {
    write({
      "go.mod": "module github.com/acme/app\n\ngo 1.22\n",
      "main.go": 'package main\nimport "github.com/acme/app/internal/pkg"\n',
      "internal/pkg/a.go": "package pkg\n", "internal/pkg/b.go": "package pkg\n", "internal/pkg/a_test.go": "package pkg\n",
    });
    const store = new GraphStore(path.join(dir, ".agentos/graph.json"));
    store.update(dir);
    expect(store.dependencies("main.go")).toEqual(["internal/pkg/a.go", "internal/pkg/b.go"]);
    write({ "internal/pkg/c.go": "package pkg\n" });
    store.update(dir);
    expect(store.dependencies("main.go")).toContain("internal/pkg/c.go");
  });

  it("Python: `from . import mod` links to the module; a symbol falls back to the package", () => {
    write({ "app/__init__.py": "", "app/models.py": "", "app/views.py": "from . import models\nfrom .models import User\n" });
    expect(resolveModule(dir, "app/views.py", ".models")).toBe("app/models.py");
    expect(resolveModule(dir, "app/views.py", ".helper_func")).toBe("app/__init__.py");
    expect(extractImports("app/views.py", "from . import models, views as v\n").map((r) => r.specifier)).toEqual([".models", ".views"]);
  });

  it("Java: a test source imports main sources of its own Gradle module", () => {
    write({ "core/src/main/java/com/x/Svc.java": "", "core/src/test/java/com/x/SvcTest.java": "" });
    expect(resolveModule(dir, "core/src/test/java/com/x/SvcTest.java", "com.x.Svc")).toBe("core/src/main/java/com/x/Svc.java");
  });

  it("TS: .mts files are scanned; ./x.jsx resolves to x.tsx", () => {
    write({ "src/a.mts": 'import "./b.jsx";\n', "src/b.tsx": "" });
    const store = new GraphStore(path.join(dir, ".agentos/graph.json"));
    store.update(dir);
    expect(store.dependencies("src/a.mts")).toEqual(["src/b.tsx"]);
  });

  it("Laravel's storage/ and bootstrap/ are skipped only at the root", () => {
    write({ "storage/x.php": "", "src/storage/y.ts": "" });
    const store = new GraphStore(path.join(dir, ".agentos/graph.json"));
    expect(store.update(dir).scanned).toBe(1);
  });

  it("removing a file re-links imports it was shadowing (b.ts gone, b/index.ts left)", () => {
    write({ "src/a.ts": 'import "./b";\n', "src/b.ts": "", "src/b/index.ts": "" });
    const store = new GraphStore(path.join(dir, ".agentos/graph.json"));
    store.update(dir);
    expect(store.dependencies("src/a.ts")).toEqual(["src/b.ts"]);
    rmSync(path.join(dir, "src/b.ts"));
    store.update(dir);
    expect(store.dependencies("src/a.ts")).toEqual(["src/b/index.ts"]);
  });

  it("tree-sitter: PHP group use + include(), TS import=require, no junk from export default", async () => {
    await initTreeSitter();
    const php = extractWithTreeSitter("x.php", '<?php\nuse App\\Models\\{User, Post as P};\ninclude("tpl/h.php");\n')!.map((r) => r.specifier);
    expect(php).toEqual(expect.arrayContaining(["App\\Models\\User", "App\\Models\\Post", "tpl/h.php"]));
    const ts = extractWithTreeSitter("x.ts", 'import x = require("./y");\nexport default "literal";\n')!.map((r) => r.specifier);
    expect(ts).toEqual(["./y"]);
  });

  it("codegraph tools accept absolute paths", async () => {
    write({ "src/a.ts": 'import "./b";\n', "src/b.ts": "" });
    const server = createCodegraphServer(dir);
    const [c, s] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([client.connect(c), server.connect(s)]);
    const res = await client.callTool({ name: "codegraph_deps", arguments: { file: path.join(dir, "src", "a.ts") } });
    expect((res.content as { text: string }[])[0].text).toBe("src/b.ts");
    await client.close();
  });
});

// ---------------------------------------------------------------- generators

describe("generators", () => {
  const withServers = cfg({ project: { name: "my: app" }, mcpServers: [{ name: "memory", command: "npx", args: ["-y", "@basit0090/agent-os", "mcp", "memory"] }] });
  const gen = (h: keyof typeof generators, c: AgentConfig) => Object.fromEntries(generators[h].generate(c).map((f) => [f.path, f.content]));
  const frontmatter = (s: string) => parseYaml(s.split("---")[1]) as Record<string, unknown>;

  it("Cursor gets a .cursor/mcp.json for the servers its rule advertises", () => {
    const files = gen("cursor", withServers);
    expect(JSON.parse(files[".cursor/mcp.json"]).mcpServers.memory.command).toBe("npx");
  });

  it("frontmatter survives a project name containing ': '", () => {
    expect(frontmatter(gen("cursor", withServers)[".cursor/rules/agentos.mdc"]).description).toContain("my: app");
    expect(frontmatter(gen("windsurf", withServers)[".windsurf/rules/agentos.md"]).trigger).toBe("always_on");
    expect(frontmatter(gen("antigravity", withServers)[".agents/rules/agentos.md"]).description).toContain("my: app");
  });

  it("the tools section lists only configured servers; Windsurf says where to register them", () => {
    const md = gen("claude-code", withServers)["CLAUDE.md"];
    expect(md).toContain("`memory`");
    expect(md).not.toContain("`codegraph`");
    expect(gen("windsurf", withServers)[".windsurf/rules/agentos.md"]).toContain("mcp_config.json");
  });

  it("Codex gets a startup timeout long enough for an npx cold start", () => {
    expect(gen("codex", withServers)[".codex/config.toml"]).toMatch(/startup_timeout_sec = \d{2,}/);
  });
});
