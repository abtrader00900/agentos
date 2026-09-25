# AgentOS for VS Code

Local-first, multi-harness agent operating system — inside your editor.

Everything runs through the local `agentos` CLI. **Zero API dependency, zero telemetry.**

## Features

- **Status bar health** — live doctor results (pass / warn / fail), refreshed on save.
- **One-command sync** — regenerate Claude Code, Codex, Antigravity, Cursor and Windsurf configs.
- **Skills sidebar** — browse bundled skills, install with one click.
- **Handoff wizard** — export full agent context to another harness without leaving the editor.
- **Learn from git history** — mine co-changing files and hot spots.

## Setup

1. Install the [agentos CLI](https://github.com/abtrader00900/agentos) (`npm install` in the repo, or global once published).
2. Set `agentos.cliPath` if `agentos` is not on your PATH (point it at a repo checkout — `dist/cli.js` or `src/cli.ts` is detected automatically).
3. Open a project with `agent.config.yaml`.

## Commands

| Command | What it does |
|---|---|
| `AgentOS: Sync Harness Configs` | `agentos sync` |
| `AgentOS: Run Doctor` | `agentos doctor` with actionable fixes |
| `AgentOS: Show Status` | config, harnesses, drift, memory |
| `AgentOS: Create Handoff` | guided `agentos handoff` |
| `AgentOS: Learn from Git History` | `agentos learn` |
| `AgentOS: Install Skill` | `agentos skill install <name>` |

## Dev

```bash
npm install
npm run compile
# press F5 in VS Code with this folder open
```
