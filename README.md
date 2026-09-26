# AgentOS

**Local-first, multi-harness agent operating system. Zero API dependency.**

Ek `agent.config.yaml` → Claude Code, Codex, Antigravity, Cursor, Windsurf — 5 harnesses ke configs, MCP tools, aur shared memory. API ka kharcha zero, har project mein same brain.

> Status: **v0.1.0 — all 4 milestones + Phase 5 shipped**, CI green on Linux + Windows. See `RFC/` for the handoff protocol spec.

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
    args: ["-y", "@basit0090/agent-os", "mcp", "memory"]
  - name: supersearch
    command: npx
    args: ["-y", "@basit0090/agent-os", "mcp", "supersearch"]
  - name: codegraph
    command: npx
    args: ["-y", "@basit0090/agent-os", "mcp", "codegraph"]
```

### Commands

| Command | Karta kya hai |
|---|---|
| `agentos init` | `agent.config.yaml` template banata hai |
| `agentos install` | Configs + `.agentos/` + skills + `.gitignore` setup |
| `agentos sync` | Sab harness configs regenerate (drift par ruk jata hai) |
| `agentos sync --force` | Drifted / pehle se maujood files overwrite (purani copy `<file>.bak`) |
| `agentos sync --only codex` | Sirf ek harness sync (baqi ka drift tracking barqarar) |
| `agentos status [--json]` | Project, harnesses, drift, memory status |
| `agentos doctor [--json]` | Health check — config, harness files, drift, MCP commands, memory, skills, handoff |
| `agentos skill list \| install \| search \| test` | Skills — bundled, registry, `owner/repo[#dir]`, git URL, ya local path |
| `agentos handoff --to <harness> --task "..."` | Context bundle export (task, decisions, memory, git) |
| `agentos learn [--apply]` | Git history se rule suggestions |
| `agentos mcp memory \| supersearch \| codegraph` | MCP servers (stdio — har harness ke liye) |

### MCP Tools

**memory** — `memory_store` · `memory_recall` · `memory_get` · `memory_forget` · `memory_topics` · `memory_export` · `memory_stats`
Storage: `<project>/.agentos/memory.json` — local JSON store, atomic writes, markdown exportable.

**supersearch** — `supersearch_text` (regex across project, .gitignore-aware, ripgrep when available) · `supersearch_symbol` (function/class/method definitions via ast-grep) · `supersearch_history` (pickaxe — which commit changed a string) · `supersearch_blame` (per-line authorship)

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
| Codex | `AGENTS.md`, `.codex/config.toml` | Codex only reads a project's `.codex/config.toml` when the project is **trusted** (answer the trust prompt, or set `trust_level = "trusted"` for it in `~/.codex/config.toml`). |
| Antigravity | `.agents/rules/agentos.md`, `.agents/mcp_config.json` | Rule has `trigger: always_on` frontmatter, as Antigravity requires. It also reads `AGENTS.md`. |
| Cursor | `.cursor/rules/agentos.mdc` | `alwaysApply: true`. |
| Windsurf | `.windsurf/rules/agentos.md` | `trigger: always_on` frontmatter (without it a rule is manual-only). |

The MCP servers find the project from their working directory; if a harness starts them elsewhere, set `AGENTOS_PROJECT=/abs/path` in the server's `env`.

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
Every install is validated (frontmatter, "Use when" trigger, contract test) before it lands in `.agentos/skills/`.

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
  --files "app/Jobs/GenerateInvoicePdf.php" --decisions "queue vs sync pending"
agentos sync   # HANDOFF.md auto-injected into all 5 harness configs
```

The receiving agent gets: task state, files in progress, pending decisions, open questions, memory snapshot, git state. Spec: `RFC/handoff-protocol.md`.

## Storage

Zero native dependencies — `npm install` never compiles anything. Memory and graph persist as atomic-writes JSON in `.agentos/`. A SQLite backend can plug in behind the same interface later if a project outgrows it.

## License

MIT
