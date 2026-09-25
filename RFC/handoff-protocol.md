# RFC: AgentOS Handoff Protocol v1

**Status:** Implemented (v1) · **Date:** 2026-09-26 · **Companion:** `src/core/handoff.ts`

## 1. Problem

AI coding agents (Claude Code, Codex, Antigravity) are silos. Switching agents mid-task means losing: the active task state, decisions made, files in progress, and everything the agent learned about the project. Users re-pay this cost in tokens and time every switch.

## 2. Goals

- G1: A developer can switch from any supported harness to any other mid-task with zero re-explaining.
- G2: The transfer is machine-readable (agents can act on it) and human-readable (developers can review it).
- G3: No network, no API. The bundle is plain files in the project.
- G4: Forward-compatible: versioned format, unknown fields ignored.

## 3. Format

Two artifacts, always written together to `.agentos/handoffs/<ISO-timestamp>/`:

1. **`bundle.json`** — canonical, machine-readable:

```jsonc
{
  "format": "agentos-handoff",   // magic string, REQUIRED
  "version": 1,                  // integer, REQUIRED; readers must reject higher majors
  "createdAt": "ISO-8601",
  "fromHarness": "claude-code",  // or "unknown"
  "toHarness": "codex",          // or "any"
  "task": "string — what was being done + exact current state",
  "filesInProgress": ["src/a.ts"],      // paths relative to project root
  "pendingDecisions": ["use queue vs sync for PDF export"],
  "openQuestions": ["should refund hit the same ledger entry?"],
  "notes": "free-form",
  "memory": [{ "topic": "...", "key": "...", "value": "...", "pinned": false }],
  "git": { "branch": "...", "lastCommits": ["%h %s"], "status": "short-status", "diffStat": "" }
}
```

2. **`HANDOFF.md`** — same content rendered for humans, ALSO copied to project root as `HANDOFF.md` so harness config generators can inject it (see §5).

### Semantics

- `task`: REQUIRED. Written as if briefing a senior engineer who has zero context: what, why, and precisely where it stopped.
- `filesInProgress`: files with unsaved/uncommitted intent — the next agent should read these first.
- `pendingDecisions`: decisions the previous agent deliberately deferred.
- `openQuestions`: questions the previous agent could not answer from the codebase.
- `memory`: snapshot of the AgentOS memory store at handoff time. Receiving harnesses should treat pinned facts as ground truth.
- `git`: factual repo state. Receiving agents must re-verify before acting; this is a hint, not authority.

## 4. Lifecycle

```
export:  agentos handoff --to codex --task "..." [--files ...] [--decisions ...]
         → writes .agentos/handoffs/<ts>/{bundle.json,HANDOFF.md} + ./HANDOFF.md

import:  harness configs regenerated via `agentos sync` inject HANDOFF.md under
         "## Active Handoff (AgentOS)" — the receiving agent sees it in its
         system context automatically.

consume: after the receiving agent picks up the work, delete HANDOFF.md
         (doctor warns if it is >24h old).
```

## 5. Harness Integration

AgentOS config generators (CLAUDE.md, AGENTS.md, .antigravity/config.md) append the current `HANDOFF.md` content when the file exists. Non-AgentOS harnesses can adopt the protocol by reading `.agentos/handoffs/*/bundle.json` — no AgentOS dependency required.

## 6. Compatibility Rules

- Readers must reject bundles with `format != "agentos-handoff"`.
- Readers must reject `version` greater than their supported major.
- Writers must not remove fields within the same version; deprecations move to `notes`.
- New optional fields may be added in minor versions; readers ignore unknown fields.

## 7. Future Work (post-v1)

- Import tool: push bundle memory back into the memory store on arrival (`handoff --receive`).
- Multi-hop lineage: `fromHarness` chains, so an agent can trace a task's full history.
- Handoff verification: receiving agent acks consumption, doctor clears the warning.
