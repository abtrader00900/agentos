# Dashboard e2e (PRD 3)

PRD 3 was built task by task by `agentos run` on this repository. Claude Code 2.1.278 and Codex 0.157.1 ran on Windows 11 with 7.4 GB RAM, 2026-09-30 to 2026-10-01. The controller session reviewed each PR before merge: local tests, a Claude reviewer, Codex, GitHub CI (7 checks), and a browser check for UI changes.

| Run | Task | Result | Minutes | Fix rounds | Agents | Cost¹ | PR |
|---|---|---|---|---|---|---|---|
| dash-t1 | 1 · project registry | pr_open | 25 | 2 | claude | – | #21 |
| dash-t1-fix | Codex follow-ups (lock owner, win32 case) | pr_open | 34 | 3 | claude+codex | – | #22 |
| dash-t2 | 2 · secure server + `agentos ui` | pr_open | 26 | 1 | claude+codex | – | #23 |
| ci-fix | CI repair (8.3 paths) + `orchestrator.build` | pr_open | 11 | 0 | claude+codex | – | #24² |
| dash-t3 | 3 · read API + usage | pr_open | 30 | 1 | claude+codex | – | #25 |
| dash-t4 | 4 · live events (SSE) + 2 fixes | pr_open | 16 | 0 | claude+codex | $5.75 | #26 |
| dash-t5 | 5 · actions API + 3 fixes | pr_open | 44 | 2 | claude+codex | $6.19 | #27 |
| dash-t6 | 6 · frontend part 1 | **needs_human** | 44 | 3 | claude+codex | $6.25 | #28³ |
| dash-t78 | 7+8 · frontend part 2 + docs | pr_open | 16 | 0 | claude+codex | $4.75 | #29 |
| 20261001094616-d90f | **started from the dashboard** · live.ts replacement detection | pr_open | 31 | 2 | claude | $8.81 | #30 |
| ui-start-retry | "Starting…" retry on a new run | pr_open | 15 | 1 | claude | $4.39 | #31 |

**Totals:**
- 11 runs. 10 reached `pr_open` on their own, and 1 stopped at `needs_human`.
- The average run took about 27 minutes.
- Every merged PR had all 7 CI checks green, from #24 on.

¹ Cost comes from Claude's `total_cost_usd` in the run's `usage` events. That is an API-equivalent figure; on a subscription it counts against plan limits and is not billed. Runs before `usage` events existed (through dash-t3) show "–". Codex reports tokens only.

² In #24 the controller rebuilt `dist/` by hand, because #21–#23 had merged with stale `dist/` and CI red. From #25 on, `orchestrator.build` rebuilt it automatically.

³ dash-t6 used its 3 fix rounds. Each round the reviewer found a new live-refresh issue. The last one, a repaint on every streamed agent line, was fixed by the controller in one commit.

## Checks

- [x] Every screen was checked in a browser against real data from the agentos project: All projects, Runs, Run detail (live events, agent-output toggle, diff), Lessons, Skill drafts and New run. The console had no errors. The ERP project has not been used with `agentos run` yet.
- [x] A run started from the browser (**New run → Start run**) streamed live in Run detail and reached `pr_open` (#30).
- [x] The security tests pass: token and cookie bootstrap, Host and Origin checks, content type, 16 KB cap, path traversal, no `innerHTML` and no inline script.
- [x] "Starting…" retries 15 times about once a second, then shows "no such run" (measured in the browser).

## What the e2e taught us

- **The reviewer earns its time.** It caught lock races (#22), an unbounded diff buffer (#25) and a `ctimeMs` identity that would have reset the stream on every append (#30, a bug in the controller's own task text). It also caught several live-refresh gaps (#28).
- **The cost is speed.** A run takes 11–44 minutes. Planning takes about 4, and each verify plus review takes 3–4. Fix rounds dominate. Combining small tasks (dash-t78) and a slimmer local verify (CI runs the full suite) brought runs down to about 15 minutes.
- **The owner's own review is still needed.** CI was red on #21–#23 because the controller had not checked `gh pr checks` before saying "merge". The gate now requires it.

## Known limits

- `live.ts`: a `Last-Event-ID` resume across a replaced log can skip lines. Windows file ids above 2^53 lose precision in `ino`, and NTFS tunnelling can keep the birth time. An in-place overwrite of the same size or larger is not detected. `agentos` only appends to `events.jsonl`, so none of these happen in practice.
- One browser session saw about 2,700 repeated run requests in 20 s. It could not be reproduced, and both reviewers found no loop in `app.js`. A stale tab from an earlier dashboard instance is the likely cause.
- The 15 s "Starting…" retry also applies when a project link is wrong. A missing project shows "Starting…" before the error.
