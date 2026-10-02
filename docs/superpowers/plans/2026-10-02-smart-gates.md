# PRD 4.5 smart gates Implementation Plan

> **For agentic workers:** each task below is one `agentos run` on this repo. Do only the task you were given. The tests in the task must pass unchanged. `npm test` and `npx tsc --noEmit` must stay green, including on Windows.

**Goal:** Show the owner where a PR needs a human, catch tests that were weakened to pass, carry the agents' own account (not done, assumed, not verified) into the PR, and stop injecting irrelevant lessons.

**Architecture:**
- A new pure module, `src/orchestrator/gates.ts`, holds `globToRegExp`, `parseNumstat`, `riskFlags`, `tamperFindings`, `parseReport`, `DEFAULT_RISK`, `REPORT_INSTRUCTIONS` and `REVIEW_GATES`.
- The engine calls it in `verify()` (tampering findings), `gate()` (risk flags; `block` → `needs_human`) and `prBody()` (two new sections).
- The config adds `orchestrator.risk`.

**Tech Stack:** TypeScript (strict, ESM, Node16 `.js` imports), Node ≥ 20, zod, vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-02-smart-gates-design.md`

## Global Constraints

- **Language and runtime:** TypeScript strict, ESM, imports end in `.js`, Node ≥ 20. Match the surrounding code's comment density and naming.
- **Dependencies:** no new ones. Glob matching is done in our own code.
- **No paid API.** Everything is deterministic or uses the existing reviewer agent.
- **Default risk rules:** all `flag`. A `block` is only ever set by a project's config.
- **What blocks:** tampering findings use `Finding` severities, so `high` and `medium` block (they go to the fixer) and `low` does not. A missing agent report never blocks.
- **Secrets:** `verifyOutput` stays out of the PR body. Report text is `redact()`ed before it is stored.
- **`dist/` is committed.** `npm run compile` refreshes it, and agentos's `orchestrator.build` does this before each PR.

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/orchestrator/gates.ts` | 1 | pure gate functions and texts |
| `src/core/schema.ts` | 1 | `riskRuleSchema`, `orchestratorSchema.risk` |
| `src/orchestrator/{engine,run,report}.ts` | 2 | wiring: prompts, reports, verify, gate, PR body |
| `src/learning/inject.ts`, `src/ui/api.ts`, `ui/app.js`, `README.md` | 3 | lesson relevance, dashboard "Needs you" for flagged PRs, docs |

---

### Task 1: the gates module and the risk config

**Files:**
- Create: `src/orchestrator/gates.ts`
- Modify: `src/core/schema.ts` (`riskRuleSchema`, `risk` in `orchestratorSchema`)
- Test: `tests/orchestrator/gates.test.ts`

**Interfaces:**
- Produces (used by Task 2):
  - `interface Change { path: string; added: number; deleted: number }`
  - `interface RiskRule { name: string; action: "flag" | "block"; paths?: string[]; deletedLines?: number }`
  - `interface RiskFlag { rule: string; action: "flag" | "block"; files: string[] }`
  - `interface AgentReport { changed: string[]; notDone: string[]; assumed: string[]; notVerified: string[] }`
  - `globToRegExp(glob: string): RegExp`
  - `matchesGlob(path: string, glob: string): boolean`
  - `parseNumstat(out: string): Change[]`
  - `riskFlags(changes: Change[], rules: RiskRule[]): RiskFlag[]`
  - `DEFAULT_RISK: RiskRule[]`
  - `tamperFindings(diff: string, task: string): Finding[]`
  - `parseReport(text: string): AgentReport | null`
  - `REPORT_INSTRUCTIONS: string`
  - `REVIEW_GATES: string`
  - `OrchestratorConfig.risk?: RiskRule[]`

- [ ] **Step 1: Write the failing tests** in `tests/orchestrator/gates.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  globToRegExp, matchesGlob, parseNumstat, riskFlags, DEFAULT_RISK, tamperFindings, parseReport, REPORT_INSTRUCTIONS,
} from "../../src/orchestrator/gates.js";
import { orchestratorSchema } from "../../src/core/schema.js";

const diffOf = (file: string, lines: string[], extra = "") =>
  `diff --git a/${file} b/${file}\n${extra}--- a/${file}\n+++ b/${file}\n@@ -1,3 +1,3 @@\n${lines.join("\n")}\n`;

describe("globs", () => {
  it("matches ** across folders, * and ? inside one, and a bare name at any depth", () => {
    expect(globToRegExp("**/migrations/**").test("server/database/migrations/2026_add.php")).toBe(true);
    expect(globToRegExp("**/migrations/**").test("migrations/x.sql")).toBe(true);
    expect(globToRegExp(".github/workflows/**").test(".github/workflows/ci.yml")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
    expect(globToRegExp("file?.txt").test("file1.txt")).toBe(true);
    expect(matchesGlob("packages/app/package-lock.json", "package-lock.json")).toBe(true);
    expect(matchesGlob("src/Dockerfile.ts", "Dockerfile")).toBe(false);
    expect(matchesGlob("app/Policies/UserPolicy.php", "**/*Policy*")).toBe(true);
  });
});

describe("risk flags", () => {
  const changes = parseNumstat("12\t3\tdatabase/migrations/2026_10_02_add.php\n0\t250\tsrc/old.ts\n-\t-\tlogo.png\n1\t1\tpackage-lock.json\n");

  it("reads git diff --numstat, binary files as 0", () => {
    expect(changes).toEqual([
      { path: "database/migrations/2026_10_02_add.php", added: 12, deleted: 3 },
      { path: "src/old.ts", added: 0, deleted: 250 },
      { path: "logo.png", added: 0, deleted: 0 },
      { path: "package-lock.json", added: 1, deleted: 1 },
    ]);
  });

  it("flags by the default rules, including a big deletion", () => {
    const flags = riskFlags(changes, DEFAULT_RISK);
    expect(flags.map((f) => [f.rule, f.action, f.files])).toEqual([
      ["migration", "flag", ["database/migrations/2026_10_02_add.php"]],
      ["lockfile", "flag", ["package-lock.json"]],
      ["big-delete", "flag", ["src/old.ts", "database/migrations/2026_10_02_add.php", "package-lock.json"]],
    ]);
  });

  it("carries a project's block action, and finds nothing on a quiet diff", () => {
    const flags = riskFlags(changes, [{ name: "migration", action: "block", paths: ["**/migrations/**"] }]);
    expect(flags).toEqual([{ rule: "migration", action: "block", files: ["database/migrations/2026_10_02_add.php"] }]);
    expect(riskFlags(parseNumstat("3\t1\tsrc/a.ts\n"), DEFAULT_RISK)).toEqual([]);
  });

  it("validates risk rules in the config", () => {
    expect(orchestratorSchema.parse({ risk: [{ name: "m", action: "block", paths: ["**/*.sql"] }] }).risk).toHaveLength(1);
    expect(() => orchestratorSchema.parse({ risk: [{ name: "m", action: "stop", paths: ["x"] }] })).toThrow();
    expect(() => orchestratorSchema.parse({ risk: [{ name: "m", action: "flag" }] })).toThrow(/exactly one of paths or deletedLines/);
    expect(() => orchestratorSchema.parse({ risk: [{ name: "m", action: "flag", paths: ["x"], deletedLines: 5 }] })).toThrow(/exactly one/);
    expect(orchestratorSchema.parse({}).risk).toBeUndefined();
  });
});

describe("test tampering", () => {
  it("flags a new skip or focus marker in a test file as high", () => {
    const d = diffOf("tests/login.test.ts", [" it('logs in', () => {", "-it('rejects bad password', () => {", "+it.skip('rejects bad password', () => {"]);
    const f = tamperFindings(d, "make login work");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: "high", file: "tests/login.test.ts" });
    expect(f[0].issue).toMatch(/skip/i);
  });

  it("knows the common markers across languages", () => {
    for (const [file, line] of [
      ["src/a.spec.js", "+describe.only('x', () => {"],
      ["tests/Feature/LoginTest.php", "+        $this->markTestSkipped('flaky');"],
      ["tests/test_api.py", "+@pytest.mark.skip(reason='later')"],
      ["pkg/api_test.go", "+\tt.Skip(\"later\")"],
      ["src/__tests__/b.ts", "+xit('works', () => {})"],
    ]) expect(tamperFindings(diffOf(file, [line]), "t").map((x) => x.severity), file).toEqual(["high"]);
  });

  it("flags a deleted test file as high and fewer assertions as medium", () => {
    const deleted = diffOf("tests/old.test.ts", ["-expect(a).toBe(1);"], "deleted file mode 100644\n");
    expect(tamperFindings(deleted, "t")).toEqual([expect.objectContaining({ severity: "high", file: "tests/old.test.ts" })]);
    const weaker = diffOf("tests/math.test.ts", ["-  expect(add(1, 2)).toBe(3);", "-  expect(add(2, 2)).toBe(4);", "+  expect(add(1, 2)).toBeTruthy();"]);
    expect(tamperFindings(weaker, "t")).toEqual([expect.objectContaining({ severity: "medium", file: "tests/math.test.ts" })]);
  });

  it("ignores non-test files and lowers everything to low when the task asks for it", () => {
    expect(tamperFindings(diffOf("src/feature.ts", ["+it.skip('x')"]), "t")).toEqual([]);
    const d = diffOf("tests/old.test.ts", ["-expect(a).toBe(1);"], "deleted file mode 100644\n");
    expect(tamperFindings(d, "Remove the old login test, it covers a deleted page").map((x) => x.severity)).toEqual(["low"]);
    expect(tamperFindings(d, "Fix the bug; all tests must pass").map((x) => x.severity)).toEqual(["high"]);
  });

  it("reports a diff too large to scan instead of scanning it", () => {
    const f = tamperFindings("x".repeat(2_000_001), "t");
    expect(f).toEqual([expect.objectContaining({ severity: "low", issue: expect.stringContaining("too large") })]);
  });
});

describe("agent report", () => {
  it("reads the four parts, with bullets, semicolons and 'none'", () => {
    const r = parseReport(`Done.\n\nCHANGED: src/a.ts; src/b.ts\nNOT DONE:\n- the export button\n- dark mode\nASSUMED: users are logged in\nNOT VERIFIED: none`);
    expect(r).toEqual({ changed: ["src/a.ts", "src/b.ts"], notDone: ["the export button", "dark mode"], assumed: ["users are logged in"], notVerified: [] });
  });

  it("accepts lowercase and markdown bold headings, and returns null without a report", () => {
    expect(parseReport("**Not done:** n/a\n**Assumed**: api v2")).toEqual({ changed: [], notDone: [], assumed: ["api v2"], notVerified: [] });
    expect(parseReport("I fixed it.")).toBeNull();
  });

  it("tells the agent the exact format", () => {
    for (const h of ["CHANGED:", "NOT DONE:", "ASSUMED:", "NOT VERIFIED:"]) expect(REPORT_INSTRUCTIONS).toContain(h);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/orchestrator/gates.test.ts`
Expected: FAIL, because `src/orchestrator/gates.ts` does not exist.

- [ ] **Step 3: Implement**

In `src/core/schema.ts`, above `orchestratorSchema`:

```ts
/** a path or size rule that marks a PR for the owner's attention (flag) or stops it before it opens (block) */
export const riskRuleSchema = z
  .object({
    name: z.string().min(1),
    action: z.enum(["flag", "block"]),
    paths: z.array(z.string().min(1)).min(1).optional(),
    deletedLines: z.number().int().positive().optional(),
  })
  .strict()
  .refine((r) => (r.paths !== undefined) !== (r.deletedLines !== undefined), { message: "a risk rule needs exactly one of paths or deletedLines" });
```

and inside `orchestratorSchema`, after `models`:

```ts
  /** replaces the built-in risk rules (all "flag") when given */
  risk: z.array(riskRuleSchema).optional(),
```

`src/orchestrator/gates.ts`:

```ts
import path from "node:path";
import type { Finding } from "./types.js";

/**
 * Smart gates (PRD 4.5): deterministic checks that tell the owner where a PR needs a human.
 * Pure functions: the engine feeds them git output and agent text.
 */

export interface Change { path: string; added: number; deleted: number }
export interface RiskRule { name: string; action: "flag" | "block"; paths?: string[]; deletedLines?: number }
export interface RiskFlag { rule: string; action: "flag" | "block"; files: string[] }
export interface AgentReport { changed: string[]; notDone: string[]; assumed: string[]; notVerified: string[] }

/** `**` crosses folders, `*` and `?` stay inside one; everything else is literal */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** a glob without a slash names a file anywhere (like .gitignore); one with a slash is anchored at the root */
export const matchesGlob = (file: string, glob: string): boolean =>
  globToRegExp(glob).test(glob.includes("/") ? file : path.posix.basename(file));

/** `git diff --numstat --no-renames` lines; binary files ("-") count as 0 */
export function parseNumstat(out: string): Change[] {
  return out
    .split("\n")
    .map((l) => l.split("\t"))
    .filter((p) => p.length >= 3 && p[2])
    .map(([a, d, file]) => ({ path: file, added: Number(a) || 0, deleted: Number(d) || 0 }));
}

export const DEFAULT_RISK: RiskRule[] = [
  { name: "migration", action: "flag", paths: ["**/migrations/**", "**/*.sql"] },
  { name: "ci-deploy", action: "flag", paths: [".github/workflows/**", "Dockerfile", "docker-compose*.yml", "railway.*", "Procfile", "vercel.json"] },
  { name: "lockfile", action: "flag", paths: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "composer.lock"] },
  { name: "auth", action: "flag", paths: ["**/auth/**", "**/*Policy*", "**/middleware/**", "**/permissions*"] },
  { name: "env-config", action: "flag", paths: [".env.example", "config/**"] },
  { name: "big-delete", action: "flag", deletedLines: 200 },
];

/** which rules this change trips, each with the files that tripped it (a big deletion lists the files that lost most) */
export function riskFlags(changes: Change[], rules: RiskRule[]): RiskFlag[] {
  const flags: RiskFlag[] = [];
  for (const r of rules) {
    if (r.paths) {
      const files = changes.filter((c) => r.paths!.some((g) => matchesGlob(c.path, g))).map((c) => c.path);
      if (files.length) flags.push({ rule: r.name, action: r.action, files });
    } else if (r.deletedLines !== undefined) {
      const total = changes.reduce((n, c) => n + c.deleted, 0);
      if (total >= r.deletedLines) {
        const files = changes.filter((c) => c.deleted > 0).sort((a, b) => b.deleted - a.deleted).slice(0, 10).map((c) => c.path);
        flags.push({ rule: r.name, action: r.action, files });
      }
    }
  }
  return flags;
}

const TEST_FILE = [
  /(^|\/)(tests?|__tests__|spec)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /Test\.php$/,
  /(^|\/)test_[^/]*\.py$/,
  /_test\.(go|py)$/,
];
const isTestFile = (f: string) => TEST_FILE.some((re) => re.test(f));
const SKIP = /\b(?:it|test|describe)\.(?:skip|only)\s*\(|\.only\s*\(|\bx(?:it|describe|test)\s*\(|\bmarkTestSkipped\s*\(|->skip\s*\(|@pytest\.mark\.skip|\bt\.Skip\s*\(|@Ignore\b|@Disabled\b/;
const ASSERT = /\b(?:expect|assert\w*|should)\b|->assert/;
/** the task itself asks to change tests: "remove the old login test", not "tests must pass" */
const ASKED = /\b(remove|delete|drop|skip|disable|rewrite|replace)\b[^.\n]{0,40}\btests?\b/i;
const MAX_DIFF = 2_000_000;

/** Tests weakened to pass: new skip/only markers, deleted test files, fewer assertions. */
export function tamperFindings(diff: string, task: string): Finding[] {
  if (diff.length > MAX_DIFF) return [{ severity: "low", file: "", line: 0, issue: "diff too large to scan for test tampering" }];
  const files = new Map<string, { deleted: boolean; skips: number; added: number; removed: number }>();
  let cur: { deleted: boolean; skips: number; added: number; removed: number } | undefined;
  for (const line of diff.split("\n")) {
    const head = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (head) {
      cur = isTestFile(head[2]) ? { deleted: false, skips: 0, added: 0, removed: 0 } : undefined;
      if (cur) files.set(head[2], cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("deleted file mode")) cur.deleted = true;
    else if (line.startsWith("+") && !line.startsWith("+++")) {
      if (SKIP.test(line)) cur.skips++;
      if (ASSERT.test(line)) cur.added++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      if (ASSERT.test(line)) cur.removed++;
    }
  }
  const asked = ASKED.test(task);
  const sev = (s: Finding["severity"]): Finding["severity"] => (asked ? "low" : s);
  const out: Finding[] = [];
  for (const [file, f] of files) {
    if (f.deleted) out.push({ severity: sev("high"), file, line: 0, issue: "a test file was deleted" });
    else {
      if (f.skips) out.push({ severity: sev("high"), file, line: 0, issue: `a test was skipped or focused (${f.skips} skip/only marker${f.skips > 1 ? "s" : ""} added)` });
      if (f.removed > f.added) out.push({ severity: sev("medium"), file, line: 0, issue: `fewer assertions than before (${f.removed} removed, ${f.added} added): check no test was weakened` });
    }
  }
  return out;
}

const HEADS: Record<string, keyof AgentReport> = { "CHANGED": "changed", "NOT DONE": "notDone", "ASSUMED": "assumed", "NOT VERIFIED": "notVerified" };
const NONE = /^(none|n\/a|nothing|-)\.?$/i;

/** the four parts of an agent's closing report; null when it gave none */
export function parseReport(text: string): AgentReport | null {
  const re = /^[\s>*_-]*(CHANGED|NOT\s+DONE|ASSUMED|NOT\s+VERIFIED)[\s*_]*:[\s*_]*(.*)$/gim;
  const hits = [...text.matchAll(re)];
  if (!hits.length) return null;
  const out: AgentReport = { changed: [], notDone: [], assumed: [], notVerified: [] };
  hits.forEach((m, i) => {
    const key = HEADS[m[1].toUpperCase().replace(/\s+/g, " ")];
    const end = i + 1 < hits.length ? hits[i + 1].index! : text.length;
    const body = `${m[2]}\n${text.slice(m.index! + m[0].length, end)}`;
    out[key].push(...body.split(/\n|;\s+/).map((x) => x.replace(/^[\s*-]+/, "").trim()).filter((x) => x && !NONE.test(x)));
  });
  return out;
}

export const REPORT_INSTRUCTIONS = [
  "End your final message with this report (one line per part; write \"none\" when empty):",
  "CHANGED: the files you changed and why",
  "NOT DONE: any part of the task you did not do",
  "ASSUMED: anything you assumed instead of checking",
  "NOT VERIFIED: anything you could not run or check",
].join("\n");

export const REVIEW_GATES = [
  "Also check:",
  "- Tests made weaker to pass: a looser assertion, a mocked-away subject, a lowered threshold, a skipped case. Each is a finding.",
  "- The workers' reports below: every claim must be backed by the diff. A claim the diff does not support is a finding.",
].join("\n");
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/orchestrator/gates.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit** (agentos commits for you)

---

### Task 2: wire the gates into the engine and the PR body

**Files:**
- Modify: `src/orchestrator/run.ts` (`SubtaskState.report`, `RunState.fixReport`, `RunState.risk`)
- Modify: `src/orchestrator/engine.ts` (prompts, reports, `review()` notes, `verify()`, `gate()`)
- Modify: `src/orchestrator/report.ts` (`prBody`)
- Test: `tests/orchestrator/engine.test.ts` (new describe block), `tests/orchestrator/report.test.ts`

**Interfaces:**
- Consumes (Task 1): everything exported from `gates.ts`, plus `OrchestratorConfig.risk`.
- Produces:
  - `RunState.risk?: RiskFlag[]`
  - `SubtaskState.report?: AgentReport | null`
  - `RunState.fixReport?: AgentReport | null`
  - All three are used by Task 3 and the dashboard.

- [ ] **Step 1: Write the failing tests**

Append to `tests/orchestrator/engine.test.ts`:

```ts
describe("orchestrator engine: smart gates", { timeout: 60_000 }, () => {
  const lockfile = (cwd: string) => writeFileSync(path.join(cwd, "package-lock.json"), "{}\n");

  it("flags a risky file in the PR body and still opens the PR", async () => {
    const d = deps({ plan: planOf(sub("a")), work: (cwd, p) => { creates(cwd, p); lockfile(cwd); } });
    const s = await startRun(repo.root, "add a", cfg(), d);
    expect(s.status).toBe("pr_open");
    expect(s.risk).toEqual([{ rule: "lockfile", action: "flag", files: ["package-lock.json"] }]);
    const body = prCalls(d)[0][1][prCalls(d)[0][1].indexOf("--body") + 1];
    expect(body).toContain("⚠️ Look here");
    expect(body).toContain("lockfile: package-lock.json");
  });

  it("stops at needs_human when a block rule matches, and opens no PR", async () => {
    const d = deps({ plan: planOf(sub("a")), work: (cwd, p) => { creates(cwd, p); lockfile(cwd); } });
    const s = await startRun(repo.root, "add a", cfg({ risk: [{ name: "lockfile", action: "block", paths: ["package-lock.json"] }] }), d);
    expect(s.status).toBe("needs_human");
    expect(s.reason).toContain('risk rule "lockfile" blocks the PR');
    expect(prCalls(d)).toHaveLength(0);
  });

  it("hands a skipped test to the fixer as a high finding", async () => {
    const r2 = makeRepo({ "tests/a.test.js": "it('works', () => { expect(1).toBe(1); });\n" });
    try {
      let fixPrompt = "";
      const d = deps({
        plan: planOf(sub("a")),
        work: (cwd, p) => {
          if (p.includes("does not pass yet")) {
            fixPrompt = p;
            writeFileSync(path.join(cwd, "tests/a.test.js"), "it('works', () => { expect(1).toBe(1); });\n");
          } else writeFileSync(path.join(cwd, "tests/a.test.js"), "it.skip('works', () => { expect(1).toBe(1); });\n");
        },
      });
      const s = await startRun(r2.root, "make it pass", cfg(), d);
      expect(fixPrompt).toMatch(/\[high\] tests\/a\.test\.js:0 a test was skipped/);
      expect(s.status).toBe("pr_open");
    } finally { r2.cleanup(); }
  });

  it("puts the agents' reports in the PR body and tells the reviewer to check them", async () => {
    let reviewPromptText = "";
    const d = deps({
      plan: planOf(sub("a")),
      work: (cwd, p) => { creates(cwd, p); return reply("Made a.txt.\nCHANGED: a.txt\nNOT DONE: the docs\nASSUMED: UTF-8\nNOT VERIFIED: none"); },
      review: (p) => { reviewPromptText = p; return "[]"; },
    });
    const s = await startRun(repo.root, "add a", cfg(), d);
    expect(s.subtasks[0].report).toEqual({ changed: ["a.txt"], notDone: ["the docs"], assumed: ["UTF-8"], notVerified: [] });
    const body = prCalls(d)[0][1][prCalls(d)[0][1].indexOf("--body") + 1];
    expect(body).toContain("What the agents report");
    expect(body).toContain("Not done: the docs");
    expect(body).toContain("Assumed: UTF-8");
    expect(reviewPromptText).toContain("NOT DONE: the docs");
    expect(reviewPromptText).toContain("Tests made weaker to pass");
  });

  it("says when an agent gave no report", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates });
    await startRun(repo.root, "add a", cfg(), d);
    const body = prCalls(d)[0][1][prCalls(d)[0][1].indexOf("--body") + 1];
    expect(body).toContain("a (claude): no report");
  });

  it("asks workers for the report", async () => {
    let workPrompt = "";
    const d = deps({ plan: planOf(sub("a")), work: (cwd, p) => { workPrompt = p; creates(cwd, p); } });
    await startRun(repo.root, "add a", cfg(), d);
    expect(workPrompt).toContain("NOT VERIFIED:");
  });
});
```

`reply` and `makeRepo` are already imported or defined in this file. Check the top of the file; if `makeRepo` is not imported, import it from `./helpers.js`.

In `tests/orchestrator/report.test.ts`, add one case using the existing `RunState` fixture style:

```ts
  it("leads with the risk flags and lists what the agents did not do", () => {
    const body = prBody({ ...base, risk: [{ rule: "migration", action: "flag", files: ["db/migrations/1.sql"] }],
      subtasks: [{ id: "a", agent: "claude", status: "done", branch: "b", worktree: "w", report: { changed: ["x"], notDone: ["y"], assumed: [], notVerified: ["z"] } }] });
    expect(body.indexOf("⚠️ Look here")).toBeLessThan(body.indexOf("| Subtask |"));
    expect(body).toContain("migration: db/migrations/1.sql");
    expect(body).toContain("Not done: y");
    expect(body).toContain("Not verified: z");
  });
```

Read the existing tests first. If no `base` fixture exists, build one with the same fields the file's other tests use.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/orchestrator/engine.test.ts tests/orchestrator/report.test.ts`
Expected: FAIL. The new fields and sections do not exist yet.

- [ ] **Step 3: Implement**

**`src/orchestrator/run.ts`.** Import the types from `./gates.js`:

```ts
import type { AgentReport, RiskFlag } from "./gates.js";
```

Add to `SubtaskState`:

```ts
  /** the worker's closing report (PRD 4.5); null when it gave none */
  report?: AgentReport | null;
```

Add to `RunState`:

```ts
  /** the last fix round's closing report */
  fixReport?: AgentReport | null;
  /** risk rules this run's change tripped (flag only; a block stops the run) */
  risk?: RiskFlag[];
```

**`src/orchestrator/engine.ts`.**

1. Import:

```ts
import { DEFAULT_RISK, REPORT_INSTRUCTIONS, REVIEW_GATES, parseNumstat, parseReport, riskFlags, tamperFindings, type AgentReport } from "./gates.js";
```

2. In `workerPrompt` and `fixPrompt`, add `REPORT_INSTRUCTIONS` as the last array element, before `.filter(Boolean)`. In `workerPrompt` it goes after `note`. In `fixPrompt` it also goes after `note`.

3. In `work()`, right after `t.summary = redact(finalText(res.output)).slice(0, 1500);`:

```ts
    t.report = parseReport(redact(finalText(res.output)));
```

4. In `fix()`, right after the rate-limit `if` block:

```ts
  s.fixReport = parseReport(redact(finalText(res.output)));
```

5. Add these helpers next to `notes()`:

```ts
const reportLine = (r: AgentReport | null | undefined) =>
  r ? `CHANGED: ${r.changed.join("; ") || "none"}\nNOT DONE: ${r.notDone.join("; ") || "none"}\nASSUMED: ${r.assumed.join("; ") || "none"}\nNOT VERIFIED: ${r.notVerified.join("; ") || "none"}` : "(no report)";

/** the reviewer's extra instructions: weakened tests, and the workers' claims to check against the diff */
function reviewNotes(c: Ctx): string {
  const reports = [
    ...c.s.subtasks.map((t) => `${t.id} (${t.agent}):\n${reportLine(t.report)}`),
    ...(c.s.fixRound > 0 ? [`last fix round:\n${reportLine(c.s.fixReport)}`] : []),
  ].join("\n\n");
  return [notes(c, "reviewer"), REVIEW_GATES, `Workers' reports:\n${reports}`].filter(Boolean).join("\n\n");
}
```

6. In `review()`, replace both `notes(c, "reviewer")` arguments (in the `reReviewPrompt` and `reviewPrompt` calls) with `reviewNotes(c)`.

7. In `verify()`:
   - Right after `const [v, r] = await Promise.all([...])`, compute:

     ```ts
       const tamper = tamperFindings(git(s.runWorktree, ["diff", `${s.base}..HEAD`]), s.task);
     ```

   - In the `!r.ran` branch, change the assignment to `s.findings = [...tamper, { severity: "low", ... }]`, keeping the existing low finding.
   - In the `else` branch, change it to `s.findings = [...r.findings, ...tamper];`.
   - Leave `s.reviewed = { head: r.head, findings: r.findings };` as it is: reviewer findings only, because tampering is recomputed on every verify.

8. In `gate()`, after the secret-scan line `if (hits.length) return move(...)` and before `if (cancelled())`:

```ts
  const numstat = tryGit(s.runWorktree, ["diff", "--numstat", "--no-renames", `${s.base}..HEAD`]);
  if (numstat.ok) {
    const flags = riskFlags(parseNumstat(numstat.out), c.cfg.risk ?? DEFAULT_RISK);
    const blocked = flags.filter((f) => f.action === "block");
    if (blocked.length) {
      return move(c, "needs_human", blocked.map((f) => `risk rule "${f.rule}" blocks the PR: ${f.files.slice(0, 5).join(", ")}`).join("; "));
    }
    s.risk = flags;
  } else {
    s.findings = [...s.findings, { severity: "low", file: "", line: 0, issue: "the risk check could not read the diff (git diff --numstat failed)" }];
  }
  saveRun(root, s);
```

**`src/orchestrator/report.ts`.** In `prBody`, add two sections.

The **"⚠️ Look here"** section goes right after the `**Task:**` line:

```ts
    s.risk?.length
      ? `**⚠️ Look here** — risky parts of this change:\n${s.risk.map((f) => `- ${f.rule}: ${f.files.slice(0, 5).join(", ")}${f.files.length > 5 ? ` (+${f.files.length - 5} more)` : ""}`).join("\n")}`
      : "",
```

The **"What the agents report"** section goes right after the subtasks table:

```ts
    agentReports(s),
```

with this helper above `prBody`:

```ts
import type { AgentReport } from "./gates.js";

const PARTS: Array<[keyof AgentReport, string]> = [["notDone", "Not done"], ["assumed", "Assumed"], ["notVerified", "Not verified"]];

/** what the agents themselves say they left out, assumed or could not check */
function agentReports(s: RunState): string {
  const who = [
    ...s.subtasks.map((t) => ({ name: `${t.id} (${t.agent})`, r: t.report })),
    ...(s.fixRound > 0 ? [{ name: "last fix round", r: s.fixReport }] : []),
  ];
  const lines = who.flatMap(({ name, r }) => {
    if (!r) return [`- ${name}: no report`];
    const parts = PARTS.filter(([k]) => r[k].length).map(([k, label]) => `  - ${label}: ${r[k].map(cell).join("; ")}`);
    return parts.length ? [`- ${name}:`, ...parts] : [];
  });
  return lines.length ? `**What the agents report:**\n${lines.join("\n")}` : "";
}
```

`cell()` already exists in the file; it trims to one line and 120 characters.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/orchestrator && npx tsc --noEmit`
Expected: PASS. The existing engine tests must still pass. One worry is that a default flag on a file an existing test writes would change their PR bodies; they only check selected parts, so that is fine.

- [ ] **Step 5: Commit** (agentos commits for you)

---

### Task 3: relevant lessons only, flagged PRs under "Needs you", docs

**Files:**
- Modify: `src/learning/inject.ts` (`lessonsFor`)
- Modify: `src/ui/api.ts` (`summarise` needsYou, `RunRow.flagged`, `runList`)
- Modify: `ui/app.js` (the "Needs you" filter includes flagged PRs)
- Modify: `README.md` (a "Smart gates" section after the `agentos run` section)
- Test: `tests/learning/inject.test.ts` (or the existing lessons injection test file; check `tests/learning/`), `tests/ui/api-read.test.ts`

**Interfaces:**
- Consumes (Task 2): `RunState.risk?: RiskFlag[]`.
- Produces: `RunRow.flagged?: boolean` (the API field the dashboard reads).

- [ ] **Step 1: Write the failing tests**

In the lessons injection tests (find the file that tests `lessonsFor`), add:

```ts
  it("leaves out lessons that share no meaningful word with the task", () => {
    // store two auto lessons for role "worker": one about migrations, one about CSS
    // (use the same helper the other tests in this file use to save lessons)
    const r = lessonsFor(root, "worker", "add a database migration for invoices", 5);
    expect(r.block).toContain("migration");
    expect(r.block).not.toContain("CSS");
  });
```

Write it using the file's existing lesson-saving helper and fixture setup. The two lessons are:
- `"Run php artisan migrate --pretend before a database migration"`
- `"Keep CSS class names in kebab-case"`

In `tests/ui/api-read.test.ts`, add a test.
- Save a `pr_open` run with `risk: [{ rule: "lockfile", action: "flag", files: ["package-lock.json"] }]` in the registered test project, using the same `saveRun` fixture pattern as the file's other run tests.
- Assert that `GET /api/p/<id>/runs` returns it with `flagged: true`.
- Assert that `GET /api/projects` counts it in `needsYou`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/learning tests/ui/api-read.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

**`src/learning/inject.ts`.** Score with meaningful words only, and drop zero scores:

```ts
const STOP = new Set(["with", "that", "this", "from", "have", "when", "then", "into", "must", "should", "each", "only", "also", "make", "does"]);
/** words that carry meaning: longer than 3 letters and not glue */
const meaningful = (s: string) => new Set([...words(s)].filter((w) => w.length > 3 && !STOP.has(w)));
```

In `lessonsFor`:
- Use `const taskWords = meaningful(task);`.
- Score with `[...meaningful(l.text)].filter((w) => taskWords.has(w)).length`.
- Add `.filter((x) => x.score > 0)` before the sort.

**`src/ui/api.ts`.**
- Add `flagged?: boolean;` to `RunRow`.
- In `runList`, add `flagged: (r.risk?.length ?? 0) > 0` to the returned row.
- In `summarise`, use `needsYou: week.filter((r) => NEEDS_YOU.includes(r.status) || (r.status === "pr_open" && (r.risk?.length ?? 0) > 0)).length,`.

**`ui/app.js`.** In the home "Needs you" box, the filter at the line using `NEEDS_YOU.indexOf(r.status) >= 0` becomes `NEEDS_YOU.indexOf(r.status) >= 0 || r.flagged`. Where a run row is drawn in the runs list, a flagged run also shows a `⚠️` before its status pill. Use `text()` or `h()` only, never `innerHTML`.

**`README.md`.** Add the section `### Smart gates` under the `agentos run` section. It describes:
- the default risk rules, how to set `orchestrator.risk` (with a YAML example blocking migrations), and that flags show as "⚠️ Look here" in the PR and under "Needs you" in the dashboard
- test-tampering detection and its exemption wording
- the agents' closing report (CHANGED / NOT DONE / ASSUMED / NOT VERIFIED) and where it appears

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit** (agentos commits for you)

---

## After the tasks (the controller, not agentos)

1. Real run, recorded in `bench/gates-e2e.md`: run `agentos run --quick` on this repo with a task that touches `package-lock.json`, for example a patch-version bump of a dev dependency. Check that the PR body shows the lockfile flag and the agents' report. Also run one fake-runner check in which a worker adds `it.skip` and the fixer is told.
2. Release 0.7.0: version, CHANGELOG, bench, then the owner publishes. Before that, run `npm.cmd whoami`; if it fails, `npm.cmd login`. Then sync the ERP pin.
