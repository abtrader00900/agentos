# PRD 1 — Orchestrator engine ("hands + brain")

Status: draft for owner review · 2026-09-30 · target release 0.3.0

## 1. Why

Today agentos syncs one config into five coding agents and gives them shared
memory, codegraph and search. The owner still drives every task by hand:
open a chat, wait, open a PR, run tests, ask a second model to review, send
fixes back, then merge. That loop (proven over 15 ERP PRs) is exactly what a
program can run.

PRD 1 turns agentos from a config tool into an engine that takes one task
("add a discount field to customers") and returns a reviewed, test-green pull
request, using the agent CLIs the owner already pays for.

agentos does not try to out-think the models. Its edge is the team around
them: parallel workers, a different model reviewing every change, and a fix
loop that stops only when tests pass.

## 2. Roadmap context (8 layers)

| PRD | Layer | Scope |
|---|---|---|
| **1** | **0 Hands + 1 Brain** | **this document** |
| 2 | 2 Memory + learning | lessons after each run, auto-authored skills, FTS search across projects |
| 3 | 4 Control | local dashboard web app over `.agentos/runs`, voice/mobile later |
| 4 | 3 Autonomy | 24/7 daemon, triggers (CI fail, prod error, schedule, issue label), cloud/VPS runners |
| 5 | 1b Router | API + OmniRoute providers, Gemini/Fable, cost-aware routing |
| 6 | 5 Ecosystem | signed/scanned skills + MCP + plugin registry, media plugins |
| 7 | 7 Business agent | research → build → launch → marketing, owner approves every money step |
| 8 | 6 Business layer | accounts, teams, billing |

## 3. Decisions (agreed with the owner)

1. **Agents are driven through their CLIs** (`claude -p`, `codex exec`), using
   existing subscriptions. API keys / OmniRoute come in PRD 5.
2. **Autonomy is per project**, `pr | merge | deploy`, default `pr`.
   PRD 1 implements `pr` only; the other values are rejected by the schema
   with "not available yet".
3. **Two entry points**: the `agentos run` CLI and an `orchestrator` MCP
   server so a running Claude Code / Codex chat can hand work off.
4. **Fixed-role pipeline** (planner → workers → verifier → fixer → PR),
   not a free-form swarm.

## 4. Components

New code lives in `src/orchestrator/`.

| File | Responsibility |
|---|---|
| `run.ts` | Run record and state machine: `queued → planning → working → integrating → verifying → fixing → pr_open`, terminal `needs_human`, `failed`, `cancelled`, plus `paused` (rate limit). Persists to `.agentos/runs/<id>/state.json`. |
| `planner.ts` | Builds the planner prompt (task, `memory_recall` hits, codegraph file map, config rules), calls the planner runner, validates the JSON plan with zod. |
| `runners/types.ts` | `Runner` interface: `run({prompt, cwd, timeoutMs, signal}) → AsyncIterable<RunnerEvent>` ending in `{ok, summary, exitCode}`. |
| `runners/claude.ts` | `claude -p --output-format stream-json --permission-mode acceptEdits` |
| `runners/codex.ts` | `codex exec --json -s workspace-write` with stdin closed |
| `runners/fake.ts` | Test runner: applies scripted file edits and commits. No model. |
| `workspace.ts` | Worktree per subtask off the run branch; merge in dependency order; cleanup (removes Windows junctions before `git worktree remove`). |
| `scheduler.ts` | Runs subtasks whose `dependsOn` are done, up to `maxWorkers`, with a free-memory check before each spawn. |
| `verifier.ts` | Runs `verify` commands in the run worktree; asks the reviewer runner for JSON findings on `base..run`. |
| `gate.ts` | Secret scan of the diff, push the run branch, `gh pr create` with the report body. |
| `report.ts` | PR body and `agentos runs` output from `state.json` + `events.jsonl`. |

The entry points are:
- `src/commands/run.ts`: `agentos run "<task>"`, `agentos runs`, and
  `agentos run <id> --resume | --cancel | --status`.
- `src/mcp/orchestrator/server.ts`: the tools `run_task`, `run_status` and
  `run_cancel`. `run_task` starts a detached `agentos run` process and returns
  the run id at once.

### Config (`agent.config.yaml`)

```yaml
orchestrator:
  autonomy: pr            # pr | merge | deploy — PRD 1: pr only
  maxWorkers: 2
  maxFixRounds: 3
  maxMinutes: 90          # whole run
  subtaskMinutes: 20
  planner: claude
  workers: [claude, codex]
  reviewer: codex         # must differ from the subtask's author; falls back to the other CLI
  verify: [npm test, npx tsc --noEmit]
  minFreeMemoryMb: 1500
```

The whole block is optional. When it is missing, `agentos run` stops with a
message showing this snippet. Old configs keep parsing, as they did in 0.2.2.

### Plan schema

```ts
{ summary: string,
  subtasks: Array<{ id: string, title: string, prompt: string,
                    files: string[], dependsOn: string[],
                    agent: "claude" | "codex" }> }   // 1..8 subtasks
```

The planner is told:
- Subtasks must touch disjoint files, or be chained with `dependsOn`.
- A small task is one subtask.

`planner.ts` rejects a plan in any of these cases:
- It has cycles.
- It has unknown ids.
- Two subtasks that are not chained list the same file.

On rejection the planner is re-prompted once with the error. After that the
run goes to `needs_human`.

## 5. Data flow

1. **Preflight.** These must all hold:
   - The main checkout is clean.
   - `gh auth status` passes.
   - The configured CLIs resolve (the existing doctor helpers).
   - The base is the default branch HEAD.

   Then the run creates the run id and the branch `agentos/run-<id>`.
2. **Plan.** The planner produces the validated plan and writes it to
   `plan.json`.
3. **Work.** The scheduler starts ready subtasks in their own worktrees. Each
   runner gets the subtask prompt, the plan summary, and "commit your work on
   this branch". Every runner event is appended to `events.jsonl`.
4. **Integrate.** Subtask branches merge into the run branch in dependency
   order. On a conflict, a fixer runner resolves it in the run worktree. If
   that fails, the run goes to `needs_human`.
5. **Verify.** The run executes the `verify` commands. Then the reviewer, a
   different CLI from the author, returns
   `[{severity: high|medium|low, file, line, issue}]`.
6. **Fix loop.** The loop runs if a verify command failed or any
   high/medium finding exists. The author runner gets the failures and
   findings and commits, then the run goes back to step 5. It stops after
   `maxFixRounds`, then goes to `needs_human` with the last report.
7. **PR.** If the default branch moved, rebase first (fixer on conflict).
   Then:
   - Secret-scan the diff.
   - Push the run branch.
   - Open the PR, with a body that holds the plan, per-subtask summaries,
     verify output, the findings (fixed and remaining) and the elapsed time.
   - Set the state to `pr_open`.
   - Store one `memory_store` fact (`runs/<id>`) with the outcome.
8. **Cleanup.** Successful runs remove their worktrees. Failed runs keep them
   and print their paths.

## 6. Error handling

| Case | Behaviour |
|---|---|
| Runner timeout or crash | Retry once with the other worker CLI, then `needs_human` |
| Rate limit / quota message in runner output | `paused`; `--resume` continues from the saved state |
| agentos or the PC dies mid-run | `state.json` is written after every transition; `--resume` picks up from the last completed step |
| `--cancel` | Kills the run's own process tree by recorded PIDs (never by image name), marks `cancelled`, keeps worktrees |
| Free memory below `minFreeMemoryMb` | Scheduler waits before spawning |
| Invalid plan twice | `needs_human` with the validation error |
| Any step exceeds `maxMinutes` | `needs_human` |

## 7. Safety

- Runners run only inside run or subtask worktrees. After each step, if the
  main checkout's `git status` changed, the run fails with `failed: wrote
  outside worktree`.
- The default branch is never pushed. Only `agentos/run-*` branches are.
- No `--dangerously-skip-permissions` / `--yolo` flags. Claude runs with
  `acceptEdits`, Codex with `workspace-write`.
- The worker prompt forbids deploys, production migrations, and deletes
  outside the worktree. The post-step outside-write check enforces the
  last of these.
- A secret scan runs before the push, looking for API-key patterns, private
  keys and `.env` files in the diff. Any hit blocks the PR. The run goes to
  `needs_human` and the match is redacted in the report.
- Logs redact the values of environment variables whose names contain
  `KEY`, `TOKEN`, `SECRET` or `PASSWORD`.

## 8. Testing

- **Unit (fake runner, no model):**
  - plan validation (cycles, overlap, unknown ids)
  - scheduler ordering and the `maxWorkers` cap
  - every state transition
  - fix loop stop at `maxFixRounds`
  - resume from each persisted state
  - cancel kills only recorded PIDs
  - outside-write detection
  - secret scan blocks
- **Integration:** temp git repos with a local bare remote. `gh` is stubbed
  by a script on PATH. These tests check the full `run` from task to "PR
  created".
- **Manual e2e (real CLIs):**
  1. a small agentos issue
  2. a small ERP feature
  3. a task seeded with a failing test, to exercise the fix loop

  The results are recorded in `bench/orchestrator-e2e.md`.

## 9. Success criteria

- At least 2 of the 3 e2e tasks reach a PR with green verify commands and no
  human input.
- Two independent subtasks finish in less wall-clock time than the same
  subtasks run with `maxWorkers: 1`.
- Across all tests, zero writes happen outside worktrees and zero pushes
  reach the default branch.
- A run killed mid-`working` resumes and reaches `pr_open`.

## 10. Out of scope for PRD 1

- The dashboard.
- `merge`/`deploy` autonomy.
- API/OmniRoute providers.
- Gemini/Fable runners.
- Building desktop or browser control. Agents keep using their own MCP
  servers for that.
- Triggers and the daemon.
- Cloud runners.
- Automatic skill authoring.
