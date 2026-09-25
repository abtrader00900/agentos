# Launch Post — AgentOS

> Copy-paste ready for dev.to / Reddit r/LocalLLaMA, r/ClaudeAI / HN Show.
> Fill in the repo URL before publishing.

---

## Title options

1. **AgentOS — a local-first operating system for AI coding agents (Claude Code, Codex, Antigravity). Zero API cost.**
2. I built an open-source "agent OS": one config drives 5 coding agents, with shared memory, deterministic tools, and handoff between agents

---

## Body

Every AI coding agent today is a silo. Claude Code has its memory, Codex has its own, Antigravity another. Switch tools mid-task and you re-explain everything — burning tokens to rebuild context the previous agent already had.

**AgentOS** fixes this with a simple idea: *the brain should live in your project, not in the agent.*

One `agent.config.yaml` in your repo generates the config for **5 harnesses** — Claude Code, Codex, Antigravity, Cursor, Windsurf — plus three local MCP servers and a handoff protocol that lets you switch agents mid-task without losing a single byte of context.

### What's in the box

- **One config → 5 agents.** Rules, stack description, MCP registration — generated per harness, with drift detection (if you hand-edit a generated file, sync refuses to silently overwrite).
- **Shared long-term memory** (`memory` MCP server). Agents store and recall project facts in a local JSON store. Session ends, memory stays. Next session starts where you left off.
- **Deterministic search, zero tokens** (`supersearch` MCP server): regex text search (ripgrep-powered), symbol search via ast-grep, and git archaeology — pickaxe + per-line blame.
- **Change impact analysis** (`codegraph` MCP server): "if I change this file, what breaks?" — transitive dependents, orphans, import cycles. Your agent stops guessing.
- **10 battle-tested skills** (tdd-laravel, tdd-react, code-review, security-scan, db-migration-check, refactor-safe, …) with a validation framework. Same skill runs on every harness.
- **Handoff protocol (open RFC).** `agentos handoff --to codex --task "..."` exports task state + decisions + memory snapshot + git state; the receiving agent auto-receives it via its config. Written as a versioned spec so non-AgentOS tools can adopt it.
- **`agentos learn`** — mines your git history and suggests config rules (files that always change together, hot spots). It gets smarter the more you use it.
- **`agentos doctor`** — a 12-point health check with actionable fixes.

### Zero is the magic number

- **Zero API calls** for memory, search, and graph — everything is local and deterministic.
- **Zero native dependencies** — `npm install` never compiles anything.
- **Zero lock-in** — agents are interchangeable. Stop liking one? Your entire setup survives.

### Why this matters

Cheap operations (search, recall, impact checks) currently get routed through expensive LLM context. AgentOS moves them to deterministic local tools, so your tokens go to actual reasoning. In practice that's the difference between burning your quota by Tuesday and forgetting what a quota is.

### Status

v0.1.0 — the core is solid (96 tests, 5 harness targets, 3 MCP servers, 10 skills, handoff RFC). MIT licensed. Early, honest, and looking for contributors — especially on the handoff protocol spec, new skills, and more harness targets.

Repo: https://github.com/abtrader00900/agentos

```bash
git clone https://github.com/abtrader00900/agentos && cd agentos
npm install && npm test
npx tsx src/cli.ts init     # in any project
```

What would make you actually use this? What would make you *not*? Brutal feedback welcome.

#opensource #AIagents #MCP #ClaudeCode #Codex #localfirst
