# AgentOS

**Local-first, multi-harness agent operating system. Zero API dependency.**

Ek `agent.config.yaml` → Claude Code, Codex, Antigravity, Cursor, Windsurf — 5 harnesses ke configs, MCP tools, aur shared memory. API ka kharcha zero, har project mein same brain.

> Status: **v0.2.2** — all 4 milestones + Phase 5 shipped, two full audit rounds (see CHANGELOG.md), CI green on Linux + Windows. See `RFC/` for the handoff protocol spec.

![AgentOS demo: install → handoff → doctor](docs/images/demo.gif)

## Why

| Aaj | AgentOS |
|---|---|
| Agents har session mein sab bhool jate hain | Persistent local memory (JSON, zero native deps) |
| Har harness ka alag config | Ek YAML → paanch harnesses |
| Search/memory ke liye API tokens | Deterministic local MCP tools |
| Agent switch = context loss | Handoff protocol (Phase 4) |

## Quick Start

```bash
npm install -g @basit0090/agent-os

# in any project:
cd your-project
agentos init        # creates agent.config.yaml
agentos install     # configs + MCP servers for all 5 harnesses
agentos doctor      # health check
```

From source: `npm install && npm test`, dev CLI: `npx tsx src/cli.ts <cmd>`.

### Upgrading

`agentos sync` pins the MCP servers it writes to its own version (`npx -y @basit0090/agent-os@0.2.2 mcp memory`) — npx caches an unversioned spec and would keep running whichever version it fetched first. So after a new release:

```bash
npm install -g @basit0090/agent-os@latest   # or run it once: npx -y @basit0090/agent-os@latest sync
agentos sync                                # rewrites .mcp.json, .codex/config.toml, … with the new version
agentos doctor                              # "mcp:version" warns if a generated config still runs another version
```

Then restart the harness (or reconnect its MCP servers) so it starts the new version.

Adopting agentos in a project that already has a `CLAUDE.md` / `AGENTS.md`? `install` refuses to overwrite them — move their content into `agent.config.yaml`, then `agentos install --force` (the originals are kept as `<file>.bak`).

### agent.config.yaml

```yaml
project:
  name: my-saas
  description: "Laravel API + React dashboard"
stack: [laravel, react]
rules:
  - id: run-tests-first
    text: "Before marking any task done, run the test suite."
  - id: no-any-ts
    harnesses: [claude-code, codex]     # per-harness filtering
    text: "Avoid `any` in TypeScript."
skills:
  - name: tdd-laravel
mcpServers:                            # what `agentos init` generates
  - name: memory
    command: npx
    args: ["-y", "@basit0090/agent-os", "mcp", "memory"]   # sync writes @basit0090/agent-os@<its version>
  - name: supersearch
    command: npx
    args: ["-y", "@basit0090/agent-os", "mcp", "supersearch"]
  - name: codegraph
    command: npx
    args: ["-y", "@basit0090/agent-os", "mcp", "codegraph"]
staleAfter:                            # optional — when doctor/sync call context stale (defaults shown)
  handoffDays: 3                       # HANDOFF.md older than this
  handoffCommits: 20                   # HEAD moved more than this past the handoff's commit
  pinnedFactDays: 14                   # a pinned memory fact not updated for this long
```

Leave the version out of `agent.config.yaml`: `sync` pins the servers to the CLI that runs it. A version you do write there (`@basit0090/agent-os@0.2.1`) is kept as written.

### Commands

| Command | Karta kya hai |
|---|---|
| `agentos init` | `agent.config.yaml` template banata hai |
| `agentos install` | Configs + `.agentos/` + skills + `.gitignore` setup |
| `agentos sync` | Sab harness configs regenerate (drift par ruk jata hai) |
| `agentos sync --force` | Drifted / pehle se maujood files overwrite (purani copy `<file>.bak`) |
| `agentos sync --only codex` | Sirf ek harness sync (baqi ka drift tracking barqarar) |
| `agentos status [--json]` | Project, harnesses, drift, memory status |
| `agentos doctor [--json]` | Health check — config, harness files, drift, MCP commands + pinned version, memory (stale pinned facts), skills, handoff freshness, Codex trust |
| `agentos skill list \| install \| search \| test` | Skills — bundled, registry, `owner/repo[#dir]`, git URL, ya local path |
| `agentos handoff --to <harness> --task "..."` | Context bundle export (task, decisions, memory, git) |
| `agentos handoff --clear` | Kaam khatam: `HANDOFF.md` hatao (bundle `.agentos/handoffs/` mein rehta hai), phir `agentos sync` |
| `agentos learn [--apply]` | Git history se rule suggestions |
| `agentos mcp memory \| supersearch \| codegraph` | MCP servers (stdio — har harness ke liye) |

### MCP Tools

**memory** — `memory_store` · `memory_recall` · `memory_get` · `memory_forget` · `memory_topics` · `memory_export` · `memory_stats`
Storage: `<project>/.agentos/memory.json` — local JSON store, atomic writes, markdown exportable.

**supersearch** — `supersearch_symbol` (function/class/method definitions via ast-grep) · `supersearch_history` (pickaxe — which commit changed a string) · `supersearch_blame` (per-line authorship) · `supersearch_text` (regex across project, .gitignore-aware — for harnesses without a built-in grep; in Claude Code the built-in Grep is cheaper, see `bench/RESULTS.md`)

**codegraph** — `codegraph_impact` (what breaks if I change this file — transitive) · `codegraph_deps` · `codegraph_orphans` (dead code candidates) · `codegraph_cycles` · `codegraph_rebuild` · `codegraph_stats`. Import extraction runs on **tree-sitter (WASM)** — real parsing across TS/JS/Python/PHP/Go/Java/Kotlin, `use function`, multi-line imports, dynamic `import()` — with automatic regex fallback. Zero native deps either way.
Deterministic import-graph (TS/JS, Python, PHP/Laravel, Go, Java/Kotlin), JSON-backed, incremental mtime-based rebuilds.

## Architecture

```
agent.config.yaml (single source of truth)
        │
   ┌────┼──────────┬─────────────┬──────────┬──────────┐
   ▼    ▼          ▼             ▼          ▼          ▼
CLAUDE.md      AGENTS.md    Antigravity   .cursor/   .windsurf/
.mcp.json   .codex/config.toml  rules+mcp   rules/     rules/
   │           │               │            │          │
   └───────────┴───────┬───────┴────────────┴──────────┘
                       ▼
   MCP servers (memory → supersearch → codegraph)
                       ▼
   .agentos/memory.json — shared, local, durable (safe with several harnesses open at once)
```

## Harness Notes

| Harness | Generated | Note |
|---|---|---|
| Claude Code | `CLAUDE.md`, `.mcp.json` | Project-scoped MCP servers; Claude asks once before enabling them. |
| Codex | `AGENTS.md`, `.codex/config.toml` | Codex only reads a project's `.codex/config.toml` when the project is **trusted** (answer the trust prompt, or set `trust_level = "trusted"` for it in `~/.codex/config.toml`). `agentos doctor` warns when the trust entry is missing — it never writes it; trust is your call. Servers get `startup_timeout_sec = 120` — the first `npx -y` run downloads the package. |
| Antigravity | `.agents/rules/agentos.md`, `.agents/mcp_config.json` | Rule has `trigger: always_on` frontmatter, as Antigravity requires. |
| Cursor | `.cursor/rules/agentos.mdc`, `.cursor/mcp.json` | `alwaysApply: true`. |
| Windsurf | `.windsurf/rules/agentos.md` | `trigger: always_on` frontmatter (without it a rule is manual-only). Windsurf has **no project-level MCP file**: add the servers from `.mcp.json` to Windsurf's global `mcp_config.json` yourself. |

Cursor, Windsurf and Antigravity also read `AGENTS.md`, so with `codex` among the targets they see the rules twice. If that matters, sync only what you use: `agentos sync --only claude-code,cursor`.

The MCP servers find the project by walking up from their working directory to `agent.config.yaml`; set `AGENTOS_PROJECT=/abs/path` in a server's `env` to pin it. `env` values in `mcpServers` are written into the generated MCP files — keep secrets out of them (sync warns when they come from `agent.config.local.yaml`).

Re-running `agentos install` leaves already-installed skills alone (your edits survive); `agentos skill install <name>` or `install --force` refreshes them. Installed copies omit the skill's `test/` directory so your own test runner doesn't pick it up.

## Config Layers (override: local > project > global)

1. `~/.agentos/agent.config.yaml` — global defaults
2. `<project>/agent.config.yaml` — committed, shared
3. `<project>/agent.config.local.yaml` — gitignored, personal

## Roadmap

- [x] Phase 1: config schema, harness generators, drift detection, memory MCP
- [x] Phase 2: supersearch (text/symbol/git) + codegraph (impact/orphans/cycles) MCP servers
- [x] Phase 3: skills framework + 11 core skills
- [x] Phase 4: handoff protocol (RFC + bundle + auto-inject) + doctor
- [x] Phase 5: Cursor + Windsurf targets, `agentos learn` (git-history rule suggestions)
- [x] VS Code extension (`editors/vscode/`) — status-bar doctor, skills sidebar, handoff wizard, `--json` CLI output (Issue #2)
- [x] tree-sitter codegraph (Issue #4) — WASM parsing backend + lower-case PHP namespace resolution
- [x] GitHub Actions CI — Linux + Windows test matrix (Node 20/22), global-install and git-install smoke tests, extension compile

## Community Skill Registry (Issue #3)

Skills are just directories — `SKILL.md` + `test/`. Install from **any git source**, no API keys:

```bash
agentos skill install owner/repo             # GitHub shorthand — every SKILL.md in the repo (up to 3 levels deep)
agentos skill install owner/repo#skills/foo  # one directory inside the repo
agentos skill install https://gitlab.com/team/skills.git
agentos skill install ./my-skills/foo        # a local directory
agentos skill install android-testing        # a registry name → resolved to repo + path
agentos skill search deploy                  # bundled + registry search
```

Or declare them in `agent.config.yaml` and let `agentos install` fetch them:

```yaml
skills:
  - name: tdd-laravel                          # bundled
  - name: deploy-checklist
    source: team/agent-skills#skills/deploy-checklist
```

Point `skillRegistry` at an index JSON to search a community registry:

```yaml
skillRegistry: https://raw.githubusercontent.com/abtrader00900/agentos/master/skills/registry.json
```

Index format: `{ "version": 1, "skills": [{ "name", "description", "repo", "path?" }] }`.
Every install is validated (frontmatter `name`/`description` with a "Use when" trigger, at least two `##` sections, a `test/` directory) before it lands in `.agentos/skills/`; `agentos skill test` checks the bundled and the installed skills.

## Editor Integrations

### VS Code (`editors/vscode/`)

Status-bar doctor (refreshed on save), skills sidebar with one-click install, sync/status/doctor commands, and a guided handoff wizard — all through the local CLI, zero API dependency.

```bash
cd editors/vscode && npm install && npm run compile   # F5 to debug
```

All CLI commands support `--json` for machine-readable output (`status`, `doctor`, `skill list`) — use it for your own editor/tooling integrations.

## Handoff Protocol

Switch agents mid-task with zero re-explaining:

```bash
agentos handoff --to codex --task "Invoice PDF export half-done: queue job done, blade template missing" \
  --file app/Jobs/GenerateInvoicePdf.php \
  --decision "queue vs sync, pending" \
  --question "Should the refund hit the same ledger entry, or a new one?"
agentos sync   # HANDOFF.md auto-injected into all 5 harness configs

# work finished:
agentos handoff --clear && agentos sync
```

`--file`, `--decision` and `--question` repeat, one item each. The list forms still work: `--files a.ts,b.ts` splits on `,` or `;`; `--decisions` and `--questions` split on `;` or newlines only, so a sentence with commas stays one item (before 0.2.2 they split on every comma).

The receiving agent gets: task state, files in progress, pending decisions, open questions, memory snapshot (each fact with its last-updated date), git state. `doctor` and `sync` warn once the handoff is older than 3 days or HEAD moved more than 20 commits past it (`staleAfter`). Spec: `RFC/handoff-protocol.md`.

## `agentos run` — hand a task to the agent team

Add an `orchestrator` block to `agent.config.yaml`:

```yaml
orchestrator:
  verify: [npm test, npx tsc --noEmit]   # must pass before a PR opens
  workers: [claude, codex]               # agent CLIs that write code — your subscriptions, no API keys
  reviewer: codex                        # reviews the diff (swapped if it wrote everything)
  maxWorkers: 2                          # parallel agents, each in its own git worktree
  link: [node_modules]                   # installed deps shared from your checkout into worktrees
  models: { codex: gpt-5.6-sol }         # optional: override a CLI's default model
```

```bash
agentos run "add a discount field to customers"   # plan → parallel agents → tests + review → PR
agentos runs                                        # list runs
agentos run --resume <id>                           # continue after a rate limit or a crash
agentos run --cancel <id>
```

A run ends with a pull request, or with a reason it needs you. It never pushes your default branch or deploys. It never uses the agents' skip-permission flags. It blocks the PR when any commit in the run adds a secret, even one a later fix removed. Run state and logs are kept in `.agentos/runs/<id>/`.

To hand work over from inside a Claude Code or Codex chat, register the MCP server and call `run_task`:

```yaml
mcpServers:
  - name: orchestrator
    command: npx
    args: ["-y", "@basit0090/agent-os@0.3.0", "mcp", "orchestrator"]
```

## Learning from runs

After every `agentos run`, agentos records what went wrong and how it was fixed: failing checks that a fix round turned green, review findings that were fixed, CLI fallbacks and merge conflicts. A read-only agent turns that into up to three short lessons. Later runs get the relevant lessons in their planner, worker, reviewer and fixer prompts. Your normal Claude and Codex chats see them too, through `memory_recall`.

- A lesson backed by that recorded evidence is used right away (`auto`).
- A guess, or anything with a URL or a shell pipe, waits for you (`pending`).
- A lesson that contains a secret is dropped.
- A lesson whose text is edited outside agentos (for example with `memory_store`) drops back to `pending` until you approve it again.

```bash
agentos lessons                      # list (status, seen, used) with each lesson's evidence
agentos lessons --pending            # waiting for you
agentos lessons approve <key>        # or: forget <key> | promote <key> (→ agent.config.local.yaml rule)
agentos skill drafts                 # a skill drafted after a kind of task succeeded 3 times
agentos skill approve <kind>         # prints it, then installs it; or: agentos skill reject <kind>
agentos learn --pending-runs         # learn from finished runs that were not learned yet
```

A rejected draft, or one that failed validation or the safety filter, leaves a tombstone, so agentos drafts that kind at most once. Delete `.agentos/skill-drafts/<kind>/` to allow a new draft.

```yaml
learning:            # optional; these are the defaults
  retro: true
  retroAgent: claude
  maxLessonsInPrompt: 5
  skillAfterRuns: 3
```

## Storage

Zero native dependencies — `npm install` never compiles anything. Memory and graph persist as atomic-writes JSON in `.agentos/`. A SQLite backend can plug in behind the same interface later if a project outgrows it.

## License

MIT
