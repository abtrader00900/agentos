# Orchestrator e2e (PRD 1 success criteria)

The automated tests use fake agents. This file records the checks with the real Claude Code and Codex CLIs.

| # | Repo | Task | Result | PR | Fix rounds | Minutes | Notes |
|---|---|---|---|---|---|---|---|
| 1 | agentos (scratch clone) | a small real issue | | | | | |
| 2 | Al Madina ERP | a small feature | | | | | |
| 3 | scratch repo | seeded failing test | | | | | fix loop must turn it green |

Also check these:
- [ ] `maxWorkers: 2` with two independent subtasks finishes faster than `maxWorkers: 1`.
- [ ] A run killed mid-`working` (close the terminal) resumes with `--resume` and reaches `pr_open`.
- [ ] No run wrote to the main checkout, and no run pushed the default branch.
