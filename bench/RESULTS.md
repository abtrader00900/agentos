# agentos token benchmark

**Question.** Does agentos (generated CLAUDE.md rules + the memory / supersearch / codegraph MCP servers) make Claude Code use fewer tokens for the same work, at the same or better correctness?

**Answer, for this repo (Sonnet 5, 3 runs per task per arm):** only where one of its tools answers the question directly.

- **"What breaks if I change X"** is a large win: `codegraph_impact` answered in 3 turns every time. That is **−72 % tokens and −67 % cost** against a baseline that needed 13–40 turns of grepping. It was also more reliable: 4/4 correct, against 3/4 for baseline (pilot included).
- **Recalling a stored project fact** did not happen. The answer was seeded in agentos memory, but the model never called `memory_recall`. It guessed, as baseline did, and both arms got it wrong in every run (0/4 each). agentos cost +2 % tokens here for nothing.
- **Locating code** cost more with agentos: **+25 % tokens, +13 % cost**. `supersearch_text` did the same job as the built-in Grep, plus an extra ToolSearch round trip to load the tool.
- **A small bug fix** came out −25 % tokens, but the agentos arm called no agentos tool at all, and the pilot run went the other way (+13 %). Treat this as noise.
- **Fixed overhead** is small: **+656 tokens per session** (+2 % on a no-op prompt, +$0.003). Claude Code defers MCP tool schemas, so only the tool names and CLAUDE.md sit in context.

Summed over the five tasks, agentos used 31 % fewer tokens and cost 24 % less. That total is almost entirely the impact task. With impact and fix left out, agentos cost **+16 % tokens**.

A variant that adds one rule telling the agent to call `memory_recall` for why/how questions turned recall from **0/3 to 3/3 correct**, at $0.071 per question (baseline: $0.055 for a wrong answer). The rule also caused an unneeded memory lookup in 2 of the 6 locate and fix runs. See [Memory-first variant](#memory-first-variant-not-what-agentos-generates-today).

**0.2.1** applies these findings. On re-running recall and locate: recall went from **0/3 to 2/3**, and locate went from **+25 % to +2 % tokens** against baseline. See [0.2.1 follow-up](#021-follow-up-recall-and-locate-only).

## Setup

| | |
|---|---|
| Target | this repo at `db4db8b` (release 0.2.0, 201 files: 35 TypeScript files in `src/`, 64 TS/JS files outside `dist/`). The commit is pinned, so the copies never contain `bench/` |
| Copies | a fresh copy for every run: `git archive db4db8b` → task setup → arm files → `git init` + one commit. `node_modules` is copied once per invocation and junction-linked into each copy |
| Arm **agentos** | `agent.config.yaml` = the `agentos init` template: its two default rules (`run-tests-first`, `no-guessing-deps`) and its three `npx -y @basit0090/agent-os mcp …` servers, with only name, description and stack filled in and the template's Laravel skill removed. Then `agentos sync --only claude-code` generates `CLAUDE.md` and `.mcp.json`, the `.gitignore` gets the lines `agentos install` adds, and `.agentos/memory.json` is seeded with 6 facts the maintainers' memory already held (npm name, why `dist/` is committed, PR-only workflow, CI matrix, Windows ripgrep quirk, Node-20 test command) |
| Arm **baseline** | the same code with no agentos files. `--mcp-config` points to `{"mcpServers":{}}` |
| Model | `claude-sonnet-5`, default effort, Claude Code 2.1.278, agentos MCP 0.2.0 (npm), Windows 11, Node 26 |
| Runs | pilot: 1 per task per arm, one run at a time. Full: 3 per task per arm, 2 runs at a time. Arms are interleaved, with the arm order flipped per task and rep so that neither arm always gets the warmer prompt cache |
| Metrics | taken verbatim from `claude -p --output-format stream-json`: `modelUsage` (all models, subagents included) and `total_cost_usd` (API list price). *Total tokens* = input + cache creation + cache read + output. Nothing is estimated |

### Isolation: the same global context for both arms

The developer machine has many plugins, skills, hooks and MCP servers. Without isolation, a one-word prompt starts at **71,168 tokens**: 264 tools, 76 MCP servers, 361 skills and 20 hook events. With the flags below it starts at **36,836 tokens**: the 27 built-in tools, no skills, no hooks and no MCP servers. Both arms get exactly the same flags. The only difference is which file `--mcp-config` points to.

```
claude -p "<task>" --output-format stream-json --verbose --model claude-sonnet-5
  --setting-sources project      # no user settings → no user plugins, hooks, env or model overrides (the copies have no project settings)
  --disable-slash-commands       # no skills
  --strict-mcp-config --mcp-config <.mcp.json | empty>   # no user or claude.ai MCP servers
  --no-session-persistence --max-budget-usd 3
  --allowedTools Read Grep Glob Edit Write Bash PowerShell mcp__memory mcp__supersearch mcp__codegraph
```

All `CLAUDE*` / `ANTHROPIC*` environment variables are removed before the nested `claude` starts. Otherwise the child inherits the host session's auth and fails. `--bare` would give even stricter isolation, but it accepts only `ANTHROPIC_API_KEY` auth, and it turns off CLAUDE.md discovery, which the agentos arm depends on. Claude Code's own auto-memory stays at its default (on). Every copy lives at a new path, so it always starts empty.

## Tasks and their checks

A task counts as done only if its automatic check passes. A cheap wrong answer is a failure.

| task | tests | prompt (short) | check |
|---|---|---|---|
| overhead | fixed per-session cost | "Reply with the single word OK." | answer contains `OK` |
| recall | memory | why `dist/` is committed, and which package.json scripts must never be added | the `SCRIPTS:` line names ≥5 of preinstall/install/postinstall/prepare/prepack/build, and the answer mentions the nested/git install. The fact is seeded in memory and also discoverable in the repo (a regression-test comment and the CHANGELOG) |
| impact | codegraph | which files under `src/` break if `src/core/jsonstore.ts` changes, transitive importers included | the `FILES:` line contains all 7 dependents. `tsparser.ts` is optional (type-only import); at most 1 wrong extra. The ground truth comes from TypeScript's `ts.preProcessFile`, not from codegraph |
| locate | supersearch | what stops `sync` from deleting `../secret.txt` if the manifest is edited | names `isProjectPath` and `manifest.ts` |
| fix | a real fix | bug report: a second `sync --force` overwrites `CLAUDE.md.bak` | setup re-introduces the 0.2.0 bug (`src/` and `dist/`) and removes its regression test. The check restores every file under `tests/` to the pinned version, the hidden test included, and runs the full suite (199 tests) |

I checked the checks against hand-written right and wrong answers before any paid run. For the fix task: with the bug in place the model sees 198/198 tests pass, the check fails with the bug and passes after the real fix.

## Results — full run (3 per task per arm)

<!-- node bench/report.mjs bench/results/agentos-full.json -->

| task | pass (agentos / baseline) | total tokens, median | Δ tokens | cost, median | Δ cost | turns, median |
|---|---|---|---|---|---|---|
| overhead | 3/3 / 3/3 | 37,493 vs 36,837 | +2% | $0.037 vs $0.034 | +8% | 1 vs 1 |
| recall | 0/3 / 0/3 | 77,398 vs 75,751 | +2% | $0.062 vs $0.055 | +11% | 2 vs 2 |
| impact | 3/3 / 3/3 | 114,657 vs 409,852 | −72% | $0.062 vs $0.189 | −67% | 3 vs 19 |
| locate | 3/3 / 3/3 | 202,514 vs 161,945 | +25% | $0.106 vs $0.094 | +13% | 6 vs 4 |
| fix | 3/3 / 3/3 | 427,269 vs 568,077 | −25% | $0.191 vs $0.232 | −18% | 12 vs 13 |
| **all tasks** | | 859,331 vs 1,252,462 | −31% | $0.458 vs $0.604 | −24% | |

Cells read *agentos vs baseline*. Δ = agentos relative to baseline (− means agentos used less).

### overhead

| arm | pass | total tokens | output tokens | cost | turns | tool calls (all reps) |
|---|---|---|---|---|---|---|
| agentos | 3/3 | 37,493 (37,493–37,494) | 4 (4–4) | $0.037 ($0.037–$0.037) | 1 (1–1) | none |
| baseline | 3/3 | 36,837 (36,836–36,837) | 4 (4–4) | $0.034 ($0.034–$0.034) | 1 (1–1) | none |

### recall

| arm | pass | total tokens | output tokens | cost | turns | tool calls (all reps) |
|---|---|---|---|---|---|---|
| agentos | 0/3 | 77,398 (76,674–116,805) | 1,056 (452–1,277) | $0.062 ($0.054–$0.071) | 2 (2–3) | Read 3, Bash 1 |
| baseline | 0/3 | 75,751 (75,214–76,015) | 923 (384–1,214) | $0.055 ($0.050–$0.058) | 2 (2–2) | Bash 2, Read 1 |

### impact

| arm | pass | total tokens | output tokens | cost | turns | tool calls (all reps) |
|---|---|---|---|---|---|---|
| agentos | 3/3 | 114,657 (114,452–114,833) | 597 (536–713) | $0.062 ($0.061–$0.063) | 3 (3–3) | ToolSearch 3, codegraph_impact 3 |
| baseline | 3/3 | 409,852 (359,153–695,039) | 4,932 (4,450–8,793) | $0.189 ($0.175–$0.304) | 19 (13–40) | Grep 63, Glob 4, Read 2 |

### locate

| arm | pass | total tokens | output tokens | cost | turns | tool calls (all reps) |
|---|---|---|---|---|---|---|
| agentos | 3/3 | 202,514 (160,704–203,721) | 985 (680–1,048) | $0.106 ($0.090–$0.107) | 6 (4–6) | Read 6, supersearch_text 3, ToolSearch 2, supersearch_symbol 1, Grep 1 |
| baseline | 3/3 | 161,945 (158,258–237,449) | 770 (749–1,051) | $0.094 ($0.088–$0.108) | 4 (4–6) | Read 6, Grep 3, Bash 2 |

### fix

| arm | pass | total tokens | output tokens | cost | turns | tool calls (all reps) |
|---|---|---|---|---|---|---|
| agentos | 3/3 | 427,269 (334,288–475,588) | 2,753 (1,401–2,759) | $0.191 ($0.154–$0.209) | 12 (8–12) | Grep 12, Read 8, Edit 5, Bash 4 |
| baseline | 3/3 | 568,077 (514,762–593,388) | 3,514 (3,036–3,641) | $0.232 ($0.218–$0.246) | 13 (12–16) | Grep 18, Read 7, Bash 7, Edit 6 |

Cells: median (min–max).

### Pilot (1 per task per arm) — kept separate, not part of the medians above

| task | pass (agentos / baseline) | total tokens | Δ tokens | cost | Δ cost | turns |
|---|---|---|---|---|---|---|
| overhead | 1/1 / 1/1 | 37,492 vs 36,836 | +2% | $0.037 vs $0.034 | +8% | 1 vs 1 |
| recall | 0/1 / 0/1 | 77,829 vs 75,741 | +3% | $0.064 vs $0.055 | +15% | 2 vs 2 |
| impact | 1/1 / **0/1** | 114,912 vs 517,561 | −78% | $0.064 vs $0.188 | −66% | 3 vs 13 |
| locate | 1/1 / 1/1 | 322,286 vs 199,458 | +62% | $0.186 vs $0.104 | +79% | 1 vs 6 |
| fix | 1/1 / 1/1 | 550,579 vs 486,137 | +13% | $0.217 vs $0.202 | +7% | 13 vs 11 |

In the pilot's impact run, baseline missed `src/mcp/memory/server.ts`. In the pilot's locate run, the agentos arm handed the search to an Explore subagent in the background and waited for it with `ScheduleWakeup`. That run shows up as "1 turn", but the subagent's tokens are counted in the total.

## What the transcripts show

- **The tools that get used are the ones a rule names.** The generated rule `no-guessing-deps` says "use the codegraph/supersearch MCP tools to verify dependencies". Every impact run in the agentos arm went `ToolSearch` → `codegraph_impact` → answer. 2 of 3 locate runs used supersearch; they took 6 turns, against 4 for the run that used Grep. No rule and no tool note says when to use memory. `memory_recall` was never called in 4 recall runs, even though the answer was stored there word for word.
- **Every first use of an MCP tool costs an extra turn.** Claude Code 2.1.278 defers MCP tool schemas, so the model calls `ToolSearch` (`select:mcp__…`) before the tool itself. That is one turn, about 37k cached tokens, on top of the call. It is cheap next to the 16 turns that codegraph saved on impact. For a text search that Grep does in one call, it is pure overhead.
- **The default `run-tests-first` rule did not trigger test runs** on the read-only tasks. On the fix task both arms ran the full suite anyway, because the prompt asks for it.
- **The fix task never touched agentos tools.** Both arms went Grep `.bak` → Read `sync.ts` → Edit → run the tests. The agentos arm's lower median came from fewer side trips (looking up how to run tests, re-grepping test files). With n=3, and the pilot pointing the other way, this is not a measured benefit.

## Memory-first variant (not what agentos generates today)

`targets/agentos-memrule.mjs` is the base agentos arm with one more rule in `agent.config.yaml`:

> **memory-first:** Before answering a question about why this project does something, or about its conventions and setup, call memory_recall to check the stored project facts.

Same flags and tasks as the full run, agentos arm only, 3 runs per task. Baseline is unchanged, so it is compared with the full run's baseline numbers.

| task | pass | total tokens | cost | turns | runs that called memory | tokens vs agentos 0.2.0 | tokens vs baseline | cost vs baseline |
|---|---|---|---|---|---|---|---|---|
| overhead | 3/3 | 37,545 (37,544–37,546) | $0.037 | 1 | 0/3 | 0 % | +2 % | +8 % |
| recall | **3/3** (was 0/3) | 153,315 (153,107–192,293) | $0.071 ($0.070–$0.081) | 5 (5–7) | 3/3 | +98 % | +102 % | +28 % |
| impact | 3/3 | 114,914 (114,874–114,916) | $0.063 | 3 | 0/3 | 0 % | −72 % | −66 % |
| locate | 2/3 | 163,276 (120,231–284,263) | $0.095 ($0.084–$0.123) | 5 (4–8) | 1/3 | −19 % | +1 % | +2 % |
| fix | 3/3 | 586,665 (372,779–817,504) | $0.235 ($0.156–$0.297) | 13 (9–18) | 1/3 | +37 % | +3 % | +1 % |
| **all tasks** | | 1,055,715 | $0.501 | | | +23 % | −16 % | −17 % |

- **Recall now works.** Every run called `memory_recall` (3–4 calls, one per query wording), found the stored fact and answered correctly. That takes 3 extra turns, which is why tokens double compared with the arms that guessed.
- **Side effect:** the model also consulted memory on tasks that do not need it (one locate run, one fix run). The failed locate run did answer correctly (`isProjectPath` in `manifest.ts`). It then made another memory call and ended with a note on why it would not store the fact. `claude -p` prints only that last message, and the check scores what is printed, so the run counts as a failure. The scoring rule was fixed before the runs and was not changed afterwards.
- The locate and fix differences against agentos 0.2.0 (−19 %, +37 %) are inside the run-to-run spread; fix alone ranged from 373k to 818k tokens.

## 0.2.1 follow-up (recall and locate only)

What changed in 0.2.1 (see CHANGELOG):
- The generated "Local Tools" note now says which question each tool answers:
  - `memory`: why/how, conventions, commands, past decisions → call `memory_recall` first
  - `codegraph`: what breaks if X changes, who uses X → `codegraph_impact`
  - `supersearch`: symbol definitions, git history, blame. Plain text search goes to the built-in Grep.
- `supersearch_text` is no longer described as a Grep replacement.
- The `init` rule `no-guessing-deps` names codegraph only.

The note is still 4 lines, but 84 characters longer (note +96, rule −12), roughly +20 tokens per session. The overhead task was not re-run.

Target: `targets/agentos-0.2.1.mjs`. It is the base agentos arm with the 0.2.1 `init` rule, and it runs the MCP servers from the checkout's `dist/` instead of npm 0.2.0. Same model (Sonnet 5), same Claude Code (2.1.278), same flags, 3 runs per task, 2 at a time. Baseline was re-run in the same session.

**Round 1 — the note only** (`c8c3483`, `results/agentos-0.2.1-followup.json`, both arms, $0.90):

| task | pass (agentos / baseline) | total tokens, median | Δ tokens | cost, median | Δ cost | turns |
|---|---|---|---|---|---|---|
| recall | 1/3 / 0/3 | 116,992 vs 75,331 | +55 % | $0.069 vs $0.051 | +36 % | 5 vs 2 |
| locate | 3/3 / 3/3 | 160,909 vs 158,830 | +1 % | $0.090 vs $0.090 | 0 % | 4 vs 5 |

The note did its job: all 3 recall runs called `memory_recall`, against 0/4 on 0.2.0. Two of them still guessed, because the search failed. In 0.2.0, `memory_recall`'s `text` must match the fact's value as one literal phrase. The agent's first queries were `"dist compiled build"`, `"dist build compiled committed"` and `"dist compiled build committed git prepublishOnly"`. Each came back "No matching facts.", although the fact is stored under topic `build` and its value contains "dist". One run retried with `topic: "build"` and passed. The other two answered from `package.json`.

**Round 2 — note + search fix** (`f8e37d8`, `results/agentos-0.2.1-recallfix.json`, agentos arm only, $0.48). A fact now matches when any word of the query (3+ letters) appears in its topic, key or value, and facts matching more words come first. The baseline column is round 1's:

| task | pass (agentos / baseline) | total tokens, median | Δ tokens | cost, median | Δ cost | turns | tool calls, agentos (all reps) |
|---|---|---|---|---|---|---|---|
| recall | **2/3** / 0/3 | 116,426 vs 75,331 | +55 % | $0.065 vs $0.051 | +27 % | 4 vs 2 | memory_recall 2, ToolSearch 2, Read 2, Bash 1 |
| locate | 3/3 / 3/3 | 161,696 vs 158,830 | +2 % | $0.092 vs $0.090 | +2 % | 5 vs 5 | Grep 6, Read 6 |

- **Recall: 2/3, not the 3/3 expected.** Both runs that called `memory_recall` found the fact with their first query (`"dist compiled build install postinstall prepublish"`, `"dist build postinstall prepare"`) and answered correctly. The third run never called memory: it read `package.json` and guessed. Over both rounds, the note got memory consulted in 5 of 6 recall runs.
- **Cost of a correct recall answer:** 116k tokens and $0.065 in 4 turns. The memory-first variant needed 153k tokens and $0.071 in 5 turns, because it retried until the phrase search matched. The wrong baseline answer costs $0.051.
- **Locate: the supersearch overhead is gone.** No supersearch, ToolSearch or memory call in any of the 6 runs, only Grep and Read. Tokens are +1 % and +2 % against baseline, down from +25 % on 0.2.0. The memory-first variant's side effect (an unneeded memory lookup on locate) did not occur.
- The baseline re-run matches the full run: recall 0/3 at ~75k tokens, locate 3/3 at ~159k.
- n = 3 per cell. 2/3 against 3/3 is one run, which is within the noise. The mechanism is visible in the transcripts: the note makes the call happen, and the search fix makes it find the fact.

## Limitations

- **One small target.** 201 files, 35 of them in `src/`, and the repo is agentos itself. On a large codebase Grep gets more expensive and codegraph/supersearch are likely to matter more. That has not been measured here. `targets/local.example.mjs` shows how to run the same benchmark on a private repo, e.g. a Laravel ERP, without committing anything from it.
- **n = 3.** LLM runs vary a lot: baseline impact took 13–40 turns, and fix changed sign between pilot and full run. A single-task difference under ~25 % is inside the noise.
- One model (Sonnet 5), one Claude Code version and one OS. Results for other models and for later Claude Code versions (for example, if MCP tools stop being deferred) may differ.
- The four answer checks are string checks. They were validated against sample answers, not against every possible phrasing. The fix check runs the real test suite.
- Runs share Claude Code's global prompt cache (the system prompt prefix is warm for both arms). Interleaving and flipping the order keep this from favouring either arm.

## Cost of the benchmark

API list price. On the Max plan these runs count against the plan's usage limits instead of being billed.

| part | runs | cost |
|---|---|---|
| isolation probes | 3 | $0.29 |
| pilot | 10 | $1.15 |
| full run | 30 | $3.26 |
| memory-first variant | 15 | $1.51 |
| 0.2.1 round 1 (recall + locate, both arms) | 12 | $0.90 |
| 0.2.1 round 2 (recall + locate, agentos arm) | 6 | $0.48 |
| **total** | 76 | **$7.59** |

## What to change in agentos

In order of measured effect. Items 1–3 shipped in 0.2.1, together with the `memory_recall` search fix; see [0.2.1 follow-up](#021-follow-up-recall-and-locate-only).

1. **Say when to use memory.** At present the generated tool note says only "`memory` — store/recall project facts" (`src/generators/shared.ts`), and no default rule mentions memory. As a result, seeded memory was never read (0/4). One sentence tying `memory_recall` to why/how/convention questions made it 3/3. Put that sentence in the generated "Local Tools" note, or in the `agentos init` template rules, so every project gets it. The cost is roughly +3 turns on questions that do use memory, and an occasional unneeded lookup elsewhere.
2. **Name the question each tool answers.** Tools got used where a rule named them, and not otherwise. `codegraph_impact` is the measured win: −72 % tokens, −67 % cost, 3 turns every time, 4/4 correct against 3/4. The note should map questions to tools: "what breaks / who imports X → `codegraph_impact`", "why / how do we → `memory_recall`".
3. **Stop presenting `supersearch_text` as a Grep replacement.** Its description says it is "faster and free compared to asking the LLM to read files", and the rule says to prefer the MCP tools. On this repo, locating code that way cost +25 % tokens, because it returns what Grep returns and adds a ToolSearch round trip. Point supersearch at what Grep cannot do: symbol definitions (`supersearch_symbol`), `supersearch_history` and `supersearch_blame`.
4. **Fixed overhead needs no work.** It is +656 tokens per session, about $0.003 on Sonnet 5, because Claude Code loads MCP tool schemas only on demand.
5. **Measure a large repo before drawing conclusions about search.** This target is small, so Grep is cheap here. Run `targets/local.example.mjs` against the Laravel ERP (local only) to see whether supersearch and codegraph gain more on a big codebase.

## Reproduce

```bash
node bench/run.mjs --label pilot                          # 1 run per task per arm (~$1.2)
node bench/run.mjs --label full --reps 3 --concurrency 2  # ~$3.3
node bench/report.mjs bench/results/agentos-full.json     # the tables above
BENCH_TARGET=bench/targets/agentos-memrule.mjs node bench/run.mjs --label full --reps 3 --arms agentos --concurrency 2  # variant (~$1.5)
npm run compile && node bench/run.mjs --target bench/targets/agentos-0.2.1.mjs --label followup --tasks recall,locate --reps 3 --concurrency 2  # 0.2.1 (~$0.9)
```

`claude` must be logged in (`claude auth status`). Raw per-run results (tokens, cost, turns, tool calls, answer, check detail) are in `bench/results/*.json`. Full transcripts go to `bench/results/transcripts/`, which is gitignored. A private target: `BENCH_TARGET=/abs/path/my-target.mjs node bench/run.mjs`, with results in `bench/results/local/`, also gitignored.
