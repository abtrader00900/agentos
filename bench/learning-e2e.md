# Learning e2e (PRD 2 success criteria)

This file records runs with the real Claude Code and Codex CLIs. The automated tests use fake agents.

| # | Repo | Runs | What to see | Result | Notes |
|---|---|---|---|---|---|
| 1 | scratch fix-loop repo | run A (a seeded failing check), then run B (a similar task) | A stores an `auto` lesson citing `verify_fixed`, and B's prompts and PR body show it | | |
| 2 | scratch | three successful runs of one kind | a skill draft appears, and installs only after `skill approve` | | |
| 3 | Al Madina ERP | one real feature | lessons stored, and nothing pending reaches a prompt | | |

Checks:
- [ ] No `pending` lesson appears in any prompt (search `events.jsonl`).
- [ ] No lesson with a URL, a shell pipe or a secret is `auto`.
- [ ] Old `memory.json` files still load, and `memory_recall` works in chats.
