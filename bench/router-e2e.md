# PRD 5 e2e: the model router

Date: 2026-10-06 · Laptop: Windows 11, 7.5 GB RAM · CLIs: Claude Code, Codex 0.160.1, agy 1.2.17

## How PRD 5 was built

Each plan task ran as one `agentos run` on this repo. "Hand fixes" are what the controller (Claude, in chat) changed after the run, mostly from Codex review rounds.

| Run | Task | Result | Minutes | Fix rounds | PR | Hand fixes |
|---|---|---|---|---|---|---|
| r5-t1 | 1: quota store, allowlist, fallback chain | needs_human | 77 (incl. two resumes) | 3 | #61 | The Codex worker hit Codex's Windows sandbox bug, so its subtask was moved to Claude by hand. Fixed one bad test fixture. Codex review found 7 issues: authorship, runner-less agents, stale `resumeAt`, report attribution. |
| r5-t23 | 2 + 3: read-mode guard, per-role models | pr_open | 29 | 1 | #62 | A model name starting with `-` reached argv. The guard now also restores the run worktree. |
| r5-t4 | 4: `agentos quota`, doctor lines, UI events | pr_open | 18 | 1 | #63 | none |
| r5-noop | no-change fallback (found in r5-t1) | pr_open | 22 | 1 | #65 | none |
| r5-t5 | 5: gemini agent (agy) | pr_open | 15 | 0 | #66 | Preflight checked a binary named `gemini` instead of `agy`. agy can exit 0 without a result. Relative agy.exe fallback. Fallback agents were not preflighted. |
| r5-e2e1 | README "Model router" section | pr_open | 13 | 1 | #67 | Five rounds of wording fixes so the docs match the code. |
| r5-fix2 | shell rule in prompts, partial-edit authors | pr_open | 15 | 0 | #68 | Per-attempt worktree fingerprint. One controller commit broke tsc; it was fixed before merge. |

Token use per run is in each run's `usage` events. For example, r5-t5 used Claude 7.7 M and Codex 0.18 M tokens.

## The fallback chain, live

**Setup:**
- `quota.json` marks Claude as limited for 2 hours.
- `agents: [claude, codex, gemini]`
- `workers: [claude]`, `reviewer: codex`
- gemini models `{ read: gemini-3.1-pro-high, write: gemini-3.8-flash-high }`

**What happened (r5-e2e2 and r5-e2e3, the same small task):**
- **The run did not pause.** With Claude limited, Codex planned the run (its read-only sandbox works).
- **The worker call walked the chain:** Claude was skipped (limited), Codex wrote nothing (its write sandbox is broken on this laptop: `helper_unknown_error`), so a `no-change` fallback went to Gemini.
- **Gemini read the files** with `view_file`, then tried `run_command` to run the tests. agy's headless mode ends the whole turn when a tool needs a permission it cannot ask for, so Gemini stopped with no edits.
- **The run ended `needs_human`**, correctly: nothing was produced, and nothing was claimed as done.

## Probe facts (agy 1.2.17)

- **Prompt on stdin only as NDJSON**, `{"event":"user","message":{"content":"…"}}`, with `--input-format stream-json --output-format stream-json`. `-p` takes the prompt as an argv value, so agentos never uses it.
- **The result line** is `{"event":"result","result":{"status":"SUCCESS"|"ERROR","response":"…","usage":{…},"denied_actions":[…]}}`.
- **`--mode plan` is not read-only.** It wrote a file in a test. The read-mode guard (a disposable worktree) is what protects the run.
- **`--mode accept-edits --sandbox`** writes files and denies `RunCommand`.
- **A broken plugin hook can block every tool.** A Google Cloud telemetry hook installed by the Antigravity IDE did this on this laptop. It was disabled with the owner's approval.

## Known limits

1. Gemini as a **worker** needs allow-rules in agy's permission grants for the commands it will want, such as the test command. Without them, its turn ends at the first command.
2. Codex cannot **write** on this laptop until OpenAI fixes the Windows sandbox (openai/codex#37940). It still plans and reviews.
3. `--mode plan` does not stop agy from writing. Only the read-mode guard does.
