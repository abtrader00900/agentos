# Orchestrator Engine (PRD 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `agentos run "<task>"` plans the task, runs Claude Code / Codex workers in parallel git worktrees, verifies with tests plus a cross-model review, loops fixes, and opens a pull request.

**Architecture:** A fixed-role pipeline in `src/orchestrator/`: a planner (read-only agent) returns a JSON plan, a scheduler runs subtasks in worktrees, and each finished subtask merges into a run branch. A verifier runs the configured commands and a reviewer agent, a fixer loops, and a gate secret-scans, pushes and runs `gh pr create`. Run state is a JSON file per run under `.agentos/runs/<id>/`, so any run can resume. Agent CLIs are spawned with fixed argv and the prompt on stdin.

**Tech Stack:** TypeScript (strict, ESM, Node16 resolution), Node ≥ 20, zod, commander, @modelcontextprotocol/sdk, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-30-orchestrator-design.md`

## Global Constraints

- **No new runtime or dev dependencies.** Use `node:child_process`, `node:fs`, `node:os`, `zod`, `commander` and the MCP SDK already in `package.json`.
- **Imports** use the `.js` suffix (`import { x } from "./run.js"`), like the rest of `src/`.
- **Windows is first-class:**
  - Agent CLIs are spawned through the shell on win32 with fixed argv only. The prompt always goes through stdin.
  - Process trees are killed with `taskkill /PID <pid> /T /F`, and never by image name.
- **Never push the default branch.** Only `agentos/run-*` branches are pushed.
- **Never pass these flags:** `--dangerously-skip-permissions`, `--yolo`, `--dangerously-bypass-approvals-and-sandbox`.
- **Run ids match `/^[0-9A-Za-z-]{1,40}$/`**, enforced in `runDir()`.
- **`autonomy` accepts only `pr`** in this release.
- **Automated tests never call a real model.** They use in-process fake runners or small node scripts.
- **New tests** live in `tests/orchestrator/` (already matched by `vitest.config.ts`).
- **Run the gates after every task:** `npx vitest run tests/orchestrator` plus `npx tsc --noEmit`. The full `npm test` must stay green (baseline: 224 tests).
- **Commit once per task.** The message style follows the repo (`feat(orchestrator): …`).
- **`dist/` is committed** in this repo. It is rebuilt and committed only in Task 13.

---

### Task 1: `orchestrator` config block

**Files:**
- Modify: `src/core/schema.ts` (add the schema, add the field to `agentConfigSchema`)
- Test: `tests/orchestrator/schema.test.ts`

**Interfaces:**
- Produces:
  - `agentNameSchema` (zod enum `"claude" | "codex"`) and `type AgentName`
  - `orchestratorSchema` and `type OrchestratorConfig` = `{ autonomy: "pr"|"merge"|"deploy"; maxWorkers: number; maxFixRounds: number; maxMinutes: number; subtaskMinutes: number; planner: AgentName; workers: AgentName[]; reviewer: AgentName; verify: string[]; minFreeMemoryMb: number; link: string[] }`
  - `AgentConfig.orchestrator?: OrchestratorConfig`

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/schema.test.ts
import { describe, it, expect } from "vitest";
import { agentConfigSchema, orchestratorSchema } from "../../src/core/schema.js";

const base = { project: { name: "p" } };

describe("orchestrator config", () => {
  it("is optional: configs from 0.2.x parse unchanged", () => {
    expect(agentConfigSchema.parse(base).orchestrator).toBeUndefined();
  });

  it("fills every default from an empty block", () => {
    expect(agentConfigSchema.parse({ ...base, orchestrator: {} }).orchestrator).toEqual({
      autonomy: "pr", maxWorkers: 2, maxFixRounds: 3, maxMinutes: 90, subtaskMinutes: 20,
      planner: "claude", workers: ["claude", "codex"], reviewer: "codex", verify: [],
      minFreeMemoryMb: 1500, link: ["node_modules"],
    });
  });

  it("rejects merge and deploy autonomy in this release", () => {
    const r = orchestratorSchema.safeParse({ autonomy: "merge" });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("only autonomy: pr");
  });

  it("rejects an agent it cannot drive", () => {
    expect(orchestratorSchema.safeParse({ workers: ["gemini"] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/orchestrator/schema.test.ts`
Expected: FAIL. `orchestratorSchema` is not exported.

- [ ] **Step 3: Implement**

In `src/core/schema.ts`, add this above `agentConfigSchema`:

```ts
export const agentNameSchema = z.enum(["claude", "codex"]);
export type AgentName = z.infer<typeof agentNameSchema>;

/** `agentos run`: plan → parallel workers → verify + cross-model review → PR (PRD 1) */
export const orchestratorSchema = z.object({
  /** how far a run may go on its own; merge/deploy come in a later release */
  autonomy: z
    .enum(["pr", "merge", "deploy"])
    .default("pr")
    .refine((a) => a === "pr", { message: "only autonomy: pr is available in this version (merge and deploy come in a later release)" }),
  maxWorkers: z.number().int().min(1).max(8).default(2),
  maxFixRounds: z.number().int().min(0).max(10).default(3),
  /** the whole run, per engine session */
  maxMinutes: z.number().positive().default(90),
  /** one agent call */
  subtaskMinutes: z.number().positive().default(20),
  planner: agentNameSchema.default("claude"),
  workers: z.array(agentNameSchema).min(1).default(["claude", "codex"]),
  /** reviews the diff; swapped for the other CLI when it wrote every subtask */
  reviewer: agentNameSchema.default("codex"),
  /** shell commands that must pass before a PR opens, run in the run worktree */
  verify: z.array(z.string().min(1)).default([]),
  /** a second worker only starts while this much memory is free */
  minFreeMemoryMb: z.number().nonnegative().default(1500),
  /** folders linked from the checkout into each worktree (installed deps the verify commands need) */
  link: z.array(z.string().min(1)).default(["node_modules"]),
});
export type OrchestratorConfig = z.infer<typeof orchestratorSchema>;
```

Then add this as the last field of `agentConfigSchema` (after `staleAfter`):

```ts
  /** agentos run — absent means the command explains how to add it */
  orchestrator: orchestratorSchema.optional(),
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run tests/orchestrator/schema.test.ts && npx tsc --noEmit`
Expected: 4 passed, and tsc reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/schema.ts tests/orchestrator/schema.test.ts
git commit -m "feat(orchestrator): optional orchestrator block in agent.config.yaml"
```

---

### Task 2: Shared types and plan validation

**Files:**
- Create: `src/orchestrator/types.ts`, `src/orchestrator/plan.ts`
- Test: `tests/orchestrator/plan.test.ts`

**Interfaces:**
- Consumes: `AgentName` and `agentNameSchema` from Task 1.
- Produces (in `types.ts`):
  - `Subtask { id; title; prompt; files: string[]; dependsOn: string[]; agent: AgentName }`
  - `Plan { summary; subtasks: Subtask[] }`
  - `Finding { severity: "high"|"medium"|"low"; file; line: number; issue }`
  - `RunnerRequest { prompt; cwd; timeoutMs; onLine?(line); onSpawn?(pid) }`
  - `RunnerResult { ok; output; rateLimited; timedOut }`
  - `type Runner = (req: RunnerRequest) => Promise<RunnerResult>`
- Produces (in `plan.ts`):
  - `validatePlan(raw: unknown, allowedAgents?: readonly string[]): { plan?: Plan; error?: string }`
  - `topoOrder(plan: Plan): string[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/plan.test.ts
import { describe, it, expect } from "vitest";
import { validatePlan, topoOrder } from "../../src/orchestrator/plan.js";

const sub = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, title: id, prompt: `do ${id}`, files: [], dependsOn: [], agent: "claude", ...over });
const plan = (...subtasks: object[]) => ({ summary: "s", subtasks });

describe("plan validation", () => {
  it("accepts a one-subtask plan", () => {
    expect(validatePlan(plan(sub("a"))).plan?.subtasks).toHaveLength(1);
  });

  it("rejects a dependency cycle", () => {
    expect(validatePlan(plan(sub("a", { dependsOn: ["b"] }), sub("b", { dependsOn: ["a"] }))).error).toContain("cycle");
  });

  it("rejects an unknown dependency", () => {
    expect(validatePlan(plan(sub("a", { dependsOn: ["zzz"] }))).error).toBe('subtask "a" depends on unknown "zzz"');
  });

  it("rejects duplicate ids", () => {
    expect(validatePlan(plan(sub("a"), sub("a"))).error).toContain('duplicate subtask id "a"');
  });

  it("rejects parallel subtasks that change the same file, whatever the slashes", () => {
    const r = validatePlan(plan(sub("a", { files: ["src\\x.ts"] }), sub("b", { files: ["./src/x.ts"] })));
    expect(r.error).toBe('subtasks "a" and "b" both change src/x.ts — chain them with dependsOn');
  });

  it("allows a shared file when the subtasks are chained, even indirectly", () => {
    const r = validatePlan(plan(sub("a", { files: ["x.ts"] }), sub("b", { dependsOn: ["a"] }), sub("c", { dependsOn: ["b"], files: ["x.ts"] })));
    expect(r.error).toBeUndefined();
  });

  it("rejects an agent the config does not allow", () => {
    expect(validatePlan(plan(sub("a", { agent: "codex" })), ["claude"]).error).toContain('uses agent "codex"');
  });

  it("rejects malformed ids and empty plans", () => {
    expect(validatePlan(plan(sub("Bad Id"))).error).toContain("ids are lowercase");
    expect(validatePlan(plan()).error).toBeDefined();
  });

  it("orders dependencies first", () => {
    const p = validatePlan(plan(sub("c", { dependsOn: ["b"] }), sub("b", { dependsOn: ["a"] }), sub("a"))).plan!;
    expect(topoOrder(p)).toEqual(["a", "b", "c"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/orchestrator/plan.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

```ts
// src/orchestrator/types.ts
import type { AgentName } from "../core/schema.js";

export type { AgentName };

export interface Subtask {
  id: string;
  title: string;
  /** complete instructions: the worker sees only this and the plan summary */
  prompt: string;
  files: string[];
  dependsOn: string[];
  agent: AgentName;
}

export interface Plan {
  summary: string;
  subtasks: Subtask[];
}

export interface Finding {
  severity: "high" | "medium" | "low";
  file: string;
  line: number;
  issue: string;
}

export interface RunnerRequest {
  prompt: string;
  cwd: string;
  timeoutMs: number;
  onLine?: (line: string) => void;
  onSpawn?: (pid: number) => void;
}

export interface RunnerResult {
  ok: boolean;
  output: string;
  rateLimited: boolean;
  timedOut: boolean;
}

export type Runner = (req: RunnerRequest) => Promise<RunnerResult>;
```

```ts
// src/orchestrator/plan.ts
import { z } from "zod";
import { agentNameSchema } from "../core/schema.js";
import type { Plan } from "./types.js";

const planSchema = z.object({
  summary: z.string().min(1),
  subtasks: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "ids are lowercase letters, digits and dashes"),
        title: z.string().min(1),
        prompt: z.string().min(1),
        files: z.array(z.string()).default([]),
        dependsOn: z.array(z.string()).default([]),
        agent: agentNameSchema,
      }),
    )
    .min(1)
    .max(8),
});

const norm = (f: string) => f.replace(/\\/g, "/").replace(/^\.\//, "");

/** Kahn's algorithm: ids with dependencies first. Throws on a cycle. */
export function topoOrder(plan: Plan): string[] {
  const left = new Map(plan.subtasks.map((s) => [s.id, s.dependsOn.length]));
  const queue = plan.subtasks.filter((s) => s.dependsOn.length === 0).map((s) => s.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of plan.subtasks) {
      if (!s.dependsOn.includes(id)) continue;
      const n = left.get(s.id)! - 1;
      left.set(s.id, n);
      if (n === 0) queue.push(s.id);
    }
  }
  if (order.length !== plan.subtasks.length) {
    const stuck = plan.subtasks.filter((s) => !order.includes(s.id)).map((s) => s.id);
    throw new Error(`dependency cycle between: ${stuck.join(", ")}`);
  }
  return order;
}

/** does `from` depend on `to`, directly or through other subtasks? */
function reaches(plan: Plan, from: string, to: string): boolean {
  const byId = new Map(plan.subtasks.map((s) => [s.id, s]));
  const stack = [...byId.get(from)!.dependsOn];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...byId.get(id)!.dependsOn);
  }
  return false;
}

/**
 * The planner's JSON, checked: schema, unique ids, allowed agents, known
 * dependencies, no cycles, and no two unchained subtasks changing one file
 * (they would run in parallel and conflict).
 */
export function validatePlan(raw: unknown, allowedAgents?: readonly string[]): { plan?: Plan; error?: string } {
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
  }
  const plan: Plan = {
    summary: parsed.data.summary,
    subtasks: parsed.data.subtasks.map((s) => ({ ...s, files: s.files.map(norm), dependsOn: [...new Set(s.dependsOn)] })),
  };
  const ids = new Set<string>();
  for (const s of plan.subtasks) {
    if (ids.has(s.id)) return { error: `duplicate subtask id "${s.id}"` };
    ids.add(s.id);
    if (allowedAgents && !allowedAgents.includes(s.agent)) {
      return { error: `subtask "${s.id}" uses agent "${s.agent}", allowed: ${allowedAgents.join(", ")}` };
    }
  }
  for (const s of plan.subtasks) {
    for (const d of s.dependsOn) if (!ids.has(d)) return { error: `subtask "${s.id}" depends on unknown "${d}"` };
  }
  try {
    topoOrder(plan);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const subs = plan.subtasks;
  for (let i = 0; i < subs.length; i++) {
    for (let j = i + 1; j < subs.length; j++) {
      const shared = subs[i].files.find((f) => subs[j].files.includes(f));
      if (shared && !reaches(plan, subs[i].id, subs[j].id) && !reaches(plan, subs[j].id, subs[i].id)) {
        return { error: `subtasks "${subs[i].id}" and "${subs[j].id}" both change ${shared} — chain them with dependsOn` };
      }
    }
  }
  return { plan };
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run tests/orchestrator/plan.test.ts && npx tsc --noEmit`
Expected: 9 passed, and tsc reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/types.ts src/orchestrator/plan.ts tests/orchestrator/plan.test.ts
git commit -m "feat(orchestrator): plan schema with cycle, dependency and file-overlap checks"
```

---

### Task 3: Run state on disk

**Files:**
- Modify: `src/core/jsonstore.ts`. Export the existing `retrying` helper by changing `function retrying` to `export function retrying`.
- Create: `src/orchestrator/run.ts`
- Test: `tests/orchestrator/run.test.ts`

**Interfaces:**
- Consumes: `Plan`, `Finding` and `AgentName` from Task 2.
- Produces:
  - `type RunStatus = "queued"|"planning"|"working"|"verifying"|"fixing"|"paused"|"pr_open"|"needs_human"|"failed"|"cancelled"`
  - `TERMINAL: readonly RunStatus[]`
  - `SubtaskState { id; agent; status: "pending"|"running"|"done"|"failed"; branch; worktree; summary? }`
  - `RunState` (fields below)
  - Path helpers:
    - `runsDir(root)`
    - `runDir(root, id)`, which throws `invalid run id` on a bad id
  - Id and persistence:
    - `newRunId(now?)`
    - `saveRun(root, s)`
    - `loadRun(root, id)`
    - `listRuns(root)` (newest first)
    - `logEvent(root, id, event)`
    - `setStatus(root, s, status, reason?)`
  - Cancellation:
    - `requestCancel(root, id)`
    - `cancelRequested(root, id)`

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/run.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  newRunId, saveRun, loadRun, listRuns, setStatus, runDir, requestCancel, cancelRequested,
  type RunState, type RunStatus,
} from "../../src/orchestrator/run.js";

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), "agentos-run-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

const state = (id: string, createdAt: string, status: RunStatus = "queued"): RunState => ({
  id, task: "t", status, baseBranch: "main", base: "abc", branch: `agentos/run-${id}`, runWorktree: "/x",
  createdAt, updatedAt: createdAt, subtasks: [], fixRound: 0, findings: [],
});

describe("run state", () => {
  it("saves and loads a run", () => {
    saveRun(root, state("r1", "2026-09-30T10:00:00.000Z"));
    const s = loadRun(root, "r1");
    expect(s.task).toBe("t");
    expect(s.updatedAt >= "2026-09-30T10:00:00.000Z").toBe(true);
  });

  it("lists runs newest first", () => {
    saveRun(root, state("old", "2026-09-29T10:00:00.000Z"));
    saveRun(root, state("new", "2026-09-30T10:00:00.000Z"));
    expect(listRuns(root).map((s) => s.id)).toEqual(["new", "old"]);
  });

  it("logs each status change and never leaves a final status", () => {
    const s = state("r2", "2026-09-30T10:00:00.000Z");
    saveRun(root, s);
    setStatus(root, s, "planning");
    setStatus(root, s, "failed", "boom");
    const events = readFileSync(path.join(runDir(root, "r2"), "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(events.map((e) => e.status)).toEqual(["planning", "failed"]);
    expect(loadRun(root, "r2").reason).toBe("boom");
    expect(() => setStatus(root, s, "working")).toThrow("run r2 is already failed");
  });

  it("makes sortable ids and refuses path-like ones", () => {
    expect(newRunId(new Date("2026-09-30T12:34:56Z"))).toMatch(/^20260930123456-[0-9a-f]{4}$/);
    expect(() => runDir(root, "../evil")).toThrow("invalid run id");
    expect(() => loadRun(root, "nope")).toThrow('No run "nope"');
  });

  it("records a cancel request", () => {
    expect(cancelRequested(root, "r3")).toBe(false);
    requestCancel(root, "r3");
    expect(cancelRequested(root, "r3")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/orchestrator/run.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

In `src/core/jsonstore.ts`, change `function retrying<T>(fn: () => T): T {` to `export function retrying<T>(fn: () => T): T {`.

```ts
// src/orchestrator/run.ts
import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { retrying } from "../core/jsonstore.js";
import type { AgentName, Finding, Plan } from "./types.js";

export type RunStatus =
  | "queued" | "planning" | "working" | "verifying" | "fixing" | "paused"
  | "pr_open" | "needs_human" | "failed" | "cancelled";

export const TERMINAL: readonly RunStatus[] = ["pr_open", "needs_human", "failed", "cancelled"];

export interface SubtaskState {
  id: string;
  agent: AgentName;
  status: "pending" | "running" | "done" | "failed";
  branch: string;
  worktree: string;
  summary?: string;
}

export interface RunState {
  id: string;
  task: string;
  status: RunStatus;
  reason?: string;
  /** where a paused run continues */
  resumeFrom?: RunStatus;
  baseBranch: string;
  /** commit the run branch started from (moves when a newer base is merged in) */
  base: string;
  branch: string;
  runWorktree: string;
  createdAt: string;
  updatedAt: string;
  plan?: Plan;
  subtasks: SubtaskState[];
  fixRound: number;
  findings: Finding[];
  verifyOk?: boolean;
  verifyOutput?: string;
  prUrl?: string;
  enginePid?: number;
}

export const runsDir = (root: string) => path.join(root, ".agentos", "runs");

export function runDir(root: string, id: string): string {
  if (!/^[0-9A-Za-z-]{1,40}$/.test(id)) throw new Error(`invalid run id "${id}"`);
  return path.join(runsDir(root), id);
}

/** sortable by time, unique enough for one machine: 20260930123456-a1b2 */
export function newRunId(now = new Date()): string {
  return `${now.toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(2).toString("hex")}`;
}

export function saveRun(root: string, state: RunState): void {
  const dir = runDir(root, state.id);
  mkdirSync(dir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  const file = path.join(dir, "state.json");
  writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
  retrying(() => renameSync(`${file}.tmp`, file));
}

export function loadRun(root: string, id: string): RunState {
  const file = path.join(runDir(root, id), "state.json");
  if (!existsSync(file)) throw new Error(`No run "${id}" in ${runsDir(root)}`);
  return JSON.parse(retrying(() => readFileSync(file, "utf8"))) as RunState;
}

export function listRuns(root: string): RunState[] {
  if (!existsSync(runsDir(root))) return [];
  return readdirSync(runsDir(root))
    .filter((id) => /^[0-9A-Za-z-]{1,40}$/.test(id) && existsSync(path.join(runsDir(root), id, "state.json")))
    .map((id) => loadRun(root, id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function logEvent(root: string, id: string, event: Record<string, unknown>): void {
  const dir = runDir(root, id);
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, "events.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n");
}

/** Move to a new status, persist it, log it. A finished run never changes again. */
export function setStatus(root: string, state: RunState, status: RunStatus, reason?: string): void {
  if (TERMINAL.includes(state.status)) throw new Error(`run ${state.id} is already ${state.status}`);
  state.status = status;
  state.reason = reason;
  saveRun(root, state);
  logEvent(root, state.id, { type: "status", status, reason });
}

/** the engine polls for this file and stops the run's agents */
export function requestCancel(root: string, id: string): void {
  mkdirSync(runDir(root, id), { recursive: true });
  writeFileSync(path.join(runDir(root, id), "cancel"), new Date().toISOString());
}

export const cancelRequested = (root: string, id: string) => existsSync(path.join(runDir(root, id), "cancel"));
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run tests/orchestrator/run.test.ts && npx tsc --noEmit && npm test`
Expected: 5 passed, tsc clean, and the full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/core/jsonstore.ts src/orchestrator/run.ts tests/orchestrator/run.test.ts
git commit -m "feat(orchestrator): run state, event log and cancel flag under .agentos/runs"
```

---

### Task 4: Git workspace helpers

**Files:**
- Create: `src/orchestrator/workspace.ts`, `tests/orchestrator/helpers.ts`
- Test: `tests/orchestrator/workspace.test.ts`

**Interfaces:**
- Produces:
  - Git calls:
    - `git(cwd, args): string` (throws on failure)
    - `tryGit(cwd, args): { ok; out }`
    - `head(cwd)`
  - Branches and status:
    - `defaultBranch(root)`
    - `statusOf(cwd)`
    - `ensureExcluded(root, pattern)`
  - Worktrees:
    - `addWorktree(root, dir, branch, from)`
    - `linkDeps(root, dir, links)`
    - `removeWorktree(root, dir, links)`
  - Commits and merges:
    - `commitAll(cwd, message): boolean`
    - `mergeBranch(cwd, ref, message): { ok; conflicts: string[] }`
    - `mergeInProgress(cwd)`
    - `abortMerge(cwd)`
- Produces (test helper):
  - `makeRepo(files?)` returns `{ tmp, root, remote, cleanup }`, a repo on `main` pushed to a bare `origin`.
  - `sh(cwd, args)`.

- [ ] **Step 1: Write the test helper and the failing test**

```ts
// tests/orchestrator/helpers.ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// commits made by tests (and by the engine under test) need an identity
for (const [k, v] of Object.entries({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" })) {
  process.env[k] ??= v;
}

export const sh = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** a repo on branch main with one commit, pushed to a bare "origin" beside it */
export function makeRepo(files: Record<string, string> = {}) {
  const tmp = mkdtempSync(path.join(tmpdir(), "agentos-orch-"));
  const root = path.join(tmp, "repo");
  const remote = path.join(tmp, "remote.git");
  sh(tmp, ["init", "-q", "--bare", "-b", "main", remote]);
  mkdirSync(root);
  sh(root, ["init", "-q", "-b", "main"]);
  const all: Record<string, string> = { "README.md": "# test\n", ".gitignore": ".agentos/memory.json*\n", ...files };
  for (const [p, c] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    writeFileSync(path.join(root, p), c);
  }
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-qm", "first"]);
  sh(root, ["remote", "add", "origin", remote]);
  sh(root, ["push", "-q", "-u", "origin", "main"]);
  return { tmp, root, remote, cleanup: () => rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }) };
}
```

```ts
// tests/orchestrator/workspace.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { makeRepo, sh } from "./helpers.js";
import {
  ensureExcluded, statusOf, addWorktree, commitAll, mergeBranch, linkDeps, removeWorktree, defaultBranch, head,
} from "../../src/orchestrator/workspace.js";

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo.cleanup());

describe("workspace", () => {
  it("hides .agentos/runs from git status, adding the pattern once", () => {
    repo = makeRepo();
    mkdirSync(path.join(repo.root, ".agentos", "runs", "x"), { recursive: true });
    writeFileSync(path.join(repo.root, ".agentos", "runs", "x", "state.json"), "{}");
    expect(statusOf(repo.root)).not.toBe("");
    ensureExcluded(repo.root, "/.agentos/runs/");
    ensureExcluded(repo.root, "/.agentos/runs/");
    expect(statusOf(repo.root)).toBe("");
    const exclude = readFileSync(path.join(repo.root, ".git", "info", "exclude"), "utf8");
    expect(exclude.match(/\/\.agentos\/runs\//g)).toHaveLength(1);
  });

  it("adds a worktree on a new branch and reuses it on resume", () => {
    repo = makeRepo();
    const dir = path.join(repo.tmp, "wt");
    addWorktree(repo.root, dir, "agentos/run-1", head(repo.root));
    addWorktree(repo.root, dir, "agentos/run-1", head(repo.root));
    expect(sh(dir, ["branch", "--show-current"])).toBe("agentos/run-1");
  });

  it("commitAll says whether anything was committed", () => {
    repo = makeRepo();
    expect(commitAll(repo.root, "nothing")).toBe(false);
    writeFileSync(path.join(repo.root, "a.txt"), "a");
    expect(commitAll(repo.root, "add a")).toBe(true);
    expect(statusOf(repo.root)).toBe("");
  });

  it("merges cleanly, or reports the conflicting files", () => {
    repo = makeRepo({ "f.txt": "base\n" });
    const base = head(repo.root);
    const [a, b, run] = ["a", "b", "run"].map((n) => path.join(repo.tmp, n));
    addWorktree(repo.root, a, "br-a", base);
    addWorktree(repo.root, b, "br-b", base);
    writeFileSync(path.join(a, "f.txt"), "from a\n");
    commitAll(a, "a");
    writeFileSync(path.join(b, "f.txt"), "from b\n");
    commitAll(b, "b");
    addWorktree(repo.root, run, "run", base);
    expect(mergeBranch(run, "br-a", "merge a")).toEqual({ ok: true, conflicts: [] });
    expect(mergeBranch(run, "br-b", "merge b")).toEqual({ ok: false, conflicts: ["f.txt"] });
  });

  it("links dependency folders, keeps them out of commits, and removal keeps their targets", () => {
    repo = makeRepo();
    mkdirSync(path.join(repo.root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(path.join(repo.root, "node_modules", "pkg", "index.js"), "x");
    const dir = path.join(repo.tmp, "wt");
    addWorktree(repo.root, dir, "w", head(repo.root));
    linkDeps(repo.root, dir, ["node_modules", "missing-dir"]);
    expect(existsSync(path.join(dir, "node_modules", "pkg", "index.js"))).toBe(true);
    expect(commitAll(dir, "must not commit the link")).toBe(false);
    removeWorktree(repo.root, dir, ["node_modules", "missing-dir"]);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(path.join(repo.root, "node_modules", "pkg", "index.js"))).toBe(true);
  });

  it("falls back to the current branch when origin/HEAD is unknown", () => {
    repo = makeRepo();
    expect(defaultBranch(repo.root)).toBe("main");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/orchestrator/workspace.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

```ts
// src/orchestrator/workspace.ts
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, mkdirSync, lstatSync, unlinkSync, rmdirSync, symlinkSync } from "node:fs";
import path from "node:path";

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();
}

export function tryGit(cwd: string, args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: git(cwd, args) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}`.trim() || err.message };
  }
}

export const head = (cwd: string) => git(cwd, ["rev-parse", "HEAD"]);

/** origin's default branch when git knows it, else the current branch */
export function defaultBranch(root: string): string {
  const r = tryGit(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  return r.ok && r.out ? r.out.replace(/^origin\//, "") : git(root, ["branch", "--show-current"]);
}

/** porcelain status ("" = clean) */
export const statusOf = (cwd: string) => git(cwd, ["status", "--porcelain"]);

/** add a pattern to .git/info/exclude: ignored locally, the committed .gitignore stays untouched */
export function ensureExcluded(root: string, pattern: string): void {
  const file = path.join(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "info", "exclude");
  mkdirSync(path.dirname(file), { recursive: true });
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (text.split(/\r?\n/).includes(pattern)) return;
  appendFileSync(file, `${text && !text.endsWith("\n") ? "\n" : ""}${pattern}\n`);
}

/** create a worktree at dir on branch (new from `from`, or existing); an existing worktree is reused on resume */
export function addWorktree(root: string, dir: string, branch: string, from: string): void {
  if (existsSync(path.join(dir, ".git"))) return;
  const exists = tryGit(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).ok;
  git(root, exists ? ["worktree", "add", dir, branch] : ["worktree", "add", "-b", branch, dir, from]);
}

/**
 * Link installed dependency folders (node_modules, vendor) from the checkout into a worktree, so
 * verify commands run without a fresh install. Junctions on Windows need no admin rights. The links
 * are excluded from git so commitAll never commits them.
 */
export function linkDeps(root: string, dir: string, links: string[]): void {
  for (const rel of links) {
    const target = path.join(root, rel);
    const at = path.join(dir, rel);
    if (!existsSync(target) || existsSync(at)) continue;
    ensureExcluded(root, `/${rel.replace(/\\/g, "/")}`);
    mkdirSync(path.dirname(at), { recursive: true });
    symlinkSync(target, at, "junction");
  }
}

/** stage and commit everything; false when there was nothing to commit */
export function commitAll(cwd: string, message: string): boolean {
  git(cwd, ["add", "-A"]);
  if (tryGit(cwd, ["diff", "--cached", "--quiet"]).ok) return false;
  git(cwd, ["commit", "-q", "-m", message]);
  return true;
}

/** merge ref into the worktree at cwd; on conflict the merge is left in progress for a fixer */
export function mergeBranch(cwd: string, ref: string, message: string): { ok: boolean; conflicts: string[] } {
  if (tryGit(cwd, ["merge", "--no-ff", "-m", message, ref]).ok) return { ok: true, conflicts: [] };
  const conflicts = tryGit(cwd, ["diff", "--name-only", "--diff-filter=U"]).out.split("\n").filter(Boolean);
  return { ok: false, conflicts };
}

export const mergeInProgress = (cwd: string) => tryGit(cwd, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).ok;

export function abortMerge(cwd: string): void {
  tryGit(cwd, ["merge", "--abort"]);
}

/**
 * Remove a worktree. The dependency links go first: `git worktree remove --force`
 * would otherwise follow a junction and delete the checkout's real node_modules.
 */
export function removeWorktree(root: string, dir: string, links: string[]): void {
  for (const rel of links) {
    const at = path.join(dir, rel);
    try {
      if (!lstatSync(at).isSymbolicLink()) continue;
    } catch {
      continue;
    }
    try { unlinkSync(at); } catch { rmdirSync(at); }
  }
  tryGit(root, ["worktree", "remove", "--force", dir]);
  tryGit(root, ["worktree", "prune"]);
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run tests/orchestrator/workspace.test.ts && npx tsc --noEmit`
Expected: 6 passed, and tsc reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/workspace.ts tests/orchestrator/helpers.ts tests/orchestrator/workspace.test.ts
git commit -m "feat(orchestrator): git worktree, merge and dependency-link helpers"
```

---

### Task 5: Agent CLI runners

**Files:**
- Create: `src/orchestrator/runners.ts`
- Test: `tests/orchestrator/runners.test.ts`

**Interfaces:**
- Consumes: `Runner`, `RunnerResult` and `AgentName` from Task 2.
- Produces:
  - `spawnRunner(command, args): Runner`
  - `killTree(pid)`
  - `finalText(output): string`
  - `RATE_LIMIT_RE`
  - `CLI_RUNNERS: Record<AgentName, { write: Runner; read: Runner }>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/runners.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnRunner, finalText } from "../../src/orchestrator/runners.js";

let tmp: string;
const script = (name: string, body: string) => {
  writeFileSync(path.join(tmp, name), body);
  return path.join(tmp, name);
};
beforeAll(() => { tmp = mkdtempSync(path.join(tmpdir(), "agentos-runner-")); });
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("spawnRunner", () => {
  it("sends the prompt on stdin and returns the output", async () => {
    const echo = script("echo.mjs", `let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.stringify({type:"result",result:s.toUpperCase()})));`);
    const pids: number[] = [];
    const lines: string[] = [];
    const r = await spawnRunner(process.execPath, [echo])({ prompt: "hi there", cwd: tmp, timeoutMs: 10_000, onSpawn: (p) => pids.push(p), onLine: (l) => lines.push(l) });
    expect(r.ok).toBe(true);
    expect(finalText(r.output)).toBe("HI THERE");
    expect(pids).toHaveLength(1);
    expect(lines).toHaveLength(1);
  });

  it("flags a rate-limit exit", async () => {
    const limit = script("limit.mjs", `console.error("Error: usage limit reached, try again later");process.exit(1)`);
    const r = await spawnRunner(process.execPath, [limit])({ prompt: "x", cwd: tmp, timeoutMs: 10_000 });
    expect(r).toMatchObject({ ok: false, rateLimited: true });
  });

  it("kills a runner that outlives its timeout", async () => {
    const sleep = script("sleep.mjs", `setTimeout(()=>{},60000)`);
    const t0 = Date.now();
    const r = await spawnRunner(process.execPath, [sleep])({ prompt: "", cwd: tmp, timeoutMs: 500 });
    expect(r).toMatchObject({ ok: false, timedOut: true });
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it("reports a missing command as a failed result", async () => {
    const r = await spawnRunner("agentos-no-such-cli", [])({ prompt: "x", cwd: tmp, timeoutMs: 10_000 });
    expect(r.ok).toBe(false);
  });
});

describe("finalText", () => {
  it("reads the last message of Claude stream-json and Codex --json output", () => {
    expect(finalText(`{"type":"system"}\n{"type":"result","result":"claude done"}\n`)).toBe("claude done");
    expect(finalText(`{"type":"item.completed","item":{"type":"agent_message","text":"codex done"}}\n{"type":"turn.completed"}\n`)).toBe("codex done");
    expect(finalText("plain output")).toBe("plain output");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/orchestrator/runners.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

```ts
// src/orchestrator/runners.ts
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentName, Runner, RunnerResult } from "./types.js";

export const RATE_LIMIT_RE = /rate[ _-]?limit|usage limit|quota (?:exceeded|reached)|too many requests|\b429\b/i;
const MAX_OUTPUT = 400_000;
const WIN = process.platform === "win32";

/** kill a process and its children, by PID only */
export function killTree(pid: number): void {
  try {
    if (WIN) execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch {
    /* already exited */
  }
}

const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s);

/**
 * A runner for one agent CLI. argv is fixed and the prompt goes through stdin,
 * so the Windows shell (needed to start npm's .cmd shims) never sees user text.
 */
export function spawnRunner(command: string, args: string[]): Runner {
  return (req) =>
    new Promise<RunnerResult>((resolve) => {
      let output = "";
      let timedOut = false;
      let settled = false;
      const child = WIN
        ? spawn([command, ...args].map(quote).join(" "), { cwd: req.cwd, shell: true, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })
        : spawn(command, args, { cwd: req.cwd, detached: true, stdio: ["pipe", "pipe", "pipe"] });
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid) killTree(child.pid);
      }, req.timeoutMs);
      const finish = (r: RunnerResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      if (child.pid) req.onSpawn?.(child.pid);
      const add = (line: string) => {
        output += `${line}\n`;
        if (output.length > MAX_OUTPUT) output = output.slice(-MAX_OUTPUT / 2);
        req.onLine?.(line);
      };
      createInterface({ input: child.stdout! }).on("line", add);
      createInterface({ input: child.stderr! }).on("line", add);
      child.stdin!.on("error", () => { /* exited before reading its prompt */ });
      child.stdin!.end(req.prompt);
      child.on("error", (e) => finish({ ok: false, output: `${output}${e.message}\n`, rateLimited: false, timedOut }));
      child.on("close", (code) =>
        finish({ ok: code === 0 && !timedOut, output, timedOut, rateLimited: code !== 0 && RATE_LIMIT_RE.test(output) }));
    });
}

/** The agent's final message from Claude stream-json or Codex --json output, else the output's tail. */
export function finalText(output: string): string {
  const lines = output.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === "result" && typeof ev.result === "string") return ev.result;
      if (ev.item?.type === "agent_message" && typeof ev.item.text === "string") return ev.item.text;
      if (ev.msg?.type === "agent_message" && typeof ev.msg.message === "string") return ev.msg.message;
    } catch {
      /* not JSON */
    }
  }
  return output.trim().slice(-4000);
}

const CLAUDE = ["-p", "--output-format", "stream-json", "--verbose"];
const CODEX = ["exec", "--json", "--skip-git-repo-check"];

/**
 * write: may edit files in its cwd. read: planner and reviewer, which must not edit.
 * Claude in -p mode denies tools that are not allowed, so a writer edits files but
 * runs no shell commands; agentos commits and runs the tests itself.
 */
export const CLI_RUNNERS: Record<AgentName, { write: Runner; read: Runner }> = {
  claude: {
    write: spawnRunner("claude", [...CLAUDE, "--permission-mode", "acceptEdits"]),
    read: spawnRunner("claude", [...CLAUDE, "--disallowedTools", "Edit,Write,NotebookEdit,Bash"]),
  },
  codex: {
    write: spawnRunner("codex", [...CODEX, "-s", "workspace-write", "-"]),
    read: spawnRunner("codex", [...CODEX, "-s", "read-only", "-"]),
  },
};
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run tests/orchestrator/runners.test.ts && npx tsc --noEmit`
Expected: 5 passed, and tsc reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/runners.ts tests/orchestrator/runners.test.ts
git commit -m "feat(orchestrator): Claude/Codex CLI runners with stdin prompts, timeouts and rate-limit detection"
```

---

### Task 6: Scheduler

**Files:**
- Create: `src/orchestrator/scheduler.ts`
- Test: `tests/orchestrator/scheduler.test.ts`

**Interfaces:**
- Consumes: `Plan` and `Subtask` from Task 2.
- Produces: `runScheduled(plan, done: Set<string>, exec: (s: Subtask) => Promise<boolean>, opts: { maxWorkers; canStart?: () => boolean; waitMs? }): Promise<{ failed: string[] }>`. It adds finished ids to `done`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/scheduler.test.ts
import { describe, it, expect } from "vitest";
import { runScheduled } from "../../src/orchestrator/scheduler.js";
import type { Plan } from "../../src/orchestrator/types.js";

const plan = (subs: Array<[string, string[]]>): Plan => ({
  summary: "s",
  subtasks: subs.map(([id, dependsOn]) => ({ id, title: id, prompt: id, files: [], dependsOn, agent: "claude" })),
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("scheduler", () => {
  it("runs dependencies first", async () => {
    const order: string[] = [];
    await runScheduled(plan([["b", ["a"]], ["a", []]]), new Set(), async (s) => { order.push(s.id); await sleep(10); return true; }, { maxWorkers: 2 });
    expect(order).toEqual(["a", "b"]);
  });

  it("runs up to maxWorkers at once and never more", async () => {
    let now = 0;
    let peak = 0;
    const t0 = Date.now();
    await runScheduled(plan([["a", []], ["b", []], ["c", []]]), new Set(), async () => {
      now++; peak = Math.max(peak, now); await sleep(200); now--; return true;
    }, { maxWorkers: 2 });
    expect(peak).toBe(2);
    expect(Date.now() - t0).toBeLessThan(550); // two waves of 200 ms, not three
  });

  it("skips subtasks that are already done (resume)", async () => {
    const ran: string[] = [];
    const done = new Set(["a"]);
    await runScheduled(plan([["a", []], ["b", ["a"]]]), done, async (s) => { ran.push(s.id); return true; }, { maxWorkers: 2 });
    expect(ran).toEqual(["b"]);
    expect([...done]).toEqual(["a", "b"]);
  });

  it("starts nothing new after a failure, and never runs its dependents", async () => {
    const ran: string[] = [];
    const r = await runScheduled(plan([["a", []], ["b", ["a"]], ["c", []]]), new Set(), async (s) => { ran.push(s.id); return s.id !== "a"; }, { maxWorkers: 1 });
    expect(r.failed).toEqual(["a"]);
    expect(ran).toEqual(["a"]);
  });

  it("counts a thrown error as a failure", async () => {
    const r = await runScheduled(plan([["a", []]]), new Set(), async () => { throw new Error("x"); }, { maxWorkers: 1 });
    expect(r.failed).toEqual(["a"]);
  });

  it("waits for free memory before a second worker, but always runs one", async () => {
    let free = false;
    let now = 0;
    let peak = 0;
    setTimeout(() => (free = true), 300);
    await runScheduled(plan([["a", []], ["b", []]]), new Set(), async () => {
      now++; peak = Math.max(peak, now); await sleep(600); now--; return true;
    }, { maxWorkers: 2, canStart: () => free, waitMs: 50 });
    expect(peak).toBe(2); // b started once memory freed, while a still ran

    now = 0; peak = 0;
    await runScheduled(plan([["a", []], ["b", []]]), new Set(), async () => {
      now++; peak = Math.max(peak, now); await sleep(50); now--; return true;
    }, { maxWorkers: 2, canStart: () => false, waitMs: 20 });
    expect(peak).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/orchestrator/scheduler.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

```ts
// src/orchestrator/scheduler.ts
import type { Plan, Subtask } from "./types.js";

export interface ScheduleOptions {
  maxWorkers: number;
  /** checked before each extra worker (free memory); one worker always runs */
  canStart?: () => boolean;
  /** how often to re-check canStart while waiting */
  waitMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());

/**
 * Run subtasks whose dependencies are done, at most maxWorkers at a time.
 * After the first failure nothing new starts; running subtasks finish.
 */
export async function runScheduled(
  plan: Plan,
  done: Set<string>,
  exec: (s: Subtask) => Promise<boolean>,
  opts: ScheduleOptions,
): Promise<{ failed: string[] }> {
  const running = new Map<string, Promise<void>>();
  const failed: string[] = [];
  for (;;) {
    if (!failed.length) {
      for (const s of plan.subtasks) {
        if (running.size >= opts.maxWorkers) break;
        if (done.has(s.id) || running.has(s.id) || !s.dependsOn.every((d) => done.has(d))) continue;
        if (running.size > 0 && opts.canStart && !opts.canStart()) break;
        running.set(
          s.id,
          exec(s)
            .then((ok) => { if (ok) done.add(s.id); else failed.push(s.id); }, () => { failed.push(s.id); })
            .finally(() => running.delete(s.id)),
        );
      }
    }
    if (running.size === 0) break;
    await Promise.race([...running.values(), ...(opts.canStart ? [sleep(opts.waitMs ?? 2000)] : [])]);
  }
  return { failed };
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run tests/orchestrator/scheduler.test.ts && npx tsc --noEmit`
Expected: 6 passed, and tsc reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/scheduler.ts tests/orchestrator/scheduler.test.ts
git commit -m "feat(orchestrator): dependency-aware scheduler with worker cap and memory gate"
```

---

### Task 7: Verify commands and review findings

**Files:**
- Create: `src/orchestrator/verify.ts`
- Test: `tests/orchestrator/verify.test.ts`

**Interfaces:**
- Consumes: `Finding` from Task 2.
- Produces:
  - `runVerify(cwd, commands, timeoutMs): { ok; output }`
  - `parseFindings(text): Finding[] | null`
  - `blocking(findings): Finding[]`
  - `reviewPrompt(task, diff): string`

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/verify.test.ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { runVerify, parseFindings, blocking, reviewPrompt } from "../../src/orchestrator/verify.js";
import type { Finding } from "../../src/orchestrator/types.js";

describe("runVerify", () => {
  it("runs commands in order and stops at the first failure", () => {
    const r = runVerify(tmpdir(), [`node -e "console.log('first-ran')"`, `node -e "process.exit(3)"`, `node -e "console.log('third-ran')"`], 30_000);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("first-ran\n");
    expect(r.output).toContain("FAILED");
    expect(r.output).not.toContain("third-ran\n");
  });

  it("passes with no commands", () => {
    expect(runVerify(tmpdir(), [], 1000)).toEqual({ ok: true, output: "" });
  });
});

describe("parseFindings", () => {
  const high: Finding = { severity: "high", file: "a.ts", line: 3, issue: "crash" };

  it("reads a fenced JSON array inside prose", () => {
    expect(parseFindings(`Here you go:\n\`\`\`json\n${JSON.stringify([high])}\n\`\`\`\nDone.`)).toEqual([high]);
  });

  it("handles [] and nested arrays, and fills defaults", () => {
    expect(parseFindings("[]")).toEqual([]);
    expect(parseFindings('[{"severity":"low","issue":"x","extra":[1,2]}]')).toEqual([{ severity: "low", file: "", line: 0, issue: "x" }]);
  });

  it("returns null when there is no valid findings array", () => {
    expect(parseFindings("no json here")).toBeNull();
    expect(parseFindings('[{"severity":"urgent","issue":"x"}]')).toBeNull();
  });

  it("only high and medium findings block", () => {
    expect(blocking([high, { severity: "low", file: "", line: 0, issue: "nit" }])).toEqual([high]);
  });
});

describe("reviewPrompt", () => {
  it("carries the task and the diff, truncating huge diffs", () => {
    const p = reviewPrompt("add x", "diff --git a/x b/x\n+x");
    expect(p).toContain("add x");
    expect(p).toContain("+x");
    expect(reviewPrompt("t", "y".repeat(200_000))).toContain("(diff truncated)");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/orchestrator/verify.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

```ts
// src/orchestrator/verify.ts
import { execSync } from "node:child_process";
import { z } from "zod";
import type { Finding } from "./types.js";

const tail = (s: string, n = 4000) => (s.length > n ? `…${s.slice(-n)}` : s);

/** Run the configured commands through the shell, in order, stopping at the first failure. */
export function runVerify(cwd: string, commands: string[], timeoutMs: number): { ok: boolean; output: string } {
  let output = "";
  for (const cmd of commands) {
    try {
      const out = execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
      output += `$ ${cmd}\n${tail(out, 1500)}\n`;
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message: string };
      output += `$ ${cmd}  ✗ FAILED\n${tail(`${err.stdout ?? ""}${err.stderr ?? ""}` || err.message)}\n`;
      return { ok: false, output };
    }
  }
  return { ok: true, output };
}

const findingsSchema = z.array(
  z.object({
    severity: z.enum(["high", "medium", "low"]),
    file: z.string().default(""),
    line: z.number().int().nonnegative().default(0),
    issue: z.string().min(1),
  }),
);

/** The findings array that ends the reviewer's reply; null when there is none. */
export function parseFindings(text: string): Finding[] | null {
  const s = text.replace(/```(?:json)?/g, "");
  const end = s.lastIndexOf("]");
  for (let start = s.lastIndexOf("[", end); start >= 0; start = start === 0 ? -1 : s.lastIndexOf("[", start - 1)) {
    try {
      const r = findingsSchema.safeParse(JSON.parse(s.slice(start, end + 1)));
      if (r.success) return r.data;
    } catch {
      /* widen to the previous "[" */
    }
  }
  return null;
}

export const blocking = (findings: Finding[]) => findings.filter((f) => f.severity !== "low");

export function reviewPrompt(task: string, diff: string): string {
  return [
    "You are reviewing a change another AI agent made. Do not edit any files.",
    `The task was: ${task}`,
    "Report real problems only: wrong behaviour, crashes, security holes, data loss, or parts of the task left undone. Ignore style.",
    'Reply with ONLY a JSON array, for example [{"severity":"high","file":"src/a.ts","line":12,"issue":"what breaks and when"}]. Use [] when you find nothing. severity is high, medium or low.',
    "The diff:",
    diff.length > 150_000 ? `${diff.slice(0, 150_000)}\n…(diff truncated)` : diff,
  ].join("\n\n");
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run tests/orchestrator/verify.test.ts && npx tsc --noEmit`
Expected: 7 passed, and tsc reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/verify.ts tests/orchestrator/verify.test.ts
git commit -m "feat(orchestrator): verify commands and reviewer findings parser"
```

---

### Task 8: Secret scan and log redaction

**Files:**
- Create: `src/orchestrator/safety.ts`
- Test: `tests/orchestrator/safety.test.ts`

**Interfaces:**
- Produces:
  - `scanDiff(diff): string[]`, returning `"<file>: <kind>"` hits
  - `redact(text, env?): string`

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/safety.test.ts
import { describe, it, expect } from "vitest";
import { scanDiff, redact } from "../../src/orchestrator/safety.js";

// built at runtime so this file holds no key-shaped strings (push protection, scanners)
const AWS = "AKIA" + "Q".repeat(16);
const GH = "ghp_" + "a".repeat(36);

const diff = (file: string, lines: string[]) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n${lines.join("\n")}\n`;

describe("scanDiff", () => {
  it("finds secrets on added lines only", () => {
    expect(scanDiff(diff("src/a.ts", [`+const k = "${AWS}";`, `-const old = "${GH}";`]))).toEqual(["src/a.ts: AWS access key"]);
  });

  it("flags .env files but not .env.example", () => {
    expect(scanDiff(diff("server/.env", ["+APP_KEY=x"]))).toEqual(["server/.env: .env file"]);
    expect(scanDiff(diff(".env.example", ["+APP_KEY="]))).toEqual([]);
  });

  it("finds private keys and GitHub tokens", () => {
    const hits = scanDiff(diff("k.pem", ["+-----BEGIN RSA PRIVATE KEY-----", `+token=${GH}`]));
    expect(hits).toEqual(["k.pem: private key", "k.pem: GitHub token"]);
  });
});

describe("redact", () => {
  it("hides the values of secret-looking environment variables", () => {
    const env = { API_KEY: "s3cr3t-value", DB_PASSWORD: "hunter22", PATH: "/usr/bin", SHORT_TOKEN: "abc" };
    expect(redact("key=s3cr3t-value pw=hunter22 path=/usr/bin t=abc", env)).toBe("key=*** pw=*** path=/usr/bin t=abc");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/orchestrator/safety.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

```ts
// src/orchestrator/safety.ts
const PATTERNS: [string, RegExp][] = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["API key (sk-…)", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
];

/** Secrets in the lines a diff adds, and any .env file it adds or changes. */
export function scanDiff(diff: string): string[] {
  const hits: string[] = [];
  let file = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.slice(4).replace(/^b\//, "").trim();
      if (/(^|\/)\.env(\.|$)/.test(file) && !file.endsWith(".example")) hits.push(`${file}: .env file`);
      continue;
    }
    if (!line.startsWith("+")) continue;
    for (const [kind, re] of PATTERNS) if (re.test(line)) hits.push(`${file}: ${kind}`);
  }
  return [...new Set(hits)];
}

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;

/** Replace the values of secret-looking environment variables with *** (values shorter than 6 are left). */
export function redact(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  for (const [name, value] of Object.entries(env)) {
    if (value && value.length >= 6 && SECRET_NAME.test(name)) out = out.split(value).join("***");
  }
  return out;
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run tests/orchestrator/safety.test.ts && npx tsc --noEmit`
Expected: 4 passed, and tsc reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/safety.ts tests/orchestrator/safety.test.ts
git commit -m "feat(orchestrator): secret scan for PR diffs and env-value redaction"
```

---

### Task 9: Planner

**Files:**
- Create: `src/orchestrator/planner.ts`
- Test: `tests/orchestrator/planner.test.ts`

**Interfaces:**
- Consumes:
  - `validatePlan` (Task 2)
  - `finalText` (Task 5)
  - `Runner` and `AgentName` (Task 2)
- Produces:
  - `PlannerInput { task; facts: string[]; files: string[]; workers: AgentName[] }`
  - `plannerPrompt(input)`
  - `extractJson(text)`
  - `makePlan(runner, input, cwd, timeoutMs): Promise<{ plan?; error?; rateLimited? }>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/planner.test.ts
import { describe, it, expect } from "vitest";
import { makePlan, plannerPrompt, extractJson, type PlannerInput } from "../../src/orchestrator/planner.js";
import type { RunnerResult } from "../../src/orchestrator/types.js";

const plan1 = { summary: "s", subtasks: [{ id: "a", title: "A", prompt: "do a", files: ["a.ts"], dependsOn: [], agent: "claude" }] };
const reply = (text: string): RunnerResult => ({ ok: true, output: JSON.stringify({ type: "result", result: text }) + "\n", rateLimited: false, timedOut: false });
const input: PlannerInput = { task: "add a", facts: ["[arch/db] sqlite"], files: ["src/a.ts"], workers: ["claude", "codex"] };

describe("planner", () => {
  it("returns a valid plan from fenced JSON", async () => {
    const r = await makePlan(async () => reply("```json\n" + JSON.stringify(plan1) + "\n```"), input, ".", 1000);
    expect(r.plan?.subtasks[0].id).toBe("a");
  });

  it("re-prompts once with the validation error", async () => {
    const prompts: string[] = [];
    const bad = { ...plan1, subtasks: [{ ...plan1.subtasks[0], dependsOn: ["zzz"] }] };
    const replies = [reply(JSON.stringify(bad)), reply(JSON.stringify(plan1))];
    const r = await makePlan(async (req) => { prompts.push(req.prompt); return replies.shift()!; }, input, ".", 1000);
    expect(r.plan).toBeDefined();
    expect(prompts[1]).toContain('depends on unknown "zzz"');
  });

  it("gives up after two unusable replies", async () => {
    const r = await makePlan(async () => reply("I cannot plan this"), input, ".", 1000);
    expect(r.plan).toBeUndefined();
    expect(r.error).toContain("no JSON object");
  });

  it("reports a rate limit instead of an error", async () => {
    const r = await makePlan(async () => ({ ok: false, output: "429", rateLimited: true, timedOut: false }), input, ".", 1000);
    expect(r).toEqual({ rateLimited: true });
  });

  it("puts the task, memory, files and workers in the prompt", () => {
    const p = plannerPrompt(input);
    for (const s of ["add a", "[arch/db] sqlite", "src/a.ts", "claude, codex"]) expect(p).toContain(s);
  });

  it("extracts the outer JSON object", () => {
    expect(extractJson('Plan: {"a":{"b":1}} ok')).toEqual({ a: { b: 1 } });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/orchestrator/planner.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

```ts
// src/orchestrator/planner.ts
import type { AgentName, Plan, Runner } from "./types.js";
import { validatePlan } from "./plan.js";
import { finalText } from "./runners.js";

export interface PlannerInput {
  task: string;
  /** relevant project memory, "[topic/key] value" */
  facts: string[];
  files: string[];
  workers: AgentName[];
}

export function plannerPrompt(input: PlannerInput): string {
  return [
    "You are the planner for a team of coding agents. Do not edit any files; read whatever you need.",
    `Task: ${input.task}`,
    input.facts.length ? `Project memory:\n${input.facts.map((f) => `- ${f}`).join("\n")}` : "",
    `Files in the repository (first ${input.files.length}):\n${input.files.join("\n")}`,
    [
      `Split the task into 1-8 subtasks for these agents: ${input.workers.join(", ")}.`,
      "A small task is ONE subtask. Split only when parts are truly independent.",
      "Subtasks that run in parallel must change different files; if two subtasks touch the same file, chain them with dependsOn.",
      "Each prompt must stand alone: a worker sees only its prompt and the plan summary.",
      "Workers edit files only; agentos commits and runs the tests.",
    ].join("\n"),
    'Reply with ONLY this JSON: {"summary":"...","subtasks":[{"id":"kebab-id","title":"...","prompt":"...","files":["path"],"dependsOn":[],"agent":"claude"}]}',
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** the JSON object in an agent's reply: first "{" to last "}" */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object in the planner's reply");
  return JSON.parse(text.slice(start, end + 1));
}

/** Ask for a plan; one retry that quotes the validation error. */
export async function makePlan(
  runner: Runner,
  input: PlannerInput,
  cwd: string,
  timeoutMs: number,
): Promise<{ plan?: Plan; error?: string; rateLimited?: boolean }> {
  let prompt = plannerPrompt(input);
  let error = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await runner({ prompt, cwd, timeoutMs });
    if (res.rateLimited) return { rateLimited: true };
    if (!res.ok) {
      error = `the planner failed${res.timedOut ? " (timeout)" : ""}: ${res.output.slice(-500)}`;
      continue;
    }
    try {
      const v = validatePlan(extractJson(finalText(res.output)), input.workers);
      if (v.plan) return { plan: v.plan };
      error = v.error!;
    } catch (e) {
      error = (e as Error).message;
    }
    prompt = `${plannerPrompt(input)}\n\nYour previous plan was rejected: ${error}\nReturn the corrected JSON only.`;
  }
  return { error };
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run tests/orchestrator/planner.test.ts && npx tsc --noEmit`
Expected: 6 passed, and tsc reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/planner.ts tests/orchestrator/planner.test.ts
git commit -m "feat(orchestrator): planner prompt and validated JSON plan with one retry"
```

---

### Task 10: Engine and PR report

**Files:**
- Create: `src/orchestrator/report.ts`, `src/orchestrator/engine.ts`
- Test: `tests/orchestrator/engine.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–9. `MemoryStore` comes from `src/mcp/memory/store.ts`: `new MemoryStore(file)`, `.recall({ text, limit })`, and `.store({ topic, key, value, source })`.
- Produces:
  - `prBody(s: RunState): string`
  - `runLine(s: RunState): string`
  - `EngineDeps { runners: Record<AgentName, { read: Runner; write: Runner }>; gh(cwd, args): string; freeMemMb?(): number; onStatus?(s): void }`
  - `startRun(root, task, cfg, deps, id?)`
  - `resumeRun(root, id, cfg, deps)`
  - `executeRun(root, s, cfg, deps)`
  - `cancelRun(root, id, waitMs?)`

  Every one of these returns `Promise<RunState>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/engine.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { makeRepo, sh } from "./helpers.js";
import { startRun, resumeRun, type EngineDeps } from "../../src/orchestrator/engine.js";
import { requestCancel } from "../../src/orchestrator/run.js";
import { statusOf } from "../../src/orchestrator/workspace.js";
import { orchestratorSchema } from "../../src/core/schema.js";
import type { Runner, RunnerResult } from "../../src/orchestrator/types.js";

let repo: ReturnType<typeof makeRepo>;
beforeEach(() => { repo = makeRepo(); });
afterEach(() => repo.cleanup());

const reply = (text = "done"): RunnerResult => ({ ok: true, output: JSON.stringify({ type: "result", result: text }) + "\n", rateLimited: false, timedOut: false });
const LIMIT: RunnerResult = { ok: false, output: "rate limit reached\n", rateLimited: true, timedOut: false };
const cfg = (over: Record<string, unknown> = {}) => orchestratorSchema.parse({ link: [], ...over });
const sub = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, title: id, prompt: `create ${id}.txt`, files: [`${id}.txt`], dependsOn: [], agent: "claude", ...over });
const planOf = (...subtasks: object[]) => ({ summary: "test plan", subtasks });

type Work = (cwd: string, prompt: string) => void | RunnerResult | Promise<void | RunnerResult>;
function deps(f: { plan: object | (() => RunnerResult); work?: Work; review?: () => string }) {
  const read: Runner = async (req) =>
    req.prompt.includes("You are the planner")
      ? typeof f.plan === "function" ? (f.plan as () => RunnerResult)() : reply(JSON.stringify(f.plan))
      : reply(f.review ? f.review() : "[]");
  const write: Runner = async (req) => (await f.work?.(req.cwd, req.prompt)) ?? reply();
  const gh = vi.fn((_cwd: string, args: string[]) => (args[0] === "pr" ? "https://github.com/o/r/pull/7\n" : ""));
  const d: EngineDeps = { runners: { claude: { read, write }, codex: { read, write } }, gh, freeMemMb: () => 1e6 };
  return Object.assign(d, { gh });
}
/** a worker that creates the file its subtask prompt names */
const creates: Work = (cwd, prompt) => {
  const m = /create (\S+\.txt)/.exec(prompt);
  if (m) writeFileSync(path.join(cwd, m[1]), m[1]);
};
const prCalls = (d: ReturnType<typeof deps>) => d.gh.mock.calls.filter((c) => c[1][0] === "pr");

describe("orchestrator engine", { timeout: 60_000 }, () => {
  it("runs two subtasks in parallel and opens one PR with both", async () => {
    const d = deps({ plan: planOf(sub("a"), sub("b", { agent: "codex" })), work: creates });
    const s = await startRun(repo.root, "add a and b", cfg(), d, "t1");
    expect(s.status).toBe("pr_open");
    expect(s.prUrl).toBe("https://github.com/o/r/pull/7");
    const files = sh(repo.remote, ["ls-tree", "--name-only", "agentos/run-t1"]);
    expect(files).toContain("a.txt");
    expect(files).toContain("b.txt");
    const args = prCalls(d)[0][1] as string[];
    expect(args.slice(0, 6)).toEqual(["pr", "create", "--base", "main", "--head", "agentos/run-t1"]);
    expect(args[args.indexOf("--body") + 1]).toContain("add a and b");
    expect(statusOf(repo.root)).toBe("");
    expect(existsSync(s.runWorktree)).toBe(false);
    expect(sh(repo.root, ["branch", "--show-current"])).toBe("main");
  });

  it("starts a dependent subtask from its dependency's code", async () => {
    let sawA = false;
    const d = deps({
      plan: planOf(sub("a"), sub("b", { dependsOn: ["a"] })),
      work: (cwd, p) => { if (p.includes("create b.txt")) sawA = existsSync(path.join(cwd, "a.txt")); creates(cwd, p); },
    });
    expect((await startRun(repo.root, "chain", cfg(), d)).status).toBe("pr_open");
    expect(sawA).toBe(true);
  });

  it("fixes failing verify commands, then opens the PR", async () => {
    const verify = [`node -e "process.exit(require('fs').existsSync('fixed.txt') ? 0 : 1)"`];
    const d = deps({ plan: planOf(sub("a")), work: (cwd, p) => (p.includes("does not pass yet") ? writeFileSync(path.join(cwd, "fixed.txt"), "ok") : creates(cwd, p)) });
    const s = await startRun(repo.root, "needs a fix", cfg({ verify }), d);
    expect(s.status).toBe("pr_open");
    expect(s.fixRound).toBe(1);
  });

  it("stops at maxFixRounds without opening a PR", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates });
    const s = await startRun(repo.root, "never passes", cfg({ verify: [`node -e "process.exit(1)"`], maxFixRounds: 1 }), d);
    expect(s.status).toBe("needs_human");
    expect(s.fixRound).toBe(1);
    expect(s.reason).toContain("verify commands fail");
    expect(prCalls(d)).toHaveLength(0);
  });

  it("sends blocking review findings to a fixer", async () => {
    const reviews = [JSON.stringify([{ severity: "high", file: "a.txt", line: 1, issue: "a.txt must say hello" }]), "[]"];
    let fixPrompt = "";
    const d = deps({
      plan: planOf(sub("a")),
      review: () => reviews.shift() ?? "[]",
      work: (cwd, p) => {
        if (!p.includes("does not pass yet")) return creates(cwd, p);
        fixPrompt = p;
        writeFileSync(path.join(cwd, "a.txt"), "hello");
      },
    });
    const s = await startRun(repo.root, "reviewed", cfg(), d);
    expect(s.status).toBe("pr_open");
    expect(s.fixRound).toBe(1);
    expect(fixPrompt).toContain("a.txt must say hello");
  });

  it("resolves a merge conflict between subtasks with a fixer", async () => {
    // the planner promised different files, but both parallel workers write shared.txt
    // (both start from the same base, so the second merge conflicts)
    const d = deps({
      plan: planOf(sub("a"), sub("b")),
      work: (cwd, p) => {
        if (p.includes("stopped with conflicts")) return writeFileSync(path.join(cwd, "shared.txt"), "a and b\n");
        writeFileSync(path.join(cwd, "shared.txt"), `${p.includes("create a.txt") ? "a" : "b"}\n`);
      },
    });
    const s = await startRun(repo.root, "conflict", cfg(), d);
    expect(s.status).toBe("pr_open");
    expect(sh(repo.remote, ["show", `${s.branch}:shared.txt`])).toBe("a and b");
  });

  it("blocks the PR when the diff adds a secret", async () => {
    const fakeKey = "AKIA" + "Q".repeat(16); // built at runtime: this file holds no key-shaped string
    const d = deps({ plan: planOf(sub("a")), work: (cwd) => writeFileSync(path.join(cwd, "a.txt"), `key=${fakeKey}\n`) });
    const s = await startRun(repo.root, "leaky", cfg(), d);
    expect(s.status).toBe("needs_human");
    expect(s.reason).toContain("secret scan");
    expect(prCalls(d)).toHaveLength(0);
    expect(sh(repo.remote, ["branch", "--list", s.branch])).toBe("");
  });

  it("fails the run when an agent writes into the main checkout", async () => {
    const d = deps({ plan: planOf(sub("a")), work: (cwd, p) => { creates(cwd, p); writeFileSync(path.join(repo.root, "evil.txt"), "x"); } });
    const s = await startRun(repo.root, "escape", cfg(), d);
    expect(s.status).toBe("failed");
    expect(s.reason).toContain("outside its worktree");
  });

  it("pauses on a worker rate limit and resumes without redoing finished subtasks", async () => {
    let aCalls = 0;
    let bCalls = 0;
    const d = deps({
      plan: planOf(sub("a"), sub("b")),
      work: (cwd, p) => {
        if (p.includes("create b.txt") && ++bCalls === 1) return LIMIT;
        if (p.includes("create a.txt")) aCalls++;
        creates(cwd, p);
      },
    });
    const c = cfg({ maxWorkers: 1 });
    const paused = await startRun(repo.root, "limited", c, d, "t9");
    expect(paused.status).toBe("paused");
    expect(paused.resumeFrom).toBe("working");
    const s = await resumeRun(repo.root, "t9", c, d);
    expect(s.status).toBe("pr_open");
    expect(aCalls).toBe(1);
    expect(bCalls).toBe(2);
  });

  it("pauses when the planner hits a limit", async () => {
    const replies = [LIMIT, reply(JSON.stringify(planOf(sub("a"))))];
    const d = deps({ plan: () => replies.shift()!, work: creates });
    expect((await startRun(repo.root, "later", cfg(), d, "t10")).status).toBe("paused");
    expect((await resumeRun(repo.root, "t10", cfg(), d)).status).toBe("pr_open");
  });

  it("records a cancel request as cancelled", async () => {
    const d = deps({ plan: planOf(sub("a")), work: (cwd, p) => { requestCancel(repo.root, "t11"); creates(cwd, p); } });
    const s = await startRun(repo.root, "cancel me", cfg(), d, "t11");
    expect(s.status).toBe("cancelled");
    expect(prCalls(d)).toHaveLength(0);
  });

  it("merges a base branch that moved during the run before opening the PR", async () => {
    const d = deps({
      plan: planOf(sub("a")),
      work: (cwd, p) => {
        creates(cwd, p);
        const other = path.join(repo.tmp, "other");
        if (existsSync(other)) return;
        sh(repo.tmp, ["clone", "-q", repo.remote, other]);
        writeFileSync(path.join(other, "o.txt"), "o");
        sh(other, ["add", "-A"]);
        sh(other, ["commit", "-qm", "moved"]);
        sh(other, ["push", "-q", "origin", "main"]);
      },
    });
    const s = await startRun(repo.root, "moving base", cfg(), d);
    expect(s.status).toBe("pr_open");
    const files = sh(repo.remote, ["ls-tree", "--name-only", s.branch]);
    expect(files).toContain("o.txt");
    expect(files).toContain("a.txt");
  });

  it("refuses to start on a dirty checkout", async () => {
    writeFileSync(path.join(repo.root, "wip.txt"), "x");
    await expect(startRun(repo.root, "t", cfg(), deps({ plan: planOf(sub("a")) }))).rejects.toThrow(/uncommitted changes/);
  });

  it("hands an unusable plan to a human after one retry", async () => {
    const s = await startRun(repo.root, "vague", cfg(), deps({ plan: () => reply("I cannot plan this"), work: creates }));
    expect(s.status).toBe("needs_human");
    expect(s.reason).toContain("planner:");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/orchestrator/engine.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement the report**

```ts
// src/orchestrator/report.ts
import type { RunState } from "./run.js";

const cell = (s: string) => s.split("\n")[0].replace(/\|/g, "\\|").slice(0, 120);

export function prBody(s: RunState): string {
  const minutes = Math.round((Date.now() - Date.parse(s.createdAt)) / 60_000);
  const rows = s.subtasks.map((t) => `| ${t.id} | ${t.agent} | ${t.status} | ${cell(t.summary ?? "")} |`).join("\n");
  return [
    `**Task:** ${s.task}`,
    s.plan ? `**Plan:** ${s.plan.summary}` : "",
    `| Subtask | Agent | Status | Summary |\n|---|---|---|---|\n${rows}`,
    `**Verify:** ${s.verifyOk ? "passed" : "not run"} · **Fix rounds:** ${s.fixRound} · **Time:** ${minutes} min`,
    s.verifyOutput ? `<details><summary>Verify output</summary>\n\n\`\`\`\n${s.verifyOutput}\n\`\`\`\n</details>` : "",
    s.findings.length
      ? `**Review notes (non-blocking):**\n${s.findings.map((f) => `- [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ""} ${f.issue}`).join("\n")}`
      : "**Review:** no findings",
    "🤖 Opened by [agentos](https://github.com/abtrader00900/agentos) — review before merging.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** one line per run for `agentos runs`, with the reason under it when the run did not open a PR */
export function runLine(s: RunState): string {
  const why = s.reason && s.status !== "pr_open" ? `\n    ${s.reason.split("\n")[0]}` : "";
  return `${s.id}  ${s.status.padEnd(11)}  ${s.task.slice(0, 60)}${s.prUrl ? `  ${s.prUrl}` : ""}${why}`;
}
```

- [ ] **Step 4: Implement the engine**

```ts
// src/orchestrator/engine.ts
import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { MemoryStore } from "../mcp/memory/store.js";
import type { OrchestratorConfig } from "../core/schema.js";
import type { AgentName, Runner, RunnerRequest, Subtask } from "./types.js";
import {
  type RunState, type RunStatus, type SubtaskState, TERMINAL, newRunId, runDir, saveRun, loadRun,
  setStatus, logEvent, requestCancel, cancelRequested,
} from "./run.js";
import { makePlan } from "./planner.js";
import { runScheduled } from "./scheduler.js";
import { runVerify, parseFindings, blocking, reviewPrompt } from "./verify.js";
import { scanDiff, redact } from "./safety.js";
import { finalText, killTree } from "./runners.js";
import {
  git, tryGit, head, defaultBranch, statusOf, ensureExcluded, addWorktree, linkDeps, commitAll,
  mergeBranch, mergeInProgress, abortMerge, removeWorktree,
} from "./workspace.js";
import { prBody } from "./report.js";

export interface EngineDeps {
  runners: Record<AgentName, { read: Runner; write: Runner }>;
  /** the GitHub CLI: returns stdout, throws on failure */
  gh: (cwd: string, args: string[]) => string;
  freeMemMb?: () => number;
  onStatus?: (s: RunState) => void;
}

interface Ctx {
  root: string;
  s: RunState;
  cfg: OrchestratorConfig;
  deps: EngineDeps;
  /** PIDs of agent processes this engine is running right now */
  live: Set<number>;
}

const minutes = (m: number) => m * 60_000;
const other = (a: AgentName): AgentName => (a === "claude" ? "codex" : "claude");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const memoryFile = (root: string) => path.join(root, ".agentos", "memory.json");

/** Preflight, create the run record, and drive it until it ends or pauses. */
export async function startRun(root: string, task: string, cfg: OrchestratorConfig, deps: EngineDeps, id = newRunId()): Promise<RunState> {
  runDir(root, id); // validates the id
  ensureExcluded(root, "/.agentos/runs/");
  if (statusOf(root)) throw new Error("Your checkout has uncommitted changes — commit or stash them first (a run starts from a clean base).");
  deps.gh(root, ["auth", "status"]);
  const baseBranch = defaultBranch(root);
  const now = new Date().toISOString();
  const s: RunState = {
    id, task, status: "queued", baseBranch, base: git(root, ["rev-parse", baseBranch]),
    branch: `agentos/run-${id}`, runWorktree: path.join(runDir(root, id), "wt", "run"),
    createdAt: now, updatedAt: now, subtasks: [], fixRound: 0, findings: [],
  };
  saveRun(root, s);
  logEvent(root, id, { type: "start", task });
  deps.onStatus?.(s);
  return executeRun(root, s, cfg, deps);
}

/** Continue a paused run, or one whose engine died mid-step. */
export async function resumeRun(root: string, id: string, cfg: OrchestratorConfig, deps: EngineDeps): Promise<RunState> {
  const s = loadRun(root, id);
  if (TERMINAL.includes(s.status)) throw new Error(`run ${id} is ${s.status}; there is nothing to resume`);
  if (s.status === "paused") {
    s.status = s.resumeFrom ?? "planning";
    s.resumeFrom = undefined;
    saveRun(root, s);
    logEvent(root, id, { type: "resume", status: s.status });
  }
  return executeRun(root, s, cfg, deps);
}

/** Ask a running engine to stop (it kills its own agents); a paused or dead run is marked at once. */
export async function cancelRun(root: string, id: string, waitMs = 15_000): Promise<RunState> {
  let s = loadRun(root, id);
  if (TERMINAL.includes(s.status)) throw new Error(`run ${id} is already ${s.status}`);
  requestCancel(root, id);
  if (s.status !== "paused") {
    for (const until = Date.now() + waitMs; Date.now() < until; ) {
      await sleep(250);
      s = loadRun(root, id);
      if (TERMINAL.includes(s.status)) return s;
    }
  }
  setStatus(root, s, "cancelled", s.status === "paused" ? "cancelled by the owner" : "cancelled by the owner (no engine was running it)");
  return s;
}

export async function executeRun(root: string, s: RunState, cfg: OrchestratorConfig, deps: EngineDeps): Promise<RunState> {
  const c: Ctx = { root, s, cfg, deps, live: new Set() };
  s.enginePid = process.pid;
  for (const t of s.subtasks) if (t.status === "running") t.status = "pending";
  saveRun(root, s);
  const watcher = setInterval(() => {
    if (cancelRequested(root, s.id)) for (const pid of c.live) killTree(pid);
  }, 1000);
  const deadline = Date.now() + minutes(cfg.maxMinutes);
  try {
    while (!TERMINAL.includes(s.status) && s.status !== "paused") {
      if (cancelRequested(root, s.id)) { move(c, "cancelled", "cancelled by the owner"); break; }
      if (Date.now() > deadline) { move(c, "needs_human", `the run took longer than maxMinutes (${cfg.maxMinutes})`); break; }
      try {
        await step(c);
        if (!TERMINAL.includes(s.status) && s.status !== "paused") guardOutside(c);
      } catch (e) {
        if (!TERMINAL.includes(s.status)) move(c, "failed", redact((e as Error).message));
      }
    }
  } finally {
    clearInterval(watcher);
  }
  if (s.status === "pr_open") cleanup(c);
  return s;
}

async function step(c: Ctx): Promise<void> {
  switch (c.s.status) {
    case "queued":
      addWorktree(c.root, c.s.runWorktree, c.s.branch, c.s.base);
      linkDeps(c.root, c.s.runWorktree, c.cfg.link);
      return move(c, "planning");
    case "planning": return plan(c);
    case "working": return work(c);
    case "verifying": return verify(c);
    case "fixing": return fix(c);
    default: throw new Error(`cannot continue a run in status ${c.s.status}`);
  }
}

function move(c: Ctx, status: RunStatus, reason?: string): void {
  if (status !== "cancelled" && cancelRequested(c.root, c.s.id)) {
    status = "cancelled";
    reason = "cancelled by the owner";
  }
  setStatus(c.root, c.s, status, reason);
  c.deps.onStatus?.(c.s);
}

function pause(c: Ctx, from: RunStatus): void {
  c.s.resumeFrom = from;
  move(c, "paused", `rate limit or quota reached — continue later with: agentos run --resume ${c.s.id}`);
}

/** Runs one agent call: its PID is tracked for cancel, output lines are logged, a failure falls back to the other CLI once. */
function agentRunner(c: Ctx, agent: AgentName, mode: "read" | "write"): Runner {
  const call = async (a: AgentName, req: RunnerRequest) => {
    let pid = 0;
    try {
      return await c.deps.runners[a][mode]({
        ...req,
        onSpawn: (p) => { pid = p; c.live.add(p); },
        onLine: (line) => logEvent(c.root, c.s.id, { type: "agent", agent: a, line: redact(line).slice(0, 4000) }),
      });
    } finally {
      c.live.delete(pid);
    }
  };
  return async (req) => {
    const res = await call(agent, req);
    if (res.ok || res.rateLimited || cancelRequested(c.root, c.s.id)) return res;
    const alt = other(agent);
    if (!c.cfg.workers.includes(alt)) return res;
    logEvent(c.root, c.s.id, { type: "fallback", from: agent, to: alt, why: res.timedOut ? "timeout" : "error" });
    return call(alt, req);
  };
}

function recall(root: string, task: string): string[] {
  if (!existsSync(memoryFile(root))) return [];
  try {
    return new MemoryStore(memoryFile(root)).recall({ text: task, limit: 10 }).map((f) => `[${f.topic}/${f.key}] ${f.value}`);
  } catch {
    return [];
  }
}

async function plan(c: Ctx): Promise<void> {
  const { s, cfg, root } = c;
  const files = git(s.runWorktree, ["ls-files"]).split("\n").filter(Boolean).slice(0, 300);
  const r = await makePlan(agentRunner(c, cfg.planner, "read"), { task: s.task, facts: recall(root, s.task), files, workers: cfg.workers }, s.runWorktree, minutes(cfg.subtaskMinutes));
  if (r.rateLimited) return pause(c, "planning");
  if (!r.plan) return move(c, "needs_human", `planner: ${r.error}`);
  s.plan = r.plan;
  s.subtasks = r.plan.subtasks.map((t) => ({
    id: t.id, agent: t.agent, status: "pending", branch: `${s.branch}-${t.id}`,
    worktree: path.join(runDir(root, s.id), "wt", `sub-${t.id}`),
  }));
  logEvent(root, s.id, { type: "plan", plan: r.plan });
  return move(c, "working");
}

function workerPrompt(s: RunState, sub: Subtask): string {
  return [
    `You are one worker in a team. Overall goal: ${s.task}`,
    `Team plan: ${s.plan!.summary}`,
    `Your subtask (${sub.id}): ${sub.title}\n${sub.prompt}`,
    sub.files.length ? `Files you are expected to change: ${sub.files.join(", ")}` : "",
    "Rules: work only inside the current directory. Do not commit, push, deploy, run migrations against real databases, or delete anything outside this directory. agentos commits your changes and runs the tests.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function work(c: Ctx): Promise<void> {
  const { s, root, cfg } = c;
  let paused = false;
  let merges: Promise<unknown> = Promise.resolve(); // merges into the run worktree go one at a time
  const done = new Set(s.subtasks.filter((t) => t.status === "done").map((t) => t.id));
  const freeMb = c.deps.freeMemMb ?? (() => os.freemem() / 1048576);
  const { failed } = await runScheduled(s.plan!, done, async (sub) => {
    const t = s.subtasks.find((x) => x.id === sub.id)!;
    t.status = "running";
    saveRun(root, s);
    addWorktree(root, t.worktree, t.branch, head(s.runWorktree));
    linkDeps(root, t.worktree, cfg.link);
    const res = await agentRunner(c, sub.agent, "write")({ prompt: workerPrompt(s, sub), cwd: t.worktree, timeoutMs: minutes(cfg.subtaskMinutes) });
    if (res.rateLimited) {
      paused = true;
      t.status = "pending";
      saveRun(root, s);
      return false;
    }
    commitAll(t.worktree, `agentos: ${sub.title}`);
    t.summary = redact(finalText(res.output)).slice(0, 1500);
    const changed = Number(git(root, ["rev-list", "--count", `${s.branch}..${t.branch}`])) > 0;
    let ok = res.ok && changed;
    if (ok) {
      const next = merges.then(() => integrate(c, t, sub));
      merges = next.catch(() => undefined);
      ok = await next;
    }
    if (!ok) t.summary = `${t.summary}\n${!res.ok ? "the agent failed" : !changed ? "the agent changed nothing" : "merging its work failed"}`.trim();
    t.status = ok ? "done" : "failed";
    saveRun(root, s);
    return ok;
  }, { maxWorkers: cfg.maxWorkers, canStart: () => freeMb() >= cfg.minFreeMemoryMb });
  if (paused) return pause(c, "working");
  if (failed.length) return move(c, "needs_human", `subtask(s) failed: ${failed.join(", ")}; worktrees kept in ${path.join(runDir(root, s.id), "wt")}`);
  return move(c, "verifying");
}

async function integrate(c: Ctx, t: SubtaskState, sub: Subtask): Promise<boolean> {
  const m = mergeBranch(c.s.runWorktree, t.branch, `agentos: merge ${t.id}`);
  return m.ok || resolveConflicts(c, m.conflicts, sub.agent);
}

function conflictPrompt(s: RunState, files: string[]): string {
  return [
    `Goal: ${s.task}`,
    `A git merge in this directory stopped with conflicts in: ${files.join(", ")}.`,
    "Resolve every conflict so both sides' intent is kept, and remove all conflict markers. Edit files only; do not commit or abort the merge.",
  ].join("\n\n");
}

async function resolveConflicts(c: Ctx, files: string[], agent: AgentName): Promise<boolean> {
  const cwd = c.s.runWorktree;
  const res = await agentRunner(c, agent, "write")({ prompt: conflictPrompt(c.s, files), cwd, timeoutMs: minutes(c.cfg.subtaskMinutes) });
  const markers = files.some((f) => {
    try {
      return /^(<{7}|>{7}|={7})(\s|$)/m.test(readFileSync(path.join(cwd, f), "utf8"));
    } catch {
      return false;
    }
  });
  if (!res.ok || markers) {
    abortMerge(cwd);
    return false;
  }
  git(cwd, ["add", "-A"]);
  if (!tryGit(cwd, ["commit", "-q", "--no-edit"]).ok || mergeInProgress(cwd)) {
    abortMerge(cwd);
    return false;
  }
  return true;
}

async function verify(c: Ctx): Promise<void> {
  const { s, cfg } = c;
  const v = runVerify(s.runWorktree, cfg.verify, minutes(cfg.subtaskMinutes));
  s.verifyOk = v.ok;
  s.verifyOutput = redact(v.output);
  s.findings = [];
  if (v.ok) {
    // tests first; the review only runs on a change that passes them
    const authors = new Set(s.subtasks.map((t) => t.agent));
    const reviewer = authors.size === 1 && authors.has(cfg.reviewer) ? other(cfg.reviewer) : cfg.reviewer;
    const diff = git(s.runWorktree, ["diff", `${s.base}..HEAD`]);
    const res = await agentRunner(c, reviewer, "read")({ prompt: reviewPrompt(s.task, diff), cwd: s.runWorktree, timeoutMs: minutes(cfg.subtaskMinutes) });
    if (res.rateLimited) return pause(c, "verifying");
    s.findings = (res.ok && parseFindings(finalText(res.output))) || [{ severity: "low", file: "", line: 0, issue: `the reviewer (${reviewer}) gave no parseable findings` }];
  }
  saveRun(c.root, s);
  logEvent(c.root, s.id, { type: "verify", ok: v.ok, findings: s.findings });
  if (v.ok && blocking(s.findings).length === 0) return gate(c);
  if (s.fixRound >= cfg.maxFixRounds) {
    return move(c, "needs_human", `still failing after ${s.fixRound} fix round(s): ${v.ok ? `${blocking(s.findings).length} blocking review finding(s)` : "verify commands fail"}`);
  }
  return move(c, "fixing");
}

function fixPrompt(s: RunState): string {
  const found = blocking(s.findings);
  return [
    `Goal: ${s.task}`,
    "The change in this directory does not pass yet. Fix it. Edit files only; do not commit.",
    s.verifyOk === false ? `Failing checks:\n${s.verifyOutput}` : "",
    found.length ? `Review findings to fix:\n${found.map((f) => `- [${f.severity}] ${f.file}:${f.line} ${f.issue}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function fix(c: Ctx): Promise<void> {
  const { s } = c;
  s.fixRound++;
  saveRun(c.root, s);
  const author = s.subtasks[0]?.agent ?? c.cfg.workers[0];
  const res = await agentRunner(c, author, "write")({ prompt: fixPrompt(s), cwd: s.runWorktree, timeoutMs: minutes(c.cfg.subtaskMinutes) });
  if (res.rateLimited) {
    s.fixRound--;
    return pause(c, "fixing");
  }
  commitAll(s.runWorktree, `agentos: fix round ${s.fixRound}`);
  return move(c, "verifying");
}

function guardOutside(c: Ctx): void {
  const changed = statusOf(c.root);
  if (changed) {
    throw new Error(`an agent wrote outside its worktree (or the checkout was edited during the run) — stopped. Changed in ${c.root}:\n${changed}`);
  }
}

async function gate(c: Ctx): Promise<void> {
  const { s, root } = c;
  guardOutside(c);
  const fetched = tryGit(root, ["fetch", "-q", "origin", s.baseBranch]).ok;
  const latest = git(root, ["rev-parse", fetched ? `origin/${s.baseBranch}` : s.baseBranch]);
  if (!tryGit(s.runWorktree, ["merge-base", "--is-ancestor", latest, "HEAD"]).ok) {
    const m = mergeBranch(s.runWorktree, latest, `agentos: merge ${s.baseBranch}`);
    if (!m.ok && !(await resolveConflicts(c, m.conflicts, s.subtasks[0]?.agent ?? c.cfg.workers[0]))) {
      return move(c, "needs_human", `${s.baseBranch} moved during the run and merging it conflicted`);
    }
    s.base = latest;
    return move(c, "verifying"); // the tests must pass on the new base too
  }
  const hits = scanDiff(git(s.runWorktree, ["diff", `${s.base}..HEAD`]));
  if (hits.length) return move(c, "needs_human", `secret scan blocked the PR: ${hits.join("; ")}`);
  git(s.runWorktree, ["push", "-q", "-u", "origin", s.branch]);
  const out = c.deps.gh(s.runWorktree, ["pr", "create", "--base", s.baseBranch, "--head", s.branch, "--title", `agentos: ${s.task.slice(0, 60)}`, "--body", prBody(s)]);
  s.prUrl = out.trim().split("\n").pop();
  move(c, "pr_open", s.prUrl);
  remember(c);
}

function remember(c: Ctx): void {
  try {
    new MemoryStore(memoryFile(c.root)).store({ topic: "runs", key: c.s.id, value: `${c.s.task} → ${c.s.prUrl} (${c.s.fixRound} fix round(s))`, source: "agentos run" });
  } catch {
    /* memory is best effort */
  }
}

function cleanup(c: Ctx): void {
  for (const t of c.s.subtasks) {
    removeWorktree(c.root, t.worktree, c.cfg.link);
    tryGit(c.root, ["branch", "-D", t.branch]);
  }
  removeWorktree(c.root, c.s.runWorktree, c.cfg.link);
}
```

- [ ] **Step 5: Run the tests and the type check**

Run: `npx vitest run tests/orchestrator && npx tsc --noEmit && npm test`
Expected:
- all orchestrator tests pass, 14 of them in `engine.test.ts`
- tsc reports no errors
- the full suite is green

If a test fails on Windows, check these first:
- a path with spaces in a verify command
- a `.git` file lock (retry with `maxRetries` in cleanup)

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator/report.ts src/orchestrator/engine.ts tests/orchestrator/engine.test.ts
git commit -m "feat(orchestrator): engine — plan, parallel work, merge, verify/review/fix loop, gated PR, resume and cancel"
```

---

### Task 11: `agentos run` and `agentos runs`

**Files:**
- Create: `src/commands/run.ts`
- Modify:
  - `src/commands/doctor.ts`: export the existing `isCommandOnPath` by changing `function isCommandOnPath` to `export function isCommandOnPath`
  - `src/cli.ts`: register the commands
- Test: `tests/orchestrator/cli.test.ts`

**Interfaces:**
- Consumes:
  - `startRun`, `resumeRun`, `cancelRun` (Task 10)
  - `CLI_RUNNERS` (Task 5)
  - `listRuns`, `loadRun` (Task 3)
  - `runLine` (Task 10)
  - `loadConfig` (`src/core/loader.ts`)
- Produces:
  - `run(task, opts: { resume?; cancel?; status?; id?; cwd? }): Promise<number>`, which returns the exit code
  - `runs(opts: { json?; cwd? }): void`
  - `ORCHESTRATOR_SNIPPET`

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/cli.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeRepo } from "./helpers.js";
import { run, runs } from "../../src/commands/run.js";
import { saveRun, loadRun, type RunState } from "../../src/orchestrator/run.js";

let repo: ReturnType<typeof makeRepo>;
let logs: string[];
beforeEach(() => {
  repo = makeRepo({ "agent.config.yaml": "project: { name: t }\n" });
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
});
afterEach(() => { vi.restoreAllMocks(); repo.cleanup(); });

const seeded = (id: string, status: RunState["status"]): RunState => ({
  id, task: `task ${id}`, status, baseBranch: "main", base: "x", branch: `agentos/run-${id}`, runWorktree: "/nowhere",
  createdAt: new Date().toISOString(), updatedAt: "", subtasks: [], fixRound: 0, findings: [],
});

describe("agentos run / runs", () => {
  it("says how to start when there are no runs", () => {
    runs({ cwd: repo.root });
    expect(logs.join("\n")).toContain("No runs yet");
  });

  it("lists runs as JSON", () => {
    saveRun(repo.root, seeded("r1", "paused"));
    runs({ cwd: repo.root, json: true });
    expect(JSON.parse(logs.join("\n"))[0]).toMatchObject({ id: "r1", status: "paused", task: "task r1" });
  });

  it("refuses to run without an orchestrator block, and shows one", async () => {
    await expect(run("do x", { cwd: repo.root })).rejects.toThrow(/orchestrator:\n {2}verify:/);
  });

  it("prints a run's state", async () => {
    saveRun(repo.root, seeded("r2", "paused"));
    await run("", { cwd: repo.root, status: "r2" });
    expect(JSON.parse(logs.join("\n")).task).toBe("task r2");
  });

  it("cancels a paused run", async () => {
    saveRun(repo.root, seeded("r3", "paused"));
    await run("", { cwd: repo.root, cancel: "r3" });
    expect(loadRun(repo.root, "r3").status).toBe("cancelled");
  });

  it("rejects path-like run ids", async () => {
    await expect(run("", { cwd: repo.root, status: "../x" })).rejects.toThrow("invalid run id");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/orchestrator/cli.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement the command module**

In `src/commands/doctor.ts`, change `function isCommandOnPath(cmd: string): boolean {` to `export function isCommandOnPath(cmd: string): boolean {`.

```ts
// src/commands/run.ts
import { execFileSync } from "node:child_process";
import { loadConfig } from "../core/loader.js";
import { git } from "../orchestrator/workspace.js";
import { startRun, resumeRun, cancelRun, type EngineDeps } from "../orchestrator/engine.js";
import { listRuns, loadRun } from "../orchestrator/run.js";
import { CLI_RUNNERS } from "../orchestrator/runners.js";
import { runLine } from "../orchestrator/report.js";
import { isCommandOnPath } from "./doctor.js";

export const ORCHESTRATOR_SNIPPET = `orchestrator:
  verify: [npm test]          # commands that must pass before a PR opens
  workers: [claude, codex]    # agent CLIs that write code (your subscriptions)
  reviewer: codex             # reviews every diff
  maxWorkers: 2`;

const repoRoot = (cwd = process.cwd()) => git(cwd, ["rev-parse", "--show-toplevel"]);

const gh = (cwd: string, args: string[]) =>
  execFileSync("gh", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

/** agentos run: start, resume, cancel or inspect a run. Returns the exit code. */
export async function run(task: string, opts: { resume?: string; cancel?: string; status?: string; id?: string; cwd?: string }): Promise<number> {
  const root = repoRoot(opts.cwd);
  if (opts.status) {
    console.log(JSON.stringify(loadRun(root, opts.status), null, 2));
    return 0;
  }
  if (opts.cancel) {
    console.log(runLine(await cancelRun(root, opts.cancel)));
    return 0;
  }
  const cfg = loadConfig(root).config.orchestrator;
  if (!cfg) throw new Error(`agent.config.yaml has no orchestrator block. Add one, for example:\n\n${ORCHESTRATOR_SNIPPET}`);
  const missing = [...new Set([cfg.planner, cfg.reviewer, ...cfg.workers])].filter((a) => !isCommandOnPath(a));
  if (missing.length) throw new Error(`not on PATH: ${missing.join(", ")} — install it, or remove it from orchestrator planner/reviewer/workers`);
  const deps: EngineDeps = {
    runners: CLI_RUNNERS,
    gh,
    onStatus: (s) => console.log(`→ ${s.status}${s.reason ? `: ${s.reason.split("\n")[0]}` : ""}`),
  };
  const s = opts.resume ? await resumeRun(root, opts.resume, cfg, deps) : await startRun(root, task, cfg, deps, opts.id);
  console.log(runLine(s));
  return s.status === "pr_open" ? 0 : 1;
}

/** agentos runs */
export function runs(opts: { json?: boolean; cwd?: string }): void {
  const all = listRuns(repoRoot(opts.cwd));
  if (opts.json) {
    console.log(JSON.stringify(all.map(({ id, status, task, prUrl, reason, createdAt }) => ({ id, status, task, prUrl, reason, createdAt })), null, 2));
    return;
  }
  if (!all.length) {
    console.log('No runs yet. Start one: agentos run "<task>"');
    return;
  }
  for (const s of all) console.log(runLine(s));
}
```

- [ ] **Step 4: Register the commands in `src/cli.ts`**

Add these imports next to the others:

```ts
import { run, runs } from "./commands/run.js";
```

Add this before the `program.command("doctor")` block:

```ts
program
  .command("run [task...]")
  .description("Hand a task to the agent team: plan → parallel agents → tests + cross-model review → pull request")
  .option("--resume <id>", "continue a paused or interrupted run")
  .option("--cancel <id>", "stop a run (its worktrees are kept)")
  .option("--status <id>", "print a run's full state as JSON")
  .option("--id <id>", "use this run id (used by the orchestrator MCP server)")
  .action(async (words: string[], opts) => {
    try {
      const task = words.join(" ").trim();
      if (!task && !opts.resume && !opts.cancel && !opts.status) {
        fail(new Error('Give a task: agentos run "add a discount field to customers"'));
      }
      process.exitCode = await run(task, opts);
    } catch (e) { fail(e); }
  });

program
  .command("runs")
  .description("List orchestrator runs, newest first")
  .option("--json", "machine-readable JSON output")
  .action((opts) => { try { runs({ json: opts.json }); } catch (e) { fail(e); } });
```

- [ ] **Step 5: Run the tests, the type check and a smoke test**

Run: `npx vitest run tests/orchestrator/cli.test.ts && npx tsc --noEmit && npx tsx src/cli.ts run --help`
Expected:
- 6 passed
- tsc reports no errors
- the help lists `--resume`, `--cancel`, `--status` and `--id`

- [ ] **Step 6: Commit**

```bash
git add src/commands/run.ts src/commands/doctor.ts src/cli.ts tests/orchestrator/cli.test.ts
git commit -m "feat(orchestrator): agentos run / agentos runs commands"
```

---

### Task 12: Orchestrator MCP server

**Files:**
- Create: `src/mcp/orchestrator/server.ts`
- Modify: `src/cli.ts`. Add the `mcp orchestrator` subcommand.
- Test: `tests/orchestrator/mcp.test.ts`

**Interfaces:**
- Consumes:
  - `newRunId`, `listRuns`, `loadRun` (Task 3)
  - `cancelRun` (Task 10)
  - `runLine` (Task 10)
  - `projectRoot` (`src/core/project.ts`)
- Produces:
  - `createOrchestratorServer(root?, launch?: (root, id, task) => void): McpServer`, with the tools `run_task`, `run_status` and `run_cancel`
  - `spawnDetachedRun(root, id, task)`

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/mcp.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOrchestratorServer } from "../../src/mcp/orchestrator/server.js";
import { saveRun, loadRun, type RunState } from "../../src/orchestrator/run.js";

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), "agentos-orch-mcp-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

const seeded = (id: string, status: RunState["status"]): RunState => ({
  id, task: `task ${id}`, status, baseBranch: "main", base: "x", branch: `agentos/run-${id}`, runWorktree: "/nowhere",
  createdAt: new Date().toISOString(), updatedAt: "", subtasks: [], fixRound: 0, findings: [],
});

async function connect(launch = (_r: string, _i: string, _t: string) => {}) {
  const server = createOrchestratorServer(root, launch);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([client.connect(a), server.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    ((await client.callTool({ name, arguments: args })).content as { text: string }[])[0].text;
  return { client, call };
}

describe("orchestrator MCP server", () => {
  it("run_task launches a background run and returns its id at once", async () => {
    const launched: string[][] = [];
    const { call, client } = await connect((r, i, t) => launched.push([r, i, t]));
    const text = await call("run_task", { task: "add a discount field" });
    expect(launched).toHaveLength(1);
    expect(launched[0][0]).toBe(root);
    expect(launched[0][2]).toBe("add a discount field");
    expect(text).toContain(launched[0][1]);
    await client.close();
  });

  it("run_status lists recent runs, or shows one", async () => {
    saveRun(root, seeded("r1", "paused"));
    const { call, client } = await connect();
    expect(await call("run_status")).toContain("r1");
    expect(await call("run_status", { id: "r1" })).toContain("task r1");
    await client.close();
  });

  it("run_cancel cancels a paused run", async () => {
    saveRun(root, seeded("r2", "paused"));
    const { call, client } = await connect();
    await call("run_cancel", { id: "r2" });
    expect(loadRun(root, "r2").status).toBe("cancelled");
    await client.close();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/orchestrator/mcp.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

```ts
// src/mcp/orchestrator/server.ts
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectRoot } from "../../core/project.js";
import { VERSION } from "../../version.js";
import { listRuns, loadRun, newRunId } from "../../orchestrator/run.js";
import { cancelRun } from "../../orchestrator/engine.js";
import { runLine } from "../../orchestrator/report.js";

/** `agentos run --id <id> <task>` as a detached process: the run outlives the chat that asked for it. No shell, so the task text is never parsed. */
export function spawnDetachedRun(root: string, id: string, task: string): void {
  const cli = fileURLToPath(new URL("../../cli.js", import.meta.url));
  spawn(process.execPath, [cli, "run", "--id", id, task], { cwd: root, detached: true, stdio: "ignore", windowsHide: true }).unref();
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export function createOrchestratorServer(root = projectRoot(), launch = spawnDetachedRun): McpServer {
  const server = new McpServer({ name: "agentos-orchestrator", version: VERSION });

  server.tool(
    "run_task",
    "Hand a coding task to the agentos team: plan → parallel agents in git worktrees → tests + cross-model review → pull request. Returns a run id at once; the run continues in the background.",
    { task: z.string().min(3).describe("What to build or fix, in plain words") },
    async ({ task }) => {
      const id = newRunId();
      launch(root, id, task);
      return text(`Started run ${id}. Check it with run_status {"id":"${id}"}; it ends with a pull request or a reason it needs you.`);
    },
  );

  server.tool(
    "run_status",
    "Status of one run (by id), or the 10 most recent runs.",
    { id: z.string().optional() },
    async ({ id }) => {
      if (!id) return text(listRuns(root).slice(0, 10).map(runLine).join("\n") || "No runs yet.");
      const s = loadRun(root, id);
      const subs = s.subtasks.map((t) => `  ${t.id}  ${t.agent}  ${t.status}`).join("\n");
      return text(`${runLine(s)}${s.reason ? `\nreason: ${s.reason}` : ""}${subs ? `\n${subs}` : ""}`);
    },
  );

  server.tool(
    "run_cancel",
    "Cancel a running or paused run. Its worktrees are kept for inspection.",
    { id: z.string() },
    async ({ id }) => text(runLine(await cancelRun(root, id))),
  );

  return server;
}
```

In `src/cli.ts`:
- Import `createOrchestratorServer` from `./mcp/orchestrator/server.js`.
- Add this after the `mcp codegraph` command:

```ts
mcp
  .command("orchestrator")
  .description("Run the orchestrator MCP server over stdio (run_task / run_status / run_cancel)")
  .action(async () => {
    const server = createOrchestratorServer();
    await server.connect(new StdioServerTransport());
  });
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run tests/orchestrator/mcp.test.ts && npx tsc --noEmit && npm test`
Expected: 3 passed, tsc clean, and the full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/orchestrator/server.ts src/cli.ts tests/orchestrator/mcp.test.ts
git commit -m "feat(orchestrator): MCP server so a Claude Code / Codex chat can hand work to agentos"
```

---

### Task 13: Docs, build, and the real end-to-end check

**Files:**
- Modify:
  - `README.md`: add a section after the handoff section
  - `CHANGELOG.md`: add an `Unreleased` entry at the top
  - `dist/`: rebuilt
- Create: `bench/orchestrator-e2e.md`

- [ ] **Step 1: Add the README section**

````markdown
## `agentos run` — hand a task to the agent team

Add an `orchestrator` block to `agent.config.yaml`:

```yaml
orchestrator:
  verify: [npm test, npx tsc --noEmit]   # must pass before a PR opens
  workers: [claude, codex]               # agent CLIs that write code — your subscriptions, no API keys
  reviewer: codex                        # reviews the diff (swapped if it wrote everything)
  maxWorkers: 2                          # parallel agents, each in its own git worktree
  link: [node_modules]                   # installed deps shared from your checkout into worktrees
```

```bash
agentos run "add a discount field to customers"   # plan → parallel agents → tests + review → PR
agentos runs                                        # list runs
agentos run --resume <id>                           # continue after a rate limit or a crash
agentos run --cancel <id>
```

A run ends with a pull request, or with a reason it needs you. It never pushes your default branch or deploys. It never uses the agents' skip-permission flags. It blocks the PR when the diff adds a secret. Run state and logs are kept in `.agentos/runs/<id>/`.

To hand work over from inside a Claude Code or Codex chat, register the MCP server and call `run_task`:

```yaml
mcpServers:
  - name: orchestrator
    command: npx
    args: ["-y", "@basit0090/agent-os@0.3.0", "mcp", "orchestrator"]
```
````

- [ ] **Step 2: Add the CHANGELOG entry**

```markdown
## Unreleased (0.3.0)

### Added
- `agentos run "<task>"`: a planner splits the task, and Claude Code / Codex workers run in parallel git worktrees. Each finished subtask merges into a run branch. Verify commands run, a different model reviews the diff, and a fixer loops until both pass (up to `maxFixRounds`). A pull request opens at the end.
- `agentos runs`, plus `agentos run --resume | --cancel | --status <id>`. A run pauses on a rate limit instead of failing, and resumes where it stopped.
- An `orchestrator` MCP server (`run_task`, `run_status`, `run_cancel`) so a chat can hand work to agentos.
- Safety:
  - agents work only in worktrees (writes to your checkout stop the run)
  - the default branch is never pushed
  - there are no skip-permission flags
  - a secret scan runs before every push
  - secret-looking env values are redacted from logs
```

- [ ] **Step 3: Build and commit**

Run: `npm run compile && npm test && npx tsc --noEmit`
Expected: the build succeeds and every test passes.

```bash
git add README.md CHANGELOG.md dist
git commit -m "docs(orchestrator): README + CHANGELOG for agentos run; rebuild dist"
```

- [ ] **Step 4: Create the e2e record**

```markdown
<!-- bench/orchestrator-e2e.md -->
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
```

```bash
git add bench/orchestrator-e2e.md
git commit -m "bench: orchestrator e2e record template"
```

- [ ] **Step 5: Real e2e (done by the controller session after review, because it uses subscription quota)**

For each row:
1. Add an `orchestrator` block to that repo's `agent.config.local.yaml`, so the committed config stays untouched.
2. Run `node <agentos>/dist/cli.js run "<task>"` from a clean checkout.
3. Watch `.agentos/runs/<id>/events.jsonl`.
4. Fill in the row.

Things to confirm on the first real run:
- `finalText` reads the installed CLIs' actual JSON event shapes. If it does not, adjust it and add the real line to `runners.test.ts`.
- Codex `-s workspace-write` can write in a worktree on Windows.
- Claude `--disallowedTools` keeps the planner and reviewer read-only.

Record anything you changed as a follow-up commit, with a test.
