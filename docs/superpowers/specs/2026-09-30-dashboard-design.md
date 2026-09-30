# PRD 3: Dashboard (`agentos ui`)

Status: draft for owner review · 2026-09-30 · target release 0.5.0 · builds on 0.4.0

**Built by agentos itself:** each plan task is implemented with `agentos run` on this repo, then reviewed and merged like any PR.

## 1. Why

agentos can plan, build, review, fix, open PRs and learn. Today you can only follow any of it from a terminal:
- `agentos runs`
- `events.jsonl`
- `agentos lessons`

The owner runs several projects (the ERP, agentos, client apps) and wants one place to:
- see what every project's agents are doing, live
- see what needs a decision
- give new work
- approve lessons and skills

## 2. Decisions (agreed with the owner)

1. **Form.** `agentos ui` serves a local web app. It is Node's `http` server plus plain HTML, CSS and JS: no framework, no build step, no new dependency. The frontend files ship in the npm package.
2. **Full control from the browser.** You can start a run, cancel or resume one, approve, forget or promote a lesson, and approve or reject a skill draft. Every action calls the same functions as the CLI.
3. **Security from day one.** The server binds to loopback only, uses a fresh random token each session, keeps it in a cookie, checks Host and Origin, and protects against CSRF. This is the lesson of the OpenClaw control-UI RCE.
4. **All projects in one dashboard.** Projects register themselves in `~/.agentos/projects.json`. A project switcher and an "All projects" page read each project's own files, and no project's data is copied into another.
5. **English labels.** Every label lives in one dictionary (`labels.js`) so another language can be added later.
6. **Sidebar layout.** The mockups were approved in the brainstorm (sidebar layout, run detail, all projects, lessons, new run). The run detail also shows the raw agent output behind a toggle, and the code diff.

## 3. Components

### Server: `src/ui/`

| File | Responsibility |
|---|---|
| `projects.ts` | Registry `~/.agentos/projects.json`, holding `{ id, name, path, addedAt, lastSeen }`. `id` is `slug(basename)-<4 hex of sha1(path)>`. `registerProject(root)` is called by `agentos run` and `agentos ui`. `listProjects()` marks folders that no longer exist as `missing`. `removeProject(id)` deletes an entry. |
| `server.ts` | `createUiServer({ port, token, home? })` returns an `http.Server` bound to `127.0.0.1`. It handles auth, Host and Origin checks, security headers, static files from the packaged `ui/` directory, and routing to `api.ts` and `live.ts`. |
| `api.ts` | Pure handlers `(project, params, body) → { status, json }`, for both reads and actions (section 5). |
| `live.ts` | SSE for one run's `events.jsonl`. It sends the existing lines from `since` onward, then polls the file every 500 ms for new lines. It sends a heartbeat every 15 s and uses `id:` = the line number so `Last-Event-ID` can resume. |
| `usage.ts` | `runUsage(root, runId) → { costUsd?: number; inputTokens: number; outputTokens: number; byAgent: {...} }`. It parses the agent lines in `events.jsonl`: Claude `{"type":"result",…,"total_cost_usd","usage":{input_tokens,output_tokens,…}}` and Codex `{"type":"turn.completed","usage":{input_tokens,output_tokens,…}}`. Codex reports no dollars, so it shows tokens only. |

### Frontend: `ui/` (shipped as is)

- `index.html`: the shell, sidebar and main area. It loads `labels.js` and `app.js`.
- `app.js`: plain JS with a hash router (`#/`, `#/p/<id>/runs`, `#/p/<id>/runs/<run>`, `#/p/<id>/lessons`, `#/p/<id>/drafts`, `#/p/<id>/new`).
  - It **never uses `innerHTML`**. All dynamic text goes through `textContent` or DOM builders.
- `style.css`: a responsive layout. Below 760 px the sidebar collapses behind a menu button.
- `labels.js`: `window.LABELS = { runs: "Runs", … }`, and every visible string comes from it.

### CLI

- `agentos ui [--port 4455] [--no-open]`:
  - registers the current project
  - starts the server
  - prints `agentos dashboard: http://127.0.0.1:<port>/?t=<token>`
  - opens the browser unless `--no-open`: `cmd /c start "" <url>` on Windows, `open` on macOS, `xdg-open` on Linux
  - stops on Ctrl-C
- If the port is taken, it exits with `port <n> is in use — try: agentos ui --port <n+1>`.
- `agentos run` also calls `registerProject(root)`.

## 4. Screens (approved mockups)

1. **All projects (home).**
   - One card per project: running count, needs-you count, pending lessons, drafts, and this week's runs, PRs and cost.
   - A **Needs you** list linking to each item: `needs_human` or `failed` runs, pending lessons, and skill drafts.
2. **Runs** (per project). A table of task, status, fix rounds, cost and age, newest first, with a **+ New run** button. It refreshes every 5 s while any run is active.
3. **Run detail.**
   - The header: task, status, round, elapsed time, cost and agents, plus **Cancel** (active runs) or **Resume** (paused, or interrupted with no live lock).
   - A stage bar: queued → planning → working → verifying ⇄ fixing → PR → learning.
   - Subtasks (id, agent, status).
   - The last verify result and its failing command line.
   - Review findings.
   - Lessons used.
   - The PR link.
   - The live events stream, as SSE lines rendered one per row.
   - **Show agent output**, a toggle that shows each agent's full lines.
   - **Diff**, loaded on demand.
4. **Lessons.**
   - Pending first, each with **Approve** and **Forget**. Lessons the safety filter held show a ⚠ with the reason.
   - Active lessons (auto or approved) show uses, **Promote** and **Forget**.
5. **Skill drafts.** The kind, the description and the full `SKILL.md` as text, with **Approve** and **Reject**.
6. **New run.**
   - A task textarea.
   - The effective orchestrator config, read-only.
   - A preflight warning shown before submitting (dirty checkout, `gh` not logged in, CLI missing).
   - **Start run**.

## 5. API

Every `/api/*` request needs the session cookie (or the header `Authorization: Bearer <token>`). `:p` is a project id from the registry and never a path. Each project's data is read with that project's `root`.

| Method | Path | Returns / does |
|---|---|---|
| GET | `/api/projects` | `[{ id, name, missing, running, needsYou, pendingLessons, drafts, week: { runs, prs, costUsd } }]` |
| GET | `/api/p/:p/runs` | `runLine`-style rows plus status, fixRound, createdAt and costUsd |
| GET | `/api/p/:p/runs/:id` | The full `RunState` (redacted fields as stored), plus `usage`, `lessonsUsed`, `active` (a live engine lock) and `canResume` |
| GET | `/api/p/:p/runs/:id/events?since=N` | SSE (section 3, `live.ts`) |
| GET | `/api/p/:p/runs/:id/diff` | `git diff <base>..<branch>` from the project root, capped at 300 KB and marked `truncated` when cut. Returns 404 when the branch is gone. |
| GET | `/api/p/:p/lessons` | Every lesson with status, meta and the safety verdict |
| GET | `/api/p/:p/drafts` | `[{ kind, description, text }]` |
| GET | `/api/p/:p/preflight` | `{ ok, problems: string[] }`: orchestrator block, CLIs on PATH, clean checkout, `gh auth` |
| POST | `/api/p/:p/runs` | Body `{ task }`, where the task is 3–2000 chars. Runs the preflight, then starts `agentos run --id <id> -- <task>` detached (the existing `spawnDetachedRun`), and returns `{ id }` |
| POST | `/api/p/:p/runs/:id/cancel` | `cancelRun` |
| POST | `/api/p/:p/runs/:id/resume` | Spawns `agentos run --resume <id>` detached. Refused while the run's lock holds a live PID. |
| POST | `/api/p/:p/lessons/:key/(approve\|forget\|promote)` | `approveLesson`, `forgetLesson` or `promoteLesson` |
| POST | `/api/p/:p/drafts/:kind/(approve\|reject)` | `approveDraft` or `rejectDraft` |
| DELETE | `/api/projects/:p` | Removes the registry entry. No files are touched. |

Errors come back as `{ error: string }` with status 400, 401, 403, 404, 409 (a lock or a precondition) or 500. The message is the same text the CLI would print.

## 6. Security

- **Loopback only.** `listen(port, "127.0.0.1")`, with no option to bind anywhere else.
- **Token.**
  - 32 random bytes as hex, new for each `agentos ui` process.
  - `GET /?t=<token>` sets `agentos_ui=<token>; HttpOnly; SameSite=Strict; Path=/`, then redirects with 303 to `/`, so the token leaves the address bar.
  - Every other request needs the cookie or the bearer header, compared in constant time with `timingSafeEqual`.
  - Without it: static files return 401 with a short "open the URL printed by `agentos ui`" page, and the API returns 401 JSON.
- **Host check.** The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`, otherwise 403. This stops DNS rebinding.
- **CSRF.** Every state-changing request (POST or DELETE) needs `Origin` equal to `http://127.0.0.1:<port>` or `http://localhost:<port>`, and `Content-Type: application/json`. Otherwise 403 or 415. No CORS headers are ever sent.
- **Headers on every response:**
  - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `Cache-Control: no-store` on the API
- **Static files** come only from the packaged `ui/` directory. The path is normalized, and anything outside that directory returns 404.
- **Projects** are resolved only through the registry id. Run ids, lesson keys and draft kinds are validated with the existing regexes before any file access.
- **No `innerHTML`** in `app.js`. A test fails if it appears.
- **The request body** is capped at 16 KB.

## 7. Errors

| Case | Behaviour |
|---|---|
| A registered folder no longer exists | Its card shows "missing" with a Remove button. The API returns 404 for its data. |
| An unreadable or corrupt `state.json` | That run is listed as `unreadable`, and the rest of the list still works. |
| The SSE connection drops | `EventSource` reconnects with `Last-Event-ID`, and the server resumes from that line. |
| The dashboard stops | Runs are separate processes and keep going. |
| The port is in use | A clear error suggesting `--port`. |
| A preflight fails on New run | The problems are listed and nothing is started. |

## 8. Testing

- **Server** (vitest, real `http` requests to `127.0.0.1:0`):
  - the token and cookie flow, and a 401 without them
  - a 403 on a wrong Host or Origin, and a 415 on a wrong content type
  - a 404 on static path traversal
  - project ids that map only through the registry
  - SSE sending existing lines, then an appended line, then resuming from `Last-Event-ID`
  - `usage` from fixture Claude and Codex lines
  - the diff cap
  - every action reaching its function, with the run spawner injected as a fake
  - `DELETE` touching no files
- **Registry:** register, dedupe by path, mark missing, and remove.
- **Frontend lint test:** `ui/app.js` contains no `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `eval`.
- **Browser check (controller):** the in-app browser opens `agentos ui` against the ERP and agentos. Check every screen, one live run started from the browser, and the approve and forget buttons.

## 9. How it is built

The plan's tasks are each sized for one `agentos run` on this repo:
- verify: `npm test` and `npx tsc --noEmit`
- workers: Claude and Codex
- reviewer: Codex

Each run opens a PR. The controller session reviews it (tests, a Claude reviewer, Codex) and the owner merges it. If a run ends in `needs_human`, the controller narrows the task and runs it again, and fixes it by hand only as a last resort.

The final bench file records how many tasks agentos completed alone. Honest counts only.

## 10. Success criteria

- `agentos ui` opens the dashboard with a fresh token, and every screen works for the ERP and agentos projects.
- A run started from the browser streams live and reaches `pr_open`.
- Every security test is green, and there is no `innerHTML` in `app.js`.
- At least 5 of the plan's tasks were completed by `agentos run`, each ending in a reviewed, merged PR.

## 11. Out of scope

- Remote or phone access over the network (loopback only).
- User accounts.
- Editing config from the UI.
- An Urdu translation (the dictionary is ready).
- Charts.
- Notifications (PRD 4 covers daemons and triggers).
