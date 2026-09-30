# Learning e2e (PRD 2 success criteria)

This file records runs with the real Claude Code (2.1.278) and Codex (0.157.1) CLIs on Windows 11, 7.4 GB RAM, on 2026-09-30. The automated tests use fake agents.

The scratch repo has a local bare `origin`. `gh` was a local stand-in that answers `auth status` and `pr create` without the network, so runs reach `pr_open`. Setup: `str.js` ships a bug that `test-str.js` catches, and `verify: ["node run-tests.js"]` runs every `test-*.js` file. `learning.skillAfterRuns: 2`.

| # | Repo | Runs | What to see | Result | Notes |
|---|---|---|---|---|---|
| 1 | scratch fix-loop repo | run A "add mul.js + test", then run B "add div.js + test" | A stores an `auto` lesson citing `verify_fixed`, and B's prompts and PR body show it | ✅ | A: 1 fix round (the fixer repaired `str.js`), `learned: done`, 2 `auto` lessons citing `E2: verify_fixed \`node run-tests.js\` … str.js`. B: `lessonsUsed` = both lessons, each `used` count went up, and B's retro merged into them (`seen 2`) instead of adding new ones. Both runs got the same kind, `js-util-with-test`. |
| 2 | scratch (same repo) | two successful runs of one kind | a skill draft appears, and installs only after `skill approve` | ✅ | After run B: `skill draft ready: js-util-with-test`. The draft is specific: repo shape, the auto-discovering runner, the pre-existing `str.js` failure, and a 6-step workflow. `.agentos/skills/` stayed empty until `agentos skill approve js-util-with-test`. That installed the skill and removed the draft. The checkout stayed clean. |
| 3 | Al Madina ERP | one real feature | lessons stored, and nothing pending reaches a prompt | not run yet | The ERP is in client testing. Its 0.3-era `memory.json` (66 facts, 22 pinned) loads unchanged with this build: `doctor` gives 17 pass, 0 warn. |

Checks:
- [x] **No `pending` lesson in any prompt.** No pending lesson came up in these runs. This is covered by tests: engine `recall()` excludes topic `lessons`, `lessonsFor` injects only `auto`/`approved`, and handoff skips pending lessons.
- [x] **No lesson with a URL, a shell pipe or a secret is `auto`.** This is covered by tests. Neither real lesson contained any of them.
- [x] **Old `memory.json` files still load.** Tested on the ERP (row 3). `memory_recall` marks pending lessons by the engine's rule.

What the e2e taught us:
- **A lesson can steer a run the wrong way.**
  - Run A's reviewer flagged the `str.js` repair as out of scope. The task only asked for `mul.js`, but verify could not pass without the repair.
  - So one lesson says "a subtask scoped to mul.js must not edit str.js". B's worker followed it, verify failed, and B's fixer repaired `str.js` again. B also needed 1 fix round.
  - This comes from the seeded contradiction (a broken test on `main` that no task owns). It is still the real risk of learned advice. `agentos lessons forget <key>` and the pending/approve rule exist for it.
- **Fixed in 0.4.0:** a verify failure was described by its Node stack trace, because only the last 600 characters were kept. The same evidence from two runs was also stored twice in a merged lesson. Both are fixed.
