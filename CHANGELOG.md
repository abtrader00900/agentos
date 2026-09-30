# Changelog

## Unreleased (0.3.0)

### Added
- `agentos run "<task>"`: a planner splits the task, and Claude Code / Codex workers run in parallel git worktrees. Each finished subtask merges into a run branch. Verify commands run, a different model reviews the diff, and a fixer loops until both pass (up to `maxFixRounds`). A pull request opens at the end.
- `agentos runs`, plus `agentos run --resume | --cancel | --status <id>`. A run pauses on a rate limit instead of failing, and resumes where it stopped.
- An `orchestrator` MCP server (`run_task`, `run_status`, `run_cancel`) so a chat can hand work to agentos.
- Safety:
  - agents work only in worktrees (writes to your checkout stop the run)
  - the default branch is never pushed
  - there are no skip-permission flags
  - a secret scan runs before every push
  - secret-looking env values are redacted from logs
- `orchestrator.models: { claude?, codex? }` overrides a CLI's own default model for this project (passed as `--model` / `-m`).

### Fixed (found in the first real e2e)
- A run failed at push when `origin` has a relative URL (`../origin.git`): push and `gh pr create` ran inside the run worktree, where the relative path resolves elsewhere. They now run from the checkout.

## 0.2.2 — 2026-09-29

Fixes from two days of agentos on a real project. Every fix is pinned by a test in `tests/regressions-0.2.2.test.ts`.

**Upgrade:** install the new CLI (`npm install -g @basit0090/agent-os@latest`, or `npx -y @basit0090/agent-os@latest sync`), then run `agentos sync` in each project and restart the harness.

### Fixed

- **Generated MCP configs ran a stale agentos forever.** `sync` wrote `npx -y @basit0090/agent-os …` with no version; npx caches that spec (as `@latest`) and kept starting the version it fetched first — a project's memory server still reported 0.2.0 after 0.2.1 shipped, so the `memory_recall` fix never reached it. Every generator (Claude Code `.mcp.json`, Codex `.codex/config.toml`, Cursor, Antigravity) now writes `@basit0090/agent-os@<version of the CLI running sync>`. Other servers, and a version you wrote yourself in `agent.config.yaml`, are left as they are. `doctor` warns (`mcp:version`) when a generated config runs another version or none.
- **A finished handoff kept steering every new chat.** `doctor` and `sync` warn when the active `HANDOFF.md` is older than 3 days or HEAD moved more than 20 commits past the commit it was written at (the old check was file mtime > 24 h, which a checkout resets). `bundle.json` now records that commit (`git.head`); older bundles are measured from their first recent commit. New `agentos handoff --clear` removes `HANDOFF.md` (the bundle stays in `.agentos/handoffs/`) so the next `sync` stops injecting it — it refuses when `HANDOFF.md` was edited after agentos wrote it, so added notes are never lost.
- **Pinned memory went stale unnoticed.** The handoff memory snapshot shows each fact's last-updated date (`_(updated 2026-09-27)_`), and `doctor` lists pinned facts not updated in 14 days (`memory:pinned`) — re-store one with `memory_store` to confirm it. The memory file format is unchanged; bundles gain an optional `updatedAt` per fact.
- **Codex trust.** Codex ignores a project's `.codex/config.toml` until the project is trusted. `doctor` (`codex:trust`) now checks `~/.codex/config.toml` (or `$CODEX_HOME`) for the project, its git root or its main checkout — case-insensitively on Windows, where Codex lower-cases the key — and says how to trust it. It never writes the trust entry.

### Changed

- **`handoff --decisions` / `--questions` no longer split on commas** — one sentence with commas became several bullets. They split on `;` or newlines; `--decision "…"` and `--question "…"` (and `--file`) can be repeated, one item each. `--files` still splits on commas (and `;`). The VS Code handoff wizard says so.
- New optional `staleAfter` in `agent.config.yaml`: `handoffDays` (3), `handoffCommits` (20), `pinnedFactDays` (14).

### Known

- `mcp:version` suggests `agentos sync` even when the other version is pinned by hand in `agent.config.yaml` (sync keeps it); edit the config instead.
- The `codex:trust` hint prints a TOML key that is wrong for a path containing `'`; git submodules are checked against their own root only.

## 0.2.1 — 2026-09-28

Follow-ups from the token benchmark (`bench/RESULTS.md`, PR #11). Run `agentos sync` to pick up the new rule text.

### Changed

- **The generated "Local Tools" note names the question each tool answers.** Why/how, conventions, commands, past decisions → `memory_recall` first; what breaks if X changes / who uses X → `codegraph_impact`; supersearch → symbol definitions, git history, blame. In the benchmark, seeded memory was never read (recall 0/3) until one sentence said when to use it (3/3). The note is emitted by every generator (Claude Code, Codex, Antigravity, Cursor, Windsurf).
- **`supersearch_text` is no longer presented as a Grep replacement** (tool description, generated note, README, skills): on the benchmark repo it cost 25 % more tokens than the built-in Grep for the same results. Plain text search stays with the harness's own Grep.
- The `agentos init` template's `no-guessing-deps` rule points at codegraph only.

### Fixed

- **`memory_recall` free-text search found nothing for multi-word queries.** It matched the whole query as one literal phrase against the fact's value. Now a fact matches when any word of the query (3+ letters) appears in its topic, key or value, and facts matching more words are listed first. In the benchmark the agent's first query (`"dist compiled build"`) had returned "No matching facts." and the agent guessed.

Benchmark re-run (recall + locate, 3 runs each, `bench/RESULTS.md`): recall **0/3 → 2/3** correct. Every run that called memory found the fact on its first query; one run never called memory. Locating code went from **+25 % to +2 %** tokens against plain Claude Code.

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
