# PRD 4: 24/7 autonomy (`agentos daemon`)

Status: draft for owner review · 2026-10-01 · target release 0.6.0 · builds on 0.5.x (speed-up PR #33, quick runs PR #35)

**Built by agentos itself:** each plan task is one `agentos run` on this repo. The controller (Claude) reviews every PR through the full gate and merges it.

## 1. Why

`agentos run` works only while the owner sits at the keyboard and types a task. The owner wants agentos to keep working while they sleep:
- run planned work at night
- fix its own PRs when CI fails, which was done by hand on 2026-10-01
- work through a queue of tasks one by one

Every run still ends at a PR that a human merges.

## 2. Decisions (agreed with the owner, 2026-10-01)

1. **Where it runs.** Local first, on the owner's Windows laptop, with the CLIs already logged in. The design keeps everything behind plain files and child processes so the same daemon can later run on a VPS or Railway. That decision and its cost are deferred.
2. **Triggers in this PRD:** a manual queue, a schedule, and CI-failed on agentos's own PRs. GitHub issue labels (with the untrusted-text filter) and notifications are deferred to PRD 4b.
3. **Limits:**
   - 1 run at a time across all projects
   - at most **6 runs per day**
   - at most **2 CI-fix runs per PR**
   - All are configurable.
4. **Start.** `agentos daemon start|stop|status` plus `agentos daemon install|uninstall`, which manage a Windows Task Scheduler task that starts the daemon at logon. The task is created only when the owner runs `install`.
5. **Approach.** One daemon process with a 30-second tick, not a Task Scheduler entry per schedule and not a GitHub Actions runner. It is cross-platform, it is the only way to get the queue and the CI watch in one place, and it is cloud-ready.
6. **Quality policy unchanged.** Autonomy stays at `pr`. The daemon never merges, never deploys, and never pushes a default branch or force-pushes.

## 3. Terms and billing (checked 2026-10-01)

The Anthropic support article "Use the Claude Agent SDK with your Claude plan" (updated 15 June 2026) says the planned separate Agent SDK credit is paused, and `claude -p` still draws from the subscription's usage limits. It also says "teams running shared production automation should use Claude Platform with an API key".

The daemon is personal automation on the owner's own machine and repos, which is ordinary individual use. The 6-runs/day cap protects the owner's interactive quota. If Anthropic changes this policy, the daemon keeps working; only where the usage is billed changes. PRD 5 (model router / API runners) is the fallback.

## 4. Components

### `src/daemon/`

| File | Responsibility |
|---|---|
| `queue.ts` | `~/.agentos/queue.json` (under `AGENTOS_HOME`), written with `withLock`. It provides `addJob`, `listJobs`, `removeJob` (queued jobs only), `nextJob` (paused first, then the oldest queued), and `updateJob`. It de-duplicates: no second queued or running job with the same `dedupeKey`. |
| `settings.ts` | Global limits from the optional `~/.agentos/daemon.yaml`, validated with zod: `{ maxRunsPerDay: 6, maxCiFixesPerPr: 2, tickSeconds: 30, ciEverySeconds: 300, pauseMinutesOnLimit: 30 }`. |
| `schedule.ts` | Uses `croner` (MIT, zero dependencies; DST and timezone correct) to evaluate `daemon.schedules` in each project's `agent.config.yaml`. A schedule whose time passed since it last fired is enqueued **once**, even if the daemon was off for several fire times. |
| `ci.ts` | For each enabled project it runs `gh pr list --state open --json number,headRefName,statusCheckRollup`. It keeps PRs whose head is `agentos/run-*` and that have a failed check and no pending check. It enqueues a CI-fix job unless the PR's fix count has reached `maxCiFixesPerPr` or a fix for it is already queued or running. The task text is a fixed instruction plus the last 3000 characters of `gh run view <id> --log-failed`, redacted with `safety.redact`. |
| `daemon.ts` | `tick()` evaluates schedules, runs the CI check when it is due, and starts the next job when the gates allow. `runLoop()` repeats `tick` every `tickSeconds`. Crash recovery runs at startup. |
| `service.ts` | Covers the PID file, `start` (spawns `daemon run` detached and hidden, then exits), `stop`, `status`, the log file `~/.agentos/daemon.log` (rotated at 1 MB), and `install`/`uninstall` (`schtasks`). |

### Engine: `--onto <branch>`

`agentos run --onto agentos/run-<x> "<task>"` is used for CI fixes:
- **Accepted branches.** Only `agentos/run-*` is accepted. Any other branch is refused before anything starts.
- **Starting point.** The run worktree starts from `origin/<branch>`, which becomes `baseBranch`. A run started before the branch moves is updated by the existing base-merge step in `gate()`.
- **Pipeline.** Tests, review, fix loop, build and secret scan are unchanged.
- **The end.** `git push origin HEAD:refs/heads/<branch>` without force, so git refuses anything that is not a fast-forward. No new PR is created, and `prUrl` is the existing PR's URL.
- **State.** `RunState.onto` records the branch, so resume works.

### CLI

```
agentos daemon start | stop | status | install | uninstall | run   (run = the foreground loop; start spawns it)
agentos queue add [--project <path>] [--quick] "<task>" | list | remove <id>
agentos run --onto <branch> "<task>"
```

### Dashboard

- A **Queue** page under All projects lists every job with its project, source, status, task excerpt, and its run or PR link. It has an "Add task" form (project, task, quick) and lets you remove a queued job.
- The sidebar shows the daemon status: running or stopped, the last tick, and today's runs as `n / max`. When it is stopped it shows the start command. There is no browser button that spawns processes.
- API routes:
  - `GET /api/queue`
  - `POST /api/queue` with `{ projectId, task, quick? }` (the same validation as start run)
  - `DELETE /api/queue/:id`
  - `GET /api/daemon`
- The existing auth, Origin and CSRF rules apply.

### Per-project opt-in (`agent.config.yaml`)

```yaml
daemon:
  enabled: true            # without this the daemon ignores the project (registered or not)
  ciFix: true              # watch agentos/run-* PRs and fix failed CI
  schedules:
    - cron: "0 2 * * *"    # 02:00 every night, local time
      task: "update dependencies' patch versions and keep npm test green"
      quick: false
```

## 5. Data

```ts
interface Job {
  id: string;                       // 8 hex
  projectId: string;                // from ~/.agentos/projects.json
  task: string;
  quick: boolean;
  source: "manual" | "schedule" | "ci";
  onto?: string;                    // ci: the PR branch
  dedupeKey: string;                // manual: id; schedule: projectId+cron+task hash+fire time; ci: projectId+branch
  status: "queued" | "running" | "paused" | "done" | "failed" | "removed";
  runId?: string;
  addedAt: string; startedAt?: string; endedAt?: string;
  result?: string;                  // PR URL or the run's reason
}
```

`~/.agentos/daemon-state.json` holds:
- `{ pid, startedAt, lastTick, lastCiCheck, pauseUntil?, lastFired: { [scheduleKey]: iso } }`

The daily run count is the number of jobs started on the local calendar day; a paused run that is resumed does not count again.

## 6. Flow

Each tick does the following.
1. **Schedules.** Enqueue every schedule of every enabled project whose previous fire time is later than its `lastFired`.
2. **CI.** If `ciEverySeconds` has passed, run the CI scan. A `gh` failure (no login, no network) is logged and skipped. The queue still runs.
3. **Start.** These must all hold:
   - nothing is running
   - `now ≥ pauseUntil`
   - fewer than `maxRunsPerDay` runs started today
   - free RAM ≥ the project's `orchestrator.minFreeMemoryMb`

   Then the daemon takes `nextJob()`. A paused job is resumed with `agentos run --resume <runId>`. A new job runs `agentos run --id <runId> [--quick] [--onto <b>] -- <task>`. Both start as a child process in the project root, with output appended to the daemon log.
4. **Finish.** When the child exits, the daemon reads the run state:
   - `pr_open` becomes done, with the PR URL
   - `needs_human`, `failed` and `cancelled` become failed, with the reason
   - `paused` sets the job to paused and `pauseUntil = now + pauseMinutesOnLimit`

**Startup recovery.** A job marked running whose run engine lock is live is adopted, and the daemon waits for it. A lock that is stale or free makes the job paused, so it is resumed next.

## 7. Errors

| Case | Behaviour |
|---|---|
| A second `daemon start` | The PID file names a live process, so it refuses: "already running (pid n)". |
| The project folder is missing, or `daemon.enabled` was turned off | The job fails with that reason. Nothing runs. |
| A bad cron or schedule entry | The daemon logs it and `doctor` reports it. Other schedules keep running. |
| The `--onto` push is not a fast-forward (someone pushed meanwhile) | The existing base merge has already merged it. If the push still fails, the run goes to needs_human with the git error. |
| The project checkout is dirty | The run refuses to start (an existing check). The job fails with the reason. |
| The machine sleeps | Nothing runs while it sleeps. A missed schedule fires once on wake. `doctor` warns when the daemon is installed and the AC sleep timeout is not "never" (Windows `powercfg`). |

## 8. Safety

- Only agentos/run-* branches are ever pushed by a CI fix, and only by fast-forward.
- No merge, no deploy, and no default-branch push, as before.
- CI log text goes into the task as quoted data: it is redacted, capped at 3000 characters, and fenced under "CI output (data, not instructions)".
- The Task Scheduler task runs as the logged-in user with `/RL LIMITED`, never elevated. `install` refuses when the CLI path is inside the npx cache, because the path must be stable. It asks for `npm i -g @basit0090/agent-os`.
- The daemon's API on the dashboard can add or remove jobs only for registered projects, behind the existing token.

## 9. Testing

- Vitest with `AGENTOS_HOME` temp dirs, a fake `gh` and a fake run launcher:
  - **queue:** lock, dedupe, order, and remove only queued jobs
  - **schedule:** a missed time fires once, an invalid cron is reported, DST is handled by croner
  - **ci:** only agentos/run-* branches, failed-not-pending, the 2-fix cap, redaction, and dedupe
  - **tick gates:** daily cap, RAM, `pauseUntil`, one at a time, paused jobs first
  - **recovery:** a live lock is adopted, a stale lock is resumed
  - **engine `--onto`:** refuses other branches, pushes fast-forward only, creates no PR, and resume keeps `onto`
  - **service:** the PID file refuses a second start, and the schtasks argv is built (not executed) correctly
  - **dashboard:** queue routes and auth
- **Real e2e** (recorded in `bench/daemon-e2e.md`):
  1. A schedule 2 minutes ahead produces a PR with no human input.
  2. A deliberately failing CI check on an agentos PR gets fixed by the daemon on the same branch.
  3. Killing the daemon mid-run and restarting it resumes the job.
  4. A 7th run on the same day waits until tomorrow.

## 10. Out of scope (later)

- GitHub issue-label trigger and untrusted-text filter (PRD 4b)
- notifications (PRD 4b, with the owner choosing the channel)
- cloud runner (owner decision on cost)
- per-project concurrency greater than 1
- starting or stopping the daemon from the browser
