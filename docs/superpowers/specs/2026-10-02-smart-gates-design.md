# PRD 4.5: smart gates

Status: draft for owner review · 2026-10-02 · target release 0.7.0 · builds on 0.6.0

**Built by agentos itself:** each plan task is one `agentos run` on this repo. The controller reviews every PR through the full gate and merges it.

## 1. Why

`agentos run` stops at a PR that a human reads. That human should see quickly where to look, and should not have to trust the agent's word. Three gaps make that slower and riskier today:

- **Risky changes look like any other diff.** A migration, a CI or deploy file, a lockfile, auth code or a big deletion carries no special mark.
- **Tests can be "fixed" by weakening them.** An agent can skip a failing test, delete it, or loosen its assertions. The reviewer may or may not notice. The owner's playbook (PDF) names this as an agent's most common failure.
- **The agent's own account is lost.** The worker's final message (what it left out, what it assumed, what it could not check) is cut to one table cell in the PR. Claims are not checked against the diff.

Lessons have a smaller version of the same problem: the top 5 are always injected, even when none of them is relevant to the task.

Everything here is deterministic or uses the existing reviewer. No paid API, no new dependency. The optional local decider (jevos) and `agentos init --saas` are separate sub-projects and come later.

## 2. Decisions (agreed with the owner, 2026-10-02)

1. **Risk gate:** per-project rules, each with an action of `flag` or `block`. Built-in defaults all `flag`.
   - `flag`: the PR opens with a "⚠️ Look here" section, and the dashboard lists the run under "Needs you".
   - `block`: the run stops at `needs_human` with the rule named. No PR opens.
2. **Test tampering:** deterministic rules **and** the reviewer.
   - The rules catch the plain cases: skip/only markers, deleted test files, fewer assertions.
   - The reviewer is told to look for the subtle ones, such as an assertion made weaker.
3. **Honest report:** every worker and fixer ends with a fixed report: CHANGED / NOT DONE / ASSUMED / NOT VERIFIED.
   - The report goes into the PR body.
   - The reviewer checks claims against the diff. A false claim becomes a finding and so goes through the fix loop.
   - A non-empty NOT DONE does not stop the run, and it does not create new jobs.
4. **Lessons:** a lesson that shares no meaningful word with the task is not injected.
5. **Approach:** one new module, `src/orchestrator/gates.ts`, of small pure functions wired into the engine at three points (verify, gate, PR body). It is not a plugin system: the jevos decider gets its own small interface when it comes.

## 3. Components

### `src/orchestrator/gates.ts` (new, pure, no I/O)

| Function | Does |
|---|---|
| `globToRegExp(glob)` | Turns `**`, `*` and `?` into a regular expression over `/`-separated paths. No dependency. |
| `riskFlags(changes, rules)` | Takes `changes` (`{ path, added, deleted, status }[]`, from `git diff --numstat` and `--name-status`) and returns `{ rule, action, files }[]` for each rule that matched. `deletedLines` rules compare the total lines deleted in the run. |
| `tamperFindings(diff, task)` | Takes the unified diff of `base..HEAD` and returns `Finding[]` (see section 4). |
| `parseReport(text)` | Returns `{ changed: string[]; notDone: string[]; assumed: string[]; notVerified: string[] } \| null` from an agent's final message. It returns null when there is no report. |
| `REPORT_INSTRUCTIONS` | The text added to worker and fixer prompts that asks for the report. |

### Configuration (`orchestratorSchema.risk`)

```yaml
orchestrator:
  risk:                      # replaces the defaults when given
    - { name: migration,  paths: ["**/migrations/**", "**/*.sql"], action: block }
    - { name: big-delete, deletedLines: 500, action: flag }
```

Each rule has `name`, `action` (`flag` or `block`), and one of `paths` (globs) or `deletedLines` (a number). The zod schema rejects a rule with neither, or with an unknown action, when the config loads. That is before a run starts.

**Built-in defaults** (all `flag`):

| Rule | Matches |
|---|---|
| `migration` | `**/migrations/**`, `**/*.sql` |
| `ci-deploy` | `.github/workflows/**`, `Dockerfile`, `docker-compose*.yml`, `railway.*`, `Procfile`, `vercel.json` |
| `lockfile` | `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `composer.lock` |
| `auth` | `**/auth/**`, `**/*Policy*`, `**/middleware/**`, `**/permissions*` |
| `env-config` | `.env.example`, `config/**` |
| `big-delete` | 200 or more deleted lines in the run |

### Engine wiring (`src/orchestrator/engine.ts`, `report.ts`, `run.ts`, `verify.ts`)

- **Prompts.** `workerPrompt` and `fixPrompt` end with `REPORT_INSTRUCTIONS`.
- **Saving reports.** After each worker, `parseReport(finalText(res.output))` is stored as `SubtaskState.report`. After each fix round, it is stored as `RunState.fixReport`. When no report is found, `null` is stored.
- **`verify()`.** The run computes `tamperFindings(diff(base..HEAD), task)` and adds them to the review findings, so they reach the fixer in the same round. The reviewer prompt (full and re-review) gets two new parts:
  - the workers' reports, under the instruction "check each claim against the diff; a claim the diff does not support is a finding"
  - "look for tests made weaker: a looser assertion, a mocked-away subject, a lowered threshold"
- **`gate()`.** After the build step and the secret scan, and before the push, the run computes `riskFlags`.
  - When any rule has `action: block`, it moves to `needs_human` with the reason `risk rule "<name>" blocks the PR: <files>`.
  - Otherwise the flags are stored in `RunState.risk`.
- **`prBody()`.** It gets two new sections:
  - **"⚠️ Look here"** lists each flag with its files, shown only when there are flags. It goes first, under the task line.
  - **"What the agents report"** lists NOT DONE, ASSUMED and NOT VERIFIED, merged across subtasks and the last fix round. It says "no report" for an agent that gave none.
- **Dashboard.** A `pr_open` run with `risk` flags counts as "Needs you" in the run list and the all-projects summary (`src/ui/api.ts`).

### Lessons (`src/learning/inject.ts`)

`lessonsFor` keeps only lessons that share at least one meaningful word with the task. A meaningful word is longer than 3 letters and not in a short stop list (`with, that, this, from, have, when, then, into, must, should, each, only, also, make, does`). The rest is unchanged: the score order and the `max` cap stay.

## 4. Test-tampering rules

**Test files** are paths matching any of:
- `(^|/)(tests?|__tests__|spec)/`
- `\.(test|spec)\.[cm]?[jt]sx?$`
- `Test\.php$`
- `(^|/)test_[^/]*\.py$`
- `_test\.(go|py)$`

| Finding | Severity |
|---|---|
| An added line in a test file adds a skip or focus marker: `it.skip(`, `test.skip(`, `describe.skip(`, `.only(`, `xit(`, `xdescribe(`, `xtest(`, `markTestSkipped(`, `->skip(`, `@pytest.mark.skip`, `t.Skip(`, `@Ignore`, `@Disabled` | high |
| A test file is deleted (`deleted file mode`) | high |
| A test file has fewer assertion lines after the change. Assertion lines match `\b(expect|assert\w*|should)\b` or `->assert`. | medium |

**Exemption.** When the task text itself asks for it, every tampering finding becomes `low`, which is reported but does not block. The test is that the task matches `\b(remove|delete|drop|skip|disable|rewrite|replace)\b[^.\n]{0,40}\btests?\b`, for example "remove the old login test". "Tests must pass" does not count.

The scan reads at most 2 MB of diff, which is plenty for a run. Past that it reports one low finding: "diff too large to scan for test tampering".

## 5. Data

```ts
interface AgentReport { changed: string[]; notDone: string[]; assumed: string[]; notVerified: string[] }
interface RiskFlag { rule: string; action: "flag" | "block"; files: string[] }

SubtaskState.report?: AgentReport | null   // null = the agent gave no report
RunState.fixReport?: AgentReport | null    // the last fix round's report
RunState.risk?: RiskFlag[]                  // flags of a run that reached the PR
```

## 6. Errors

| Case | Behaviour |
|---|---|
| Invalid `risk` rule in the config | A config error before the run starts (zod), naming the rule |
| No report from an agent | The PR says "no report"; nothing blocks |
| `git diff --numstat` fails | The risk gate is skipped, and one low finding says so. The PR still opens. The secret scan stays mandatory. |
| A `block` rule matches | `needs_human`, no push, no PR. The reason names the rule and the files. |

## 7. Testing

- **Unit tests** (`tests/orchestrator/gates.test.ts`):
  - `globToRegExp` cases: `**`, `*`, `?`, dots, root files
  - `riskFlags`: each default rule, a `block` rule, `deletedLines`
  - `tamperFindings`: each marker, a deleted test file, fewer assertions, a non-test file ignored, the exemption on and off, the size cap
  - `parseReport`: full, partial, missing, lowercase and colon variants
  - the risk schema validation
- **Engine tests** (fake runners):
  - a `block` rule leads to `needs_human` with no PR call
  - a `flag` puts "⚠️ Look here" in the PR body
  - a worker that adds `it.skip` hands the fixer a high finding
  - reports appear in the PR body, and "no report" appears when a worker gives none
- **Lessons test:** a lesson with no shared meaningful word is not injected.
- **Real run:** one `agentos run --quick` on this repo with a task that touches `package-lock.json`. The PR shows the lockfile flag and the agent report. Recorded in `bench/gates-e2e.md`.

## 8. Out of scope

- The jevos local decider (PRD 4.5b): routing and lesson relevance by a local model, with an owner-approved download.
- `agentos init --saas` (PRD 4.5c).
- Turning NOT DONE items into new jobs.
- Language-aware assertion parsing. Line-level patterns are the documented ceiling, and the reviewer covers the rest.
