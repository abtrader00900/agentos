// Target: this repo at a pinned commit (the 0.2.0 release). Pinned so the copy never contains bench/
// (task answers) and every run sees the same code.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url));

// a git worktree has no node_modules of its own; the main checkout's sits next to the shared .git
function nodeModules() {
  const own = path.join(repo, "node_modules");
  if (existsSync(own)) return realpathSync(own); // a junction-linked node_modules cannot be cpSync-ed
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: repo, encoding: "utf8" }).trim();
  return path.join(path.dirname(common), "node_modules");
}

/** replace one exact block (compared with LF line endings); a miss means the pinned code moved — fail loudly */
function patch(file, from, to) {
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const hit = typeof from === "string" ? text.includes(from) : from.test(text);
  if (!hit) throw new Error(`setup: block not found in ${file}`);
  writeFileSync(file, text.replace(from, to));
}

/** everything after the last `LABEL:` line, or the whole answer when the model skipped it */
const tail = (answer, label) => {
  const i = answer.toUpperCase().lastIndexOf(`${label}:`);
  return i < 0 ? answer : answer.slice(i + label.length + 1);
};

// ground truth for the impact task: TypeScript's own ts.preProcessFile over src/, not agentos's codegraph
const IMPACT_REQUIRED = [
  "src/cli.ts",
  "src/commands/handoff.ts",
  "src/core/handoff.ts",
  "src/mcp/codegraph/graph.ts",
  "src/mcp/codegraph/server.ts",
  "src/mcp/memory/server.ts",
  "src/mcp/memory/store.ts",
];
// imports graph.ts with `import type` only — listing it or not are both right
const IMPACT_OPTIONAL = ["src/mcp/codegraph/tsparser.ts"];

const LIFECYCLE = ["preinstall", "install", "postinstall", "prepare", "prepack", "build"];

export default {
  name: "agentos",
  source: { repo, ref: "db4db8b" },
  links: { node_modules: nodeModules() },

  agentos: {
    // `agentos init` template: its two default rules and three MCP servers; only name/description/stack filled in,
    // the template's Laravel skill removed (not a Laravel project)
    config: `project:
  name: agentos
  description: "Local-first, multi-harness agent operating system. One agent.config.yaml → Claude Code, Codex, Antigravity, Cursor, Windsurf."

stack:
  - typescript

rules:
  - id: run-tests-first
    text: Before marking any task done, run the project test suite and paste results.
  - id: no-guessing-deps
    text: Use the codegraph/supersearch MCP tools to verify dependencies instead of guessing imports.

mcpServers:
  - name: memory
    command: npx
    args: ["-y", "@basit0090/agent-os", "mcp", "memory"]
  - name: supersearch
    command: npx
    args: ["-y", "@basit0090/agent-os", "mcp", "supersearch"]
  - name: codegraph
    command: npx
    args: ["-y", "@basit0090/agent-os", "mcp", "codegraph"]
`,
    // facts the maintainers' memory already held before this benchmark existed
    memory: [
      { topic: "release", key: "npm-package", value: "Published to npm as @basit0090/agent-os — the name 'agentos' belongs to an unrelated placeholder package. npm publish needs 2FA (web auth).", source: "package.json" },
      { topic: "build", key: "dist-committed", value: "dist/ is committed on purpose: for a git dependency (npm install -g <git url>) npm runs a nested npm install inside the clone whenever package.json declares a preinstall, install, postinstall, prepare, prepack or build script, and under -g that nested run inherits --global/--prefix and wrecks the tree being installed. Never add those scripts (the compile script is named `compile`); rebuild and commit dist/ with every source change — CI checks that dist/ is fresh.", source: "tests/regressions.test.ts" },
      { topic: "workflow", key: "pr-only", value: "master only changes through pull requests; push a branch, open a PR, the maintainer merges.", source: "maintainer" },
      { topic: "ci", key: "matrix", value: "CI runs on Linux + Windows × Node 20/22, once without and once with ripgrep on PATH, plus packed-tarball and git-URL global-install smoke tests.", source: ".github/workflows/ci.yml" },
      { topic: "dev", key: "windows-ripgrep", value: "In Git Bash on Windows `rg` is only a shell function; node child processes get ENOENT, so supersearch silently falls back to its builtin scanner.", source: "maintainer" },
      { topic: "dev", key: "node20-tests", value: "Reproduce Node-20-only failures with: npx -y -p node@20 -- node node_modules/vitest/vitest.mjs run", source: "maintainer" },
    ],
  },

  tasks: [
    {
      // no tools needed: the token difference between the arms is agentos's fixed per-session overhead
      id: "overhead",
      prompt: "Reply with the single word OK.",
      check: ({ answer }) => ({ pass: /\bOK\b/.test(answer), detail: answer.trim().slice(0, 40) }),
    },
    {
      id: "recall",
      prompt:
        "Why does this project commit its compiled dist/ folder to git instead of building it when the package is installed? " +
        "Answer in two or three sentences, then end with one line in the form `SCRIPTS: name1, name2, ...` listing every " +
        "package.json script name that must never be added because of this.",
      check: ({ answer }) => {
        const listed = tail(answer, "SCRIPTS").toLowerCase();
        const named = LIFECYCLE.filter((s) => new RegExp(`(^|[^a-z-])${s}([^a-z-]|$)`).test(listed));
        const why = /nested|git (url|dependenc|install)|--global|-g\b/i.test(answer);
        return { pass: named.length >= LIFECYCLE.length - 1 && why, detail: { named, why } };
      },
    },
    {
      id: "impact",
      prompt:
        "If I change the exported API of src/core/jsonstore.ts, which files under src/ could break? Count files that depend on it " +
        "indirectly (through other imports) as well as direct importers. End your answer with one line in the form " +
        "`FILES: path1, path2, ...` listing every such file under src/, with paths relative to the repository root.",
      check: ({ answer }) => {
        const named = new Set([...tail(answer, "FILES").replace(/\\/g, "/").matchAll(/src\/[\w./-]+?\.ts\b/g)].map((m) => m[0]));
        const missing = IMPACT_REQUIRED.filter((f) => !named.has(f));
        const extra = [...named].filter((f) => !IMPACT_REQUIRED.includes(f) && !IMPACT_OPTIONAL.includes(f) && f !== "src/core/jsonstore.ts");
        return { pass: !missing.length && extra.length <= 1, detail: { missing, extra } };
      },
    },
    {
      id: "locate",
      prompt:
        "`agentos sync` deletes generated files it no longer produces, using the list of previously generated files. If someone " +
        "edits that list so it contains `../secret.txt` or an absolute path, what stops sync from deleting a file outside the " +
        "project? Name the function that performs that path check and the file it is defined in.",
      check: ({ answer }) => {
        const fn = /isProjectPath/.test(answer), file = /manifest\.(ts|js)\b/.test(answer);
        return { pass: fn && file, detail: { fn, file } };
      },
    },
    {
      id: "fix",
      prompt:
        "Bug report: running `agentos sync --force` a second time on a project whose CLAUDE.md was edited by hand overwrites the " +
        "existing CLAUDE.md.bak, so the backup of the original hand-written file is lost. A forced sync should never overwrite an " +
        "earlier backup: when CLAUDE.md.bak already exists, the next backup goes to CLAUDE.md.bak.1, then .bak.2, and so on. " +
        "Fix the bug and make sure the test suite still passes.",
      // re-introduce the bug 0.2.0 fixed (src and the committed dist/) and drop the regression test that names it
      setup(dir) {
        patch(path.join(dir, "src/commands/sync.ts"),
          "/** <file>.bak, or <file>.bak.1, .bak.2 … — a second forced sync must not destroy the first backup */\n" +
          "function backupPath(abs: string): string {\n" +
          "  if (!existsSync(abs + \".bak\")) return abs + \".bak\";\n" +
          "  for (let i = 1; ; i++) if (!existsSync(`${abs}.bak.${i}`)) return `${abs}.bak.${i}`;\n" +
          "}\n",
          "function backupPath(abs: string): string {\n  return abs + \".bak\";\n}\n");
        patch(path.join(dir, "dist/commands/sync.js"),
          /\/\*\* <file>\.bak, or[^\n]*\nfunction backupPath\(abs\) \{\n[\s\S]*?\n\}\n/,
          "function backupPath(abs) {\n    return abs + \".bak\";\n}\n");
        patch(path.join(dir, "tests/regressions-round2.test.ts"),
          /\n  it\("a second forced sync keeps the first \.bak instead of overwriting it"[\s\S]*?\n  \}\);\n/,
          "\n");
      },
      // hidden test back in, every test file restored to the pinned version (edits to tests don't count), full suite
      check: ({ dir, extract }) => {
        extract(["tests"]);
        const r = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run"], { cwd: dir, encoding: "utf8", timeout: 600_000 });
        const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, "");
        const summary = out.match(/Tests\s+[^\n]+/)?.[0]?.trim() ?? `vitest exit ${r.status}`;
        const failed = [...out.matchAll(/(?:FAIL|×)\s+([^\n]+)/g)].map((m) => m[1].trim()).slice(0, 5);
        return { pass: r.status === 0, detail: { summary, failed } };
      },
    },
  ],
};
