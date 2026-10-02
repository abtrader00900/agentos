# PRD 4.5b: a local decider (jevos)

Status: draft for owner review · 2026-10-02 · target release 0.8.0 · builds on 0.7.0 (smart gates)

**Built by agentos itself:** each plan task is one `agentos run` on this repo; the controller reviews and merges every PR.

## 1. Why

Two decisions in `agentos run` are made by fixed rules or not at all.

- **Plan or not?** The planner costs about 2–5 minutes per run. `--quick` skips it, but only when the owner remembers to pass it.
- **What does the diff do?** The PRD 4.5 risk gate reads paths only. A payment change in `src/orders.ts` or a `DELETE FROM` in a service file carries no flag.

Both are small yes/no questions about text. A local yes/no model answers them in tens of milliseconds, on the CPU, with no paid API. **jevos-v2** (github.com/feder-cr/jev, MIT) is such a model: one binary plus an int8 model. Its own benchmark is 80.3% right on 999 hand-written yes/no questions, at 25–110 ms on a laptop CPU.

80% is not a safety gate. So the decider only ever **adds**: it can choose `--quick` and add a ⚠️ flag. It never blocks, and it never removes a check. When it is not installed or not running, agentos behaves exactly as in 0.7.0.

## 2. Decisions (agreed with the owner, 2026-10-02)

1. **Uses:**
   - **A:** decide `--quick` automatically.
   - **B:** content-level risk flags.
   - Lesson relevance is not in scope.
2. **agentos manages jevos.**
   - `agentos decider install`, run by the owner, downloads it. Running the command is the owner's consent to the download.
   - `agentos decider start|stop|status` runs the server.
   - The daemon does not start the decider on its own.
3. **Thresholds:**
   - Auto-quick when P(yes) ≥ `quickAbove` (0.8).
   - A content flag when P(yes) ≥ `riskAbove` (0.6).
   - Both are configurable and get tuned by the e2e eval.
4. **No paid API, no new npm dependency.** The jevos binary is downloaded at runtime from its GitHub release and checked against the release's `SHA256SUMS.txt`.

## 3. Memory: read this before starting it

The jevos README says the server needs about **1 GB** once the model is loaded, and **up to 1.4 GB** with its cache of recent texts full. The owner's laptop (7.5 GB) often has 500–700 MB free with apps open.

- `agentos decider start` refuses when free memory is below 1200 MB. `--force` starts it anyway.
- `doctor` reports the decider's state and the free memory.

## 4. Components

### `src/decider/client.ts`

```ts
export interface DeciderConfig { autoQuick: boolean; contentRisk: boolean; quickAbove: number; riskAbove: number; url: string }
export type Questions = Record<string, string>;      // name → yes/no question
/** P(yes) per question, or null when the decider is off, unreachable, slow (> 3 s) or answers malformed JSON */
export async function ask(cfg: DeciderConfig, state: string | object, questions: Questions, key?: string): Promise<Record<string, number> | null>
```

- Wire format: `POST {url}/v1/systemone` with `{ model: "jev-latest", state, questions: { name: { type: "noul", instructions } } }`.
- Response: `{ answers: { name: { type: "noul", noul: <0..1> } } }`.
- When `~/.agentos/jevos/key` exists, the client sends `Authorization: Bearer <key>`.

### `src/decider/install.ts`

`agentos decider install` does the following.

1. **Picks the asset for this platform:**
   - `jev-windows-x64.zip` (≈ 20 MB)
   - `jev-linux-x64.tar.gz` (≈ 27 MB)
   - `jev-macos-arm64.tar.gz` (≈ 22 MB)
   - plus `jevos-v2-openvino-int8.zip` (≈ 630 MB)
2. **Asks first, before downloading.** It prints the total size (≈ 650 MB) and the target folder, and waits for the owner to type `y`. `--yes` skips the question.
3. **Downloads** from `https://github.com/feder-cr/jev/releases/download/jevos-v2/<asset>`, streamed to `~/.agentos/jevos/<asset>.part`.
4. **Checks** each file's SHA-256 against `SHA256SUMS.txt` from the same release. On a mismatch it deletes the file and fails.
5. **Unpacks** with the system `tar`. Windows 10 and later ship `tar.exe`, which reads zip files. The program goes to `~/.agentos/jevos/jev/` and the model to `~/.agentos/jevos/jev/model/`. It then deletes the archives.
6. **Writes `~/.agentos/jevos/version`** (`jevos-v2`). A second `install` sees it and does nothing unless `--force` is given.

All paths are under `agentosHome()`, so tests use `AGENTOS_HOME`.

### `src/decider/service.ts`

- **`start`:**
  - It refuses when nothing is installed.
  - It refuses when free memory is below 1200 MB, unless `--force`.
  - It writes a random API key to `~/.agentos/jevos/key`.
  - It spawns `jev serve --host 127.0.0.1 --port 8017` detached and hidden, with `JEV_API_KEY=<key>`, cwd `~/.agentos/jevos/jev`, and the log in `~/.agentos/jevos/jev.log`.
  - It waits up to 60 s for `GET /health` to report `"ready"`.
- **`stop`:** it ends the process recorded in `~/.agentos/jevos/jev.pid`, but only if `GET /health` on the configured URL answers. It never kills a bare PID it cannot confirm. The pid file and the key are removed.
- **`status`:** reports whether it is installed, whether `/health` answers, its pid and its memory note.

### Configuration (`agent.config.yaml`, global `~/.agentos` layer or per project)

```yaml
decider:
  autoQuick: true
  contentRisk: true
  quickAbove: 0.8
  riskAbove: 0.6
  url: http://127.0.0.1:8017
```

`deciderSchema` gives these defaults, and the whole block is optional. Without a running decider, the values do nothing.

### Engine wiring

- **A, auto-quick.**
  - Where: `startRun`, only when the caller did not pass `quick` and did not pass `onto`. A CI fix is already quick.
  - Question: *"Can one developer finish this whole task as a single focused change, without splitting it into separate parts?"*, asked with the task text as the state.
  - Effect: P ≥ `quickAbove` sets `quick: true`. Every answer is logged as `{ type: "decider", use: "auto-quick", p, quick }` and stored as `RunState.autoQuick = { p }`.
  - PR body: a line `**Planner:** skipped by the decider (jevos 0.91)`.
  - An explicit `quick: false` cannot be expressed from the CLI today. `--plan` is added to force the planner.
- **B, content risk.**
  - Where: in `gate()`, after the path rules.
  - State: the added lines of `git diff base..HEAD`, capped at 20,000 characters. jevos reads up to 8,192 tokens.
  - Questions:
    - `money`: *"Does this change touch money: prices, payments, invoices, balances or billing?"*
    - `data-loss`: *"Does this change delete or overwrite stored data, or drop database tables or columns?"*
    - `access`: *"Does this change alter who can log in or what a user is allowed to do?"*
  - Effect: each P ≥ `riskAbove` adds `RiskFlag { rule: "jevos:<name>", action: "flag", files: [] }` with `p`. The PR body shows `- jevos:money (82%)`.
  - Never `block`.
- **Failure.** Whenever `ask()` returns null, the run logs `{ type: "decider", use, skipped: true }` once and continues as in 0.7.0.

### CLI and doctor

- New commands: `agentos decider install [--yes] [--force]`, `agentos decider start [--force]`, `agentos decider stop`, and `agentos decider status`.
- `agentos run` gets `--plan`, which forces the planner.
- `doctor` gets a `decider` check: not installed / installed but stopped / running (pass), with the free-memory figure.

## 5. Errors

| Case | Behaviour |
|---|---|
| Decider not installed or not running | `ask()` returns null; the run continues; one `decider skipped` event |
| Slow (> 3 s) or malformed answer | The same as not running |
| Download interrupted | The `.part` file is removed; install fails with the reason; a rerun starts over |
| SHA-256 mismatch | The file is deleted; install fails naming the asset; nothing is unpacked |
| No `tar` on the system | Install fails with the manual unpack instructions from the jevos README |
| Low memory at `start` | Refused, with the numbers, unless `--force` |
| `stop` when `/health` does not answer | Nothing is killed; it reports "not running (stale pid file removed)" |

## 6. Testing

- **client:** a local fake HTTP server answers the wire format. Cases: the probabilities come back; a missing server gives null; a 4 s delay gives null; bad JSON gives null; the Bearer key is sent when present.
- **install:**
  - Runs against a fake release served from a temp HTTP server, through the same `download(url)` function the real install uses, passed in.
  - Cases: a good hash unpacks, using a tiny zip or tar.gz made in the test; a bad hash deletes and fails; a second install is a no-op; asking without `--yes` reads stdin.
- **service:** spawn args and env, refused at low memory, `stop` never kills without a `/health` answer. A fake `jev` script stands in for the binary.
- **engine** (fake runners and a fake decider):
  - auto-quick at 0.9 skips the planner, and the PR body says so
  - at 0.5 the planner runs
  - an explicit `--quick` or `--plan` wins over the decider
  - `onto` is never asked
  - content risk at 0.82 adds `jevos:money` to `s.risk` and the PR body
  - a decider failure changes nothing
- **Real e2e** (`bench/decider-e2e.md`), after the owner runs `agentos decider install`:
  1. 10 task texts (5 clearly small, 5 clearly multi-part) through the auto-quick question.
  2. 6 diffs (2 money, 2 data-loss, 2 neither) through the content questions.
  3. Record the probabilities, accuracy and latency.
  4. Adjust `quickAbove` and `riskAbove` if the eval says so.
  5. Then one real `agentos run` without `--quick` on a small task, to confirm the skip.

## 7. Out of scope

- Lesson relevance by the decider.
- Model routing (PRD 5).
- Starting the decider from the daemon.
- Training our own decider model, which the owner mentioned as the fallback if jevos disappoints.
- GGUF/llama.cpp builds.
