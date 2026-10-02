# PRD 4.5 e2e: smart gates

Date: 2026-10-02 · agentos master at 22c451b (PRD 4.5 tasks merged) · Windows 11 laptop

## How PRD 4.5 was built

Three `agentos run --quick` runs, two of them in parallel. The task 3 lessons half ran beside Task 1, and its dashboard half went into Task 2's run.

| Run | Task | Time | Fix rounds | Result |
|---|---|---|---|---|
| `g45-t1` | gates module + risk config | 9 min | 0 | PR #48: code identical to the plan, review clean |
| `g45-t3a` | relevant lessons only | 19 min | 1 | PR #49. A timing test (`< 500 ms`) flaked under two parallel runs on a low-RAM laptop. The fixer replaced it with a deterministic check of the same guarantee (the size cut), which I confirmed in `safetyCheck` before merge |
| `g45-t2` | engine wiring, PR body, dashboard, README | 34 min | 1 | PR #50. The master merge mid-run triggered a full re-review, which found that a fixer's new claims could skip review when the commit was unchanged. Fixed: the review cache key now includes the agents' reports |

## Real run with the new gates

The scratch repo had a local bare origin, its own `AGENTOS_HOME` and a fake `gh`. The agents were the real Claude Code and Codex.

`agentos run --quick "Create migrations/001_notes.sql with a CREATE TABLE notes (…) statement."` reached `pr_open` in 1 min with 0 fix rounds. The PR body the engine sent:

```
**⚠️ Look here** — risky parts of this change:
- migration: migrations/001_notes.sql
…
**What the agents report:**
- task (claude):
  - Assumed: plain SQL with no dialect-specific syntax; `migrations/` is a new directory (none existed in the worktree)
  - Not verified: did not execute the SQL against any database — no engine or runner invoked
```

The worker's own account, that it never ran the SQL, now reaches the PR instead of being cut to one table cell.

## Covered by tests (fake runners)

- A `block` rule stops the run at `needs_human` and calls no `gh pr create`.
- A worker that adds `it.skip` hands the fixer a high finding, and the PR opens after the fix.
- A missing report shows as "no report".
- The reviewer prompt carries the workers' reports and the weakened-test instruction.
- Flagged PRs count as "Needs you" in the dashboard. This was also checked in the browser: the home count, the Needs-you box, and ⚠️ in the run list.
- Lessons that share no meaningful word with the task are not injected.

## Known limits

- Tampering detection reads lines, not syntax. A weakened assertion on the same line (`toBe(3)` → `toBeTruthy()`) is left to the reviewer, which is told to look for it.
- Glob rules match paths only; there is no content rule, so a migration written outside `migrations/` or `*.sql` is not flagged.
- The agent report is the agent's own word. The reviewer checks it against the diff, but NOT VERIFIED items are not re-run.
