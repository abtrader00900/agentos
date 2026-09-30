# Orchestrator e2e (PRD 1 success criteria)

The automated tests use fake agents. This file records runs with the real Claude Code (2.1.278) and Codex (0.157.1) CLIs on Windows 11 with 7.4 GB of RAM, on 2026-09-30.

The scratch repos have a local bare `origin`. Their runs end at `gh pr create`, which the real `gh` rejects for a non-GitHub remote; everything up to and including the push is checked.

| # | Repo | Task | Result | PR | Fix rounds | Minutes | Notes |
|---|---|---|---|---|---|---|---|
| 1 | agentos (real GitHub) | `agentos runs --limit <n>` with tests | **pr_open** | abtrader00900/agentos#16 (reviewed, merged) | 0 | 4.2 | The planner kept it as one subtask because the 3 files are coupled. Claude wrote it and the Codex review was clean. 323 tests passed on the branch. |
| 2 | Al Madina ERP | a small feature | not run yet | | | | The ERP is in client testing. The first real ERP feature will be this row. |
| 3 | scratch | seeded failing test unrelated to the task | fix loop ✓, push ✓ | — | 3 | 7.5 | Round 1: the fixer found and fixed the unrelated `str.js` bug. The reviewer flagged it as out of scope (medium), because the task said "only add these two files". Round 2: the fixer reverted the change, and verify failed. Round 3: the fixer fixed the bug again. Codex then hit a network error ("workspace routing discovery failed") and the Claude fallback reviewed it, leaving a low note. |
| 4 | scratch | 2 independent subtasks (sum fix + multiply) | push ✓ | — | 0 | 3.2 | Claude and Codex worked in parallel. Codex ran its subtask and the review itself, with no fallback. The remote was a relative `../origin.git`, which was fixed in #15. |
| 5 | scratch | kill the engine mid-`working`, then `--resume` | resume ✓, push ✓ | — | 0 | 2.2 | `taskkill /T` on the engine PID left the status at `working`, the subtask at `running`, and the lock in place. `--resume` took over the stale lock (a `stale-lock` event was logged), re-ran the subtask and pushed. The lock file was removed at the end. |

Checks:
- [x] Two independent subtasks ran in parallel (#4). Wall-clock time against `maxWorkers: 1` was **not measured**. The scheduler's parallelism is covered by unit tests.
- [x] A run killed mid-`working` resumes with `--resume` (#5).
- [x] No run wrote to the main checkout, and no run pushed the default branch (all rows).
- [x] Fallback: a failing Codex call (bad default model, then a network error) fell back to Claude every time (#3, first scratch run).
- [ ] An ERP feature through `agentos run` (row 2).

Found and fixed along the way:
- Push and PR from the checkout root, which fixes relative remotes (#15).
- `orchestrator.models` to override a CLI's broken default model (#15).
- PR titles cut at a word boundary (0.3.0).
