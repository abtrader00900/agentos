# PRD 4 e2e: the 24/7 daemon

Date: 2026-10-01 · agentos master at 38ad588 (PRD 4 tasks 1–6 merged) · Windows 11 laptop, 7.5 GB RAM

## Setup

- A scratch repo with a local bare `origin`, its own `AGENTOS_HOME` (so nothing touched the real `~/.agentos`), and a fake `gh` on `PATH` that answers from files. No GitHub, no real PRs.
- `agent.config.yaml`: `verify: ["node test.js"]`, workers `[claude, codex]`, reviewer `codex`, and
  `daemon: { enabled: true, ciFix: true, schedules: [{ cron: "17 23 * * *", task: "Create the file hello.txt containing exactly the word hello (no newline).", quick: true }] }`.
- `~/.agentos/daemon.yaml`: `tickSeconds: 10`, `ciEverySeconds: 30` (faster than the defaults, for the test).
- Real agent CLIs (Claude Code and Codex, the owner's subscriptions).

## Results

| Check | Result |
|---|---|
| (a) A schedule fires with no human input and ends in a PR | ✅ Queued at 23:17:02 exactly once; started once memory allowed; run `…182622-bbf4` reached `pr_open` in 67 s, 0 fix rounds, $0.70 |
| (b) A failed CI check on an agentos PR is fixed **on the same branch** | ✅ Run `…183112-3794` (`--quick --onto agentos/run-…bbf4`) made `hello.txt` say `hello world`, pushed fast-forward (the owner's newer commit on the branch was kept), opened no new PR (`gh pr create` was called once in the whole test, by (a)); 126 s, $1.01 |
| (c) Stopping the daemon mid-run, then starting it again | ✅ `daemon stop` left the run going (its engine lock stayed live); the new daemon adopted it; the job was recorded |
| (d) The daily cap | ✅ With `maxRunsPerDay: 3` and 3 runs started, a 4th job stayed `queued`; `daemon status` showed `runs today: 3 / 3` |
| Second start refused, stop by token | ✅ `daemon start` while running: "already running (pid …)"; stop never kills by PID |

Total agent cost of the test: $2.68 (three runs).

## What the test found (fixed in PR #44 before the release)

1. **Silent wait for memory.** The scheduled job sat queued for 8 minutes: the laptop had 299 MB free and the gate needs `orchestrator.minFreeMemoryMb` (1500 by default). Nothing said so. The daemon now logs `job … waits for memory: 299 MB free, 1500 MB needed` once per job. On this laptop the gate had to be lowered for the test.
2. **Two daemons recorded one result.** After `daemon stop` the old process lingers until its run ends; both it and the adopting daemon logged the result. Now the old one defers only when a newer daemon actually holds the lock (and still records it when none does, so no job is stuck `running`).
3. **`--quick` merge message.** The single subtask was named `main`, so its merge commit read "agentos: merge main" on a CI-fix branch. It is named `task` now.

## Worth noting

- **The CI-fix agent refused a fake failure.** The first CI log was invented (it named an assertion that no test contained). The worker checked `test.js`, found no such test, and stopped at `needs_human` instead of "fixing" a phantom by changing correct code. CI output is treated as data, not instructions. The second, real failure (a stricter test pushed to the PR branch) was fixed.
- **Rate limit / API errors.** During PRD 4 Task 6 a Claude API outage (10 retries) paused the run; `agentos run --resume` continued it later from where it stopped. The daemon does the same on its own after `pauseMinutesOnLimit`.

## Known limits

- The machine must be awake: a sleeping laptop runs nothing (doctor warns when Windows sleeps on AC power).
- The memory gate uses the per-project `orchestrator.minFreeMemoryMb`; on an 8 GB laptop with apps open, lower it or close apps for night runs.
- The lock-takeover fencing is per job (compare-and-swap) plus the engine's per-run lock; a takeover in the instant between the check and the launch can still start one run late (documented in `daemon.ts`).
