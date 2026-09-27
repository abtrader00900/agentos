# Changelog

## 0.2.1 — 2026-09-28

Follow-ups from the token benchmark (`bench/RESULTS.md`, PR #11). Run `agentos sync` to pick up the new rule text.

### Changed

- **The generated "Local Tools" note names the question each tool answers.** Why/how, conventions, commands, past decisions → `memory_recall` first; what breaks if X changes / who uses X → `codegraph_impact`; supersearch → symbol definitions, git history, blame. In the benchmark, seeded memory was never read (recall 0/3) until one sentence said when to use it (3/3). The note is emitted by every generator (Claude Code, Codex, Antigravity, Cursor, Windsurf).
- **`supersearch_text` is no longer presented as a Grep replacement** (tool description, generated note, README, skills): on the benchmark repo it cost 25 % more tokens than the built-in Grep for the same results. Plain text search stays with the harness's own Grep.
- The `agentos init` template's `no-guessing-deps` rule points at codegraph only.

## 0.2.0 — 2026-09-27

Two full audit rounds (PRs #5–#9). Every fix is pinned by a test in `tests/regressions.test.ts` or `tests/regressions-round2.test.ts`; CI now runs on Linux and Windows (Node 20/22), with and without ripgrep, and installs the package the way users do.

### Behaviour changes — read before upgrading

- **`install`/`sync` refuse to overwrite files agentos did not generate** (a hand-written `CLAUDE.md`, `AGENTS.md`, …). Move their content into `agent.config.yaml`, then use `--force`; the originals are kept as `<file>.bak` (`.bak.1`, … — never overwritten).
- **`sync`/`install` need a project `agent.config.yaml`**; the global `~/.agentos` config alone no longer turns any directory into a project.
- **Antigravity** files moved to `.agents/rules/agentos.md` + `.agents/mcp_config.json` (the old `.antigravity/` paths were never read). A full `sync` removes the old files if you did not edit them.
- **Cursor** also gets `.cursor/mcp.json`. **Windsurf** rules get `trigger: always_on` (they were manual-only); Windsurf's MCP servers still have to be added to its global `mcp_config.json`.
- **Codex** servers get `startup_timeout_sec = 120` (the first `npx -y` run downloads the package).
- Plain lists in `agent.config.local.yaml` (e.g. `stack: [vue]`) now **replace** the project's list instead of merging by position.
- Re-running `install` keeps already-installed skills (and your edits to them); installed skills no longer include their `test/` directory.
- `handoff --from` is detected from the harness's environment, and `--to/--from` must be a known harness.

### Fixed

- **Install:** `npm install -g github:abtrader00900/agentos` works (root cause: npm's nested install for git dependencies with build scripts; `dist/` is now committed). `$HOME` → `os.homedir()` (the global layer never loaded on Windows); Node 20.0–20.10 crash.
- **Data safety:** a `../` or absolute manifest entry could delete a file outside the project; re-installing a skill from its own location deleted it; `--upload-pack=`-style skill sources ran commands; `sync --only` dropped drift tracking for other harnesses; corrupt stores and read errors no longer destroy `memory.json`; a hand-written `HANDOFF.md` is backed up.
- **Shared memory:** concurrent writers (several harnesses) no longer lose facts — writes are locked and re-read; Windows rename races retried; re-storing a fact keeps its pin.
- **Windows/macOS:** CRLF checkouts are not "drift"; ripgrep no longer drops matches in CRLF files; case-exact path resolution; TOML escaping for Windows paths; VS Code extension runs the CLI behind `.cmd` shims and only shows a status in agentos projects; `~/.agentos` is not mistaken for a project root.
- **codegraph:** Python dotted/relative and `from . import mod`, Java/Kotlin packages incl. multi-module test roots, Go module packages, TS `./x.js`→`x.ts`, `.mts/.cts`, `@/` aliases, PHP group `use` and `include()`, imports that resolve after the target is added or a shadowing file removed; adding a file to a 1,500-file project: 3.6 s → 64 ms.
- **supersearch:** result caps, path format and gitignore semantics identical between ripgrep and the builtin scanner (negation, nested `.gitignore`, hidden files, globs incl. `**`, braces, backslashes); symbol search by AST node kind (no `if`/`for` "methods"; abstract classes, traits, enums, records, constructors, Python/Kotlin methods); blame of huge files; consistent dates.
- **skills/registry:** `skills[].source` installs; `skill install <name>` resolves registry entries and installs only that skill; nested and single-skill repos; redirects, timeouts and size caps for the index, no https→http downgrade.
- **doctor/status/learn/handoff:** accurate checks (missing scripts, wrong npm package, installed skills), `learn --apply` keeps comments and no longer overrides the project name, bounded handoff injection (Windsurf's 12,000-char limit).

## 0.1.0 — 2026-09-25

First release.
