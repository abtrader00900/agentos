# AgentOS

**Local-first, multi-harness agent operating system. Zero API dependency.**

Ek `agent.config.yaml` → Claude Code, Codex, Antigravity — teeno ke configs, MCP tools, aur shared memory. API ka kharcha zero, har project mein same brain.

> Status: **v0.1.0 — Phase 1 (M1 complete zone)**. See `docs/` for the full plan.

## Why

| Aaj | AgentOS |
|---|---|
| Agents har session mein sab bhool jate hain | Persistent local memory (SQLite) |
| Har harness ka alag config | Ek YAML → teeno harnesses |
| Search/memory ke liye API tokens | Deterministic local MCP tools |
| Agent switch = context loss | Handoff protocol (Phase 4) |

## Quick Start

```bash
npm install
npm test            # full suite

# in any project:
cd your-project
/path/to/agentos/examples se config copy karo, ya:
node /path/to/agentos/dist/cli.js init

# dev mode:
npx tsx /path/to/agentos/src/cli.ts install
npx tsx /path/to/agentos/src/cli.ts status
```

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
mcpServers:
  - name: memory
    command: npx
    args: ["tsx", "/abs/path/to/agentos/src/mcp/memory/server.ts"]
```

### Commands

| Command | Karta kya hai |
|---|---|
| `agentos init` | `agent.config.yaml` template banata hai |
| `agentos install` | Configs + `.agentos/` + skills + `.gitignore` setup |
| `agentos sync` | Sab harness configs regenerate (drift par ruk jata hai) |
| `agentos sync --force` | Drift ignore karke overwrite |
| `agentos sync --only codex` | Sirf ek harness sync |
| `agentos status` | Project, harnesses, drift, memory status |
| `agentos mcp memory` | Memory MCP server (stdio — Claude Code/Codex/Antigravity) |

### MCP Tools

**memory** — `memory_store` · `memory_recall` · `memory_get` · `memory_forget` · `memory_topics` · `memory_export` · `memory_stats`
Storage: `<project>/.agentos/memory.db` — local SQLite, WAL mode, markdown exportable.

**supersearch** — `supersearch_text` (regex across project, .gitignore-aware, ripgrep when available) · `supersearch_symbol` (function/class/method definitions via ast-grep) · `supersearch_history` (pickaxe — which commit changed a string) · `supersearch_blame` (per-line authorship)

**codegraph** — `codegraph_impact` (what breaks if I change this file — transitive) · `codegraph_deps` · `codegraph_orphans` (dead code candidates) · `codegraph_cycles` · `codegraph_rebuild` · `codegraph_stats`
Deterministic import-graph (TS/JS, Python, PHP/Laravel, Go, Java/Kotlin), SQLite-backed, incremental mtime-based rebuilds.

## Architecture

```
agent.config.yaml (single source of truth)
        │
   ┌────┴─────┬──────────────┐
   ▼          ▼              ▼
CLAUDE.md  AGENTS.md   .antigravity/
.mcp.json  config.toml  mcp.json
   │          │              │
   └────┬─────┴──────────────┘
        ▼
   MCP servers (memory → supersearch → codegraph)
        ▼
   .agentos/memory.db — shared, local, durable
```

## Config Layers (override: local > project > global)

1. `~/.agentos/agent.config.yaml` — global defaults
2. `<project>/agent.config.yaml` — committed, shared
3. `<project>/agent.config.local.yaml` — gitignored, personal

## Roadmap

- [x] Phase 1: config schema, 3 harness generators, drift detection, memory MCP
- [x] Phase 2: supersearch (text/symbol/git) + codegraph (impact/orphans/cycles) MCP servers
- [ ] Phase 3: skills framework + 10 core skills
- [ ] Phase 4: handoff protocol + launch

## License

MIT
