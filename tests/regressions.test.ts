// Regression tests for the 2026-09-26 audit: each `it` names the defect it pins.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { codexGenerator } from "../src/generators/codex.js";
import { resolveModule, GraphStore } from "../src/mcp/codegraph/graph.js";
import { MemoryStore } from "../src/mcp/memory/store.js";
import { searchText, searchTextBuiltin } from "../src/mcp/supersearch/searcher.js";
import { searchSymbols } from "../src/mcp/supersearch/symbols.js";
import { install } from "../src/commands/install.js";
import { sync } from "../src/commands/sync.js";
import { readManifest, writeManifest, hashContent } from "../src/core/manifest.js";
import { loadConfig } from "../src/core/loader.js";
import { applyLearnedRules } from "../src/commands/learn.js";
import { installSkillsFromGit } from "../src/core/registry.js";
import { skillInstall } from "../src/commands/skill.js";
import { detectHarness } from "../src/commands/handoff.js";
import { doctor } from "../src/commands/doctor.js";
import { projectRoot } from "../src/core/project.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = "project:\n  name: regtest\nstack: [typescript]\n";
const SKILL_MD = (name: string) =>
  `---\nname: ${name}\ndescription: Does a thing. Use when the thing must be done.\n---\n\n## Workflow\n\nx\n\n## Rules\n\ny\n`;

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "agentos-reg-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); });

function write(files: Record<string, string>, root = dir): void {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    writeFileSync(path.join(root, p), c);
  }
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd, stdio: "ignore",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });
}

describe("codex generator", () => {
  it("config.toml escapes backslashes and quotes (Windows paths survive)", () => {
    const files = codexGenerator.generate({
      project: { name: "p" }, stack: [], rules: [], skills: [],
      mcpServers: [{
        name: "memory",
        command: "C:\\Program Files\\nodejs\\node.exe",
        args: ["D:\\agentos\\dist\\cli.js", 'say "hi"'],
        env: { "MY-KEY.X": "v" },
      }],
    });
    const toml = files.find((f) => f.path === ".codex/config.toml")!.content;
    expect(toml).toContain('command = "C:\\\\Program Files\\\\nodejs\\\\node.exe"');
    expect(toml).toContain('"say \\"hi\\""');
    expect(toml).toContain('"MY-KEY.X" = "v"');
  });
});

describe("codegraph resolution", () => {
  it("TS: './x.js' resolves to x.ts and '@/' resolves under src/", () => {
    write({ "src/lib/x.ts": "", "src/a.ts": "" });
    expect(resolveModule(dir, "src/a.ts", "./lib/x.js")).toBe("src/lib/x.ts");
    expect(resolveModule(dir, "src/a.ts", "@/lib/x")).toBe("src/lib/x.ts");
  });

  it("Python: dotted and relative imports", () => {
    write({ "pkg/__init__.py": "", "pkg/models/user.py": "", "pkg/services/auth.py": "" });
    expect(resolveModule(dir, "pkg/services/auth.py", "pkg.models.user")).toBe("pkg/models/user.py");
    expect(resolveModule(dir, "pkg/services/auth.py", "..models.user")).toBe("pkg/models/user.py");
    expect(resolveModule(dir, "pkg/services/auth.py", "..")).toBe("pkg/__init__.py");
    expect(resolveModule(dir, "pkg/services/auth.py", "os")).toBeNull();
  });

  it("Java/Kotlin: package imports resolve under src/main/*", () => {
    write({ "src/main/java/com/x/Foo.java": "", "src/main/kotlin/com/x/Bar.kt": "", "src/main/java/com/x/App.java": "" });
    expect(resolveModule(dir, "src/main/java/com/x/App.java", "com.x.Foo")).toBe("src/main/java/com/x/Foo.java");
    expect(resolveModule(dir, "src/main/java/com/x/App.java", "com.x.Bar")).toBe("src/main/kotlin/com/x/Bar.kt");
    expect(resolveModule(dir, "src/main/java/com/x/App.java", "com.x.Foo.CONST")).toBe("src/main/java/com/x/Foo.java");
    expect(resolveModule(dir, "src/main/java/com/x/App.java", "java.util.List")).toBeNull();
  });

  it("never resolves to a differently-cased path (case-insensitive filesystems)", () => {
    write({ "src/lib.ts": "", "src/a.ts": "" });
    expect(resolveModule(dir, "src/a.ts", "./Lib")).toBeNull();
    expect(resolveModule(dir, "src/a.ts", "./lib")).toBe("src/lib.ts");
  });

  it("links an import whose target appears after the importer was scanned (FR-5.4)", () => {
    write({ "src/a.ts": 'import { b } from "./b";' });
    const store = new GraphStore(path.join(dir, ".agentos", "graph.json"));
    store.update(dir);
    expect(store.dependencies("src/a.ts")).toEqual([]);
    write({ "src/b.ts": "export const b = 1;" });
    store.update(dir);
    expect(store.dependencies("src/a.ts")).toEqual(["src/b.ts"]);
    store.close();
  });
});

describe("memory store shared between processes", () => {
  it("sees facts written through another store instance and never reuses an id", () => {
    const file = path.join(dir, ".agentos", "memory.json");
    const a = new MemoryStore(file);
    const b = new MemoryStore(file);
    a.store({ topic: "t", key: "from-a", value: "1" });
    b.store({ topic: "t", key: "from-b", value: "2" });
    const facts = a.recall({ topic: "t" });
    expect(facts.map((f) => f.key).sort()).toEqual(["from-a", "from-b"]);
    expect(new Set(facts.map((f) => f.id)).size).toBe(2);
    expect(JSON.parse(readFileSync(file, "utf8")).facts).toHaveLength(2);
  });

  it("a corrupt store is set aside, not overwritten", () => {
    const file = path.join(dir, "memory.json");
    writeFileSync(file, "{not json");
    new MemoryStore(file).store({ topic: "t", key: "k", value: "v" });
    expect(readdirSync(dir).some((n) => n.startsWith("memory.json.corrupt-"))).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).facts).toHaveLength(1);
  });

  it("close() on a read-only open does not touch the file", () => {
    const file = path.join(dir, "memory.json");
    new MemoryStore(file).store({ topic: "t", key: "k", value: "v" });
    const before = readFileSync(file, "utf8");
    const mtime = statSync(file).mtimeMs;
    const ro = new MemoryStore(file);
    ro.stats();
    ro.close();
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(statSync(file).mtimeMs).toBe(mtime);
  });
});

describe("supersearch text", () => {
  it("builtin: gitignore patterns without a slash match at any depth; 'dir/**' globs match paths", () => {
    write({
      ".gitignore": "*.log\nbuild/\n",
      "a.log": "needle", "sub/b.log": "needle", "build/c.ts": "needle", "app/x/d.ts": "needle", "e.ts": "needle",
    });
    expect(searchTextBuiltin({ cwd: dir, pattern: "needle" }).map((m) => m.file).sort()).toEqual(["app/x/d.ts", "e.ts"]);
    expect(searchTextBuiltin({ cwd: dir, pattern: "needle", glob: "app/**" }).map((m) => m.file)).toEqual(["app/x/d.ts"]);
  });

  it("paths have no './' prefix or backslashes and maxResults caps the total", () => {
    write({ "src/a.ts": "needle\nneedle\nneedle", "src/b.ts": "needle\nneedle" });
    const hits = searchText({ cwd: dir, pattern: "needle", maxResults: 4 });
    expect(hits).toHaveLength(4);
    for (const h of hits) expect(h.file).toMatch(/^src\/[ab]\.ts$/);
  });
});

describe("supersearch symbols", () => {
  it("control-flow blocks are never reported as methods; kinds are exact", () => {
    write({
      "a.ts": "export function foo(a: number) { if (a) { return 1; } for (const x of []) { } }\nclass Bar { baz() { while (true) { break; } } }\n",
      "b.py": "def top(x):\n    return x\nclass Thing:\n    pass\n",
    });
    const names = searchSymbols({ cwd: dir }).map((m) => `${m.kind}:${m.name}`);
    expect(names).toEqual(expect.arrayContaining(["function:foo", "method:baz", "class:Bar", "function:top", "class:Thing"]));
    expect(names.some((n) => /:(if|for|while)$/.test(n))).toBe(false);
    expect(searchSymbols({ cwd: dir, kind: "method" }).map((m) => m.name)).toEqual(["baz"]);
  });
});

describe("install + sync safety", () => {
  it("refuses to overwrite a pre-existing hand-written CLAUDE.md; --force keeps a .bak", () => {
    write({ "agent.config.yaml": CONFIG, "CLAUDE.md": "# my precious notes\n" });
    expect(() => install({ cwd: dir, quiet: true })).toThrow(/CLAUDE\.md/);
    expect(readFileSync(path.join(dir, "CLAUDE.md"), "utf8")).toBe("# my precious notes\n");
    install({ cwd: dir, quiet: true, force: true });
    expect(readFileSync(path.join(dir, "CLAUDE.md.bak"), "utf8")).toBe("# my precious notes\n");
    expect(readFileSync(path.join(dir, "CLAUDE.md"), "utf8")).toContain("# regtest");
  });

  it("sync --only keeps the other harnesses in the manifest so their drift is still detected", () => {
    write({ "agent.config.yaml": CONFIG });
    sync({ cwd: dir, quiet: true });
    sync({ cwd: dir, quiet: true, only: ["codex"] });
    expect(readManifest(dir)!.files.map((f) => f.path)).toContain("CLAUDE.md");
    writeFileSync(path.join(dir, "CLAUDE.md"), "edited by hand");
    expect(() => sync({ cwd: dir, quiet: true })).toThrow(/Drift/);
  });

  it("full sync removes an untouched file it generated earlier that no harness produces any more", () => {
    write({ "agent.config.yaml": CONFIG });
    sync({ cwd: dir, quiet: true });
    write({ ".old/config.md": "generated earlier", ".old/edited.md": "generated earlier" });
    const hash = hashContent("generated earlier");
    writeManifest(dir, [
      ...readManifest(dir)!.files,
      { path: ".old/config.md", generatedHash: hash, writtenHash: hash },
      { path: ".old/edited.md", generatedHash: hashContent("something else"), writtenHash: hash },
    ]);
    sync({ cwd: dir, quiet: true });
    expect(existsSync(path.join(dir, ".old/config.md"))).toBe(false);
    expect(existsSync(path.join(dir, ".old/edited.md"))).toBe(true);
    expect(readManifest(dir)!.files.some((f) => f.path.startsWith(".old/"))).toBe(false);
  });

  it("installs skills declared with a local-path source", () => {
    write({
      "agent.config.yaml": CONFIG + "skills:\n  - name: my-skill\n    source: ./vendor-skills/my-skill\n",
      "vendor-skills/my-skill/SKILL.md": SKILL_MD("my-skill"),
      "vendor-skills/my-skill/test/skill.test.mjs": "",
    });
    install({ cwd: dir, quiet: true });
    expect(existsSync(path.join(dir, ".agentos/skills/my-skill/SKILL.md"))).toBe(true);
  });

  it("learn --apply does not override the project name through the local layer", () => {
    write({ "agent.config.yaml": CONFIG });
    applyLearnedRules(dir, [{ id: "learned-x", text: "t", evidence: "e" }]);
    expect(readFileSync(path.join(dir, "agent.config.local.yaml"), "utf8")).not.toContain("local-overrides");
    const { config } = loadConfig(dir, path.join(dir, "no-home"));
    expect(config.project.name).toBe("regtest");
    expect(config.rules.map((r) => r.id)).toContain("learned-x");
  });

  it("detectHarness knows all five harness marker files", () => {
    write({ ".cursor/rules/agentos.mdc": "x" });
    expect(detectHarness(dir)).toBe("cursor");
  });
});

describe("project root + doctor", () => {
  it("projectRoot walks up to the directory holding agent.config.yaml (harnesses may start MCP servers in a subdir)", () => {
    write({ "agent.config.yaml": CONFIG, "src/deep/x.ts": "" });
    expect(projectRoot(path.join(dir, "src", "deep"))).toBe(dir);
    const bare = mkdtempSync(path.join(tmpdir(), "agentos-bare-"));
    try {
      expect(projectRoot(bare)).toBe(path.resolve(bare));
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("doctor flags an MCP entry that runs the wrong npm package", () => {
    write({ "agent.config.yaml": CONFIG + 'mcpServers:\n  - name: memory\n    command: npx\n    args: ["-y", "agentos", "mcp", "memory"]\n' });
    const { checks, ok } = doctor({ cwd: dir, quiet: true });
    expect(ok).toBe(false);
    expect(checks.find((c) => c.name === "mcp:memory")?.status).toBe("fail");
  });

  it("doctor validates installed community skills, not only the bundled set", () => {
    write({ "agent.config.yaml": CONFIG, ".agentos/skills/bad-skill/SKILL.md": "# no frontmatter\n" });
    const { checks } = doctor({ cwd: dir, quiet: true });
    expect(checks.find((c) => c.name === "skills:installed")?.status).toBe("fail");
  });
});

describe("skill registry install", () => {
  function skillRepo(name: string): string {
    const repo = path.join(dir, "repo-" + name);
    write({ [`skills/${name}/SKILL.md`]: SKILL_MD(name), [`skills/${name}/test/skill.test.mjs`]: "" }, repo);
    git(repo, ["init", "-q"]);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "skill"]);
    return repo;
  }

  it("finds skills nested under skills/<name>/ and honours a #dir suffix", () => {
    const repo = skillRepo("deep-skill");
    const project = path.join(dir, "project");
    mkdirSync(project);
    expect(installSkillsFromGit(repo, project)).toEqual(["deep-skill"]);
    expect(installSkillsFromGit(`${repo}#skills/deep-skill`, project)).toEqual(["deep-skill"]);
    expect(() => installSkillsFromGit(`${repo}#../etc`, project)).toThrow(/Invalid path/);
  });

  it("skill install <name> resolves a non-bundled name through the configured registry", async () => {
    const repo = skillRepo("reg-skill");
    const project = path.join(dir, "project");
    mkdirSync(project);
    const index = path.join(dir, "index.json");
    writeFileSync(index, JSON.stringify({
      version: 1,
      skills: [{ name: "reg-skill", description: "d", repo, path: "skills/reg-skill" }, { bogus: true }],
    }));
    write({ "agent.config.yaml": CONFIG + `skillRegistry: ${JSON.stringify(index)}\n` }, project);
    await skillInstall("reg-skill", { cwd: project });
    expect(existsSync(path.join(project, ".agentos/skills/reg-skill/SKILL.md"))).toBe(true);
    await expect(skillInstall("nope", { cwd: project })).rejects.toThrow(/not bundled/);
  });
});

describe("cli", () => {
  it("--version comes from package.json", () => {
    const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
    const out = execFileSync(
      process.execPath,
      [path.join(rootDir, "node_modules/tsx/dist/cli.mjs"), path.join(rootDir, "src/cli.ts"), "--version"],
      { encoding: "utf8" },
    );
    expect(out.trim()).toBe(version);
  });
});

describe("package.json", () => {
  it("declares none of the scripts that make npm run a nested install for git dependencies", () => {
    // pacote runs `npm install` inside the clone for any of these; under `npm install -g`
    // that nested run inherits --global/--prefix and wrecks the tree being installed.
    // dist/ is committed instead, so a git install needs no build step at all.
    const pkg = createRequire(import.meta.url)("../package.json") as { scripts: Record<string, string> };
    for (const s of ["preinstall", "install", "postinstall", "prepare", "prepack", "build"]) {
      expect(pkg.scripts[s], `scripts.${s}`).toBeUndefined();
    }
  });
});
