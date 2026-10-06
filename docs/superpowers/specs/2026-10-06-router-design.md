# PRD 5: model router (quota fallback, more agents, per-role models)

Date: 2026-10-06 · Status: approved by the owner ("ya sab karne k liya master prompt likho") · Master prompt: `agentos-master-prompt.md` v2.0

## Why

The owner pays for Claude Pro, ChatGPT Plus (Codex), Google AI Pro and Kimi. Today agentos uses only Claude and Codex, and **pauses the whole run** when one of them hits its quota, even when the other still has quota. The research of 2026-10-06 found:

| Provider | Usable by agentos | Strongest at |
|---|---|---|
| Claude Pro (`claude -p`) | yes: the unmodified binary under the owner's own login | Sonnet 5.5 for agentic coding (Terminal-Bench 70.6); Opus 5.5 for hard planning |
| ChatGPT Plus (`codex exec`) | yes: the official binary, personal use | GPT-6.1 Sol for daily work; Astra for math, security and low hallucination (small quota) |
| Google AI Pro (`agy -p`) | yes, with conditions: the unmodified binary, own login, no token extraction or relay | Gemini 3.8 Flash: fast, 1M context, video, PDF and images |
| Kimi membership | **no**: its guidelines forbid scripted use | the owner's interactive tool only |

## Goals

1. A run never pauses while an allowed agent still has quota.
2. Each role (planner, worker, reviewer, fixer) can use a different model per agent.
3. More agents than two, starting with `gemini` (the `agy` CLI), without weakening any safety invariant.
4. A project's agent allowlist is a hard boundary. The ERP stays on Claude and Codex.

## Non-goals

These are out of scope for this PRD:
- OmniRoute and API-key runners
- Kimi automation
- dollar budgets (the subscriptions are flat-rate)
- web and browser access (PRD 5b)
- Jules (PRD 5c)

## Design

### 1. Quota store: `src/orchestrator/quota.ts` (new)

- **Storage.** `~/.agentos/quota.json` (under `agentosHome()`) holds `{ "<agent>": "<ISO until>" }`, so every run and the daemon share it. It is written atomically through the existing JSON-store helper.
- **API:**
  - `markLimited(home, agent, until)`
  - `limitedUntil(home, agent, now): Date | undefined` returns nothing once `until` has passed
  - `clearQuota(home, agent?)`
  - `resetFrom(output, now, cooldownMin): Date`. If the CLI's message contains "in N minute(s)" or "in N hour(s)" or "try again in N…", it uses that duration. Otherwise it uses `now + cooldownMin`.
- **Tests.** `EngineDeps.quota?: QuotaStore` (`{ until(agent, now), mark(agent, until), clear(agent?) }`) defaults to the file store. Tests inject an in-memory store.

### 2. Allowlist and fallback

- **Schema** (`orchestratorSchema`):
  - `agents: AgentName[]` is optional. Its default is the union of `planner`, `workers` and `reviewer`, so existing configs are unchanged. A refine requires `planner`, `workers` and `reviewer` to be within `agents`.
  - `quotaCooldownMinutes` is a positive number, default 60.
- **`agentRunner(c, agent, mode)` call order:**
  1. Try `agent`, unless the quota store says it is limited.
  2. Then try every other agent in `cfg.agents` order, skipping limited ones.
  3. On `rateLimited`, call `mark(agent, resetFrom(...))`, log `{type:"fallback", from, to, why:"quota"}`, and continue with the next agent.
  4. On error or timeout, keep today's behaviour: fall back once to the next allowed agent, with `why: "timeout"|"error"`.
  5. Only when **every** allowed agent is limited does it return `rateLimited: true`. The run then pauses as today, and `RunState.resumeAt` is set to the earliest `until`.
- **Who really wrote it.** A fallback can hand a subtask to another agent, so `agentRunner` returns the agent that produced the result (`RunnerResult.agent`). The engine stores it as `subtask.doneBy` in run state. "Wrote a subtask" below means `doneBy ?? agent`.
- **Reviewer choice** (this replaces `other()`):
  1. the configured reviewer, if it wrote no subtask
  2. otherwise the first agent in `cfg.agents` that wrote no subtask
  3. otherwise the first agent in `cfg.agents` that is not the main author (the agent that wrote the most subtasks)
  4. otherwise the configured reviewer itself (a single-agent project)
- **Daemon.** A paused job is not resumed before its run's `resumeAt`.
- **Rate-limit messages.** `RATE_LIMIT_RE` also matches `individual quota reached` (agy) and `reached your .* usage limit` (Kimi, in case the owner ever enables it through an API).

### 3. Read-mode guard

Planner and reviewer calls must not edit files. The reviewer runs **at the same time as the verify commands** in the run worktree, so a before/after diff of that worktree cannot tell a reviewer's edit from a test artifact. The guard therefore isolates the call instead of diffing it:
- Every `mode: "read"` call runs in a **disposable detached worktree** at the current HEAD: `git worktree add --detach <runDir>/read-<n> HEAD`. Nothing is linked into it, because readers need no installed deps.
- After the call, agentos checks that worktree's `git status --porcelain` and HEAD.
  - If anything changed, it logs `{type:"read-guard", agent, files}` and turns the result into `ok: false` with that note. The existing error fallback then applies.
  - Either way, the worktree is removed with `git worktree remove --force` (it has no junctions), so a reader's edit can never reach the run branch.
- The guard is generic, so it covers any CLI whose read-only flag is weak or missing. The cost is one `git worktree add` per planner or reviewer call, about 1–2 s.

### 4. Per-role models

- `orchestrator.models.<agent>` accepts either a model name (as today) or `{ read?: name, write?: name }`.
  - `read` is used for the planner and reviewer.
  - `write` is used for workers, fixers and conflict resolution.
- `cliRunners(models)` passes the right one to `cliArgs`.
- Suggested settings (in docs and `init`, not as built-in defaults):

  | Agent | read | write |
  |---|---|---|
  | claude | `opus` | `sonnet` |
  | codex | the current Sol model | the current Sol model |

### 5. The `gemini` agent (the `agy` CLI)

- `agentNameSchema` becomes `["claude", "codex", "gemini"]`.
- `cliArgs("gemini", mode, model)`. The exact flags come from a **probe** done after the owner installs and logs in to `agy`. The constraints do not change:
  - The prompt goes on stdin, either as plain stdin or as `--input-format stream-json` with one user message. **Never argv.**
  - It produces a machine-readable output format, and `finalText()` learns it.
  - It never uses a bypass flag. Edits are auto-approved in headless mode, so write mode needs no flag.
  - Read mode uses agy's read-only or plan option if one exists, and the read-mode guard otherwise.
  - Commands stay denied: agentos runs the tests itself.
- `doctor` lists the agent CLIs (installed, version) with a login hint.

### 6. Visibility

- `agentos quota` prints `quota.json`. `agentos quota clear [agent]` clears it.
- The run page in the dashboard already lists events. A `fallback` event shows as "<from> → <to> (<why>)".
- `doctor` shows "limited until …" per agent.

## Safety (R7, must hold, with tests)

- **No bypass flags.** For every agent, `cliArgs` never contains `--dangerously-skip-permissions`, `--yolo`, `--auto` or `--dangerously-bypass-approvals-and-sandbox`. A test iterates over all agents and both modes.
- **Prompt on stdin.** `cliArgs` output never contains the prompt (the existing test is extended to gemini).
- **Fallback stays inside the allowlist.** With `agents: [claude, codex]`, gemini is never called, even when both are limited (test).
- **Read mode never changes the worktree.** A fake read runner that writes a file results in a clean worktree, a `read-guard` event and a failed call (test).

## Testing

- **Unit:** `quota.ts` (mark, until and expiry, `resetFrom` parsing) and `cliArgs` for all agents.
- **Engine** (existing fakes):
  - claude limited, so the run finishes on codex with no pause and `quota.json` (in-memory) marks claude
  - both limited, so the run pauses with `resumeAt`
  - the allowlist is respected
  - the read guard works
  - the reviewer choice holds with three agents
- **Existing pause tests** keep their meaning by running single-agent (`planner/workers/reviewer = claude`) or by limiting both fakes.
- **e2e:** `bench/router-e2e.md` records three real runs. In one, Claude is marked limited in `quota.json`, so the run must finish on Codex without pausing.

## Rollout

- The tasks ship as separate PRs built by `agentos run`, released together as 0.9.0 along with the converge check (PR #59).
- The ERP keeps `[claude, codex]` and needs no config change.
