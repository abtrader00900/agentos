import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeRepo } from "../orchestrator/helpers.js";
import { saveRun, logEvent, loadRun, runDir, type RunState } from "../../src/orchestrator/run.js";
import { saveLessons, listLessons } from "../../src/learning/lessons.js";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { draftSkill, draftsDir } from "../../src/learning/skilldraft.js";
import { lessonsCommand, learnRuns, skillDraftsCommand, skillApproveCommand, skillRejectCommand } from "../../src/commands/lessons.js";
import { doctor } from "../../src/commands/doctor.js";
import type { Runner, RunnerResult } from "../../src/orchestrator/types.js";

let repo: ReturnType<typeof makeRepo>;
let logs: string[];
beforeEach(() => {
  repo = makeRepo({ "agent.config.yaml": "project: { name: t }\norchestrator: { verify: [] }\n" });
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
});
afterEach(() => { vi.restoreAllMocks(); repo.cleanup(); });

const reply = (text: string): RunnerResult => ({ ok: true, output: JSON.stringify({ type: "result", result: text }) + "\n", rateLimited: false, timedOut: false });
const EV = ["E1: verify_fixed: `npm test` failed"];

describe("lessons CLI", () => {
  it("lists, filters pending, approves and forgets", () => {
    const [a, p] = saveLessons(repo.root, "r1", undefined, [
      { text: "Run migrations in tests before seeding data", roles: ["worker"], evidence: EV },
      { text: "Maybe prefer smaller subtasks for views", roles: ["planner"], evidence: [] },
    ]);
    lessonsCommand(undefined, undefined, { cwd: repo.root });
    expect(logs.join("\n")).toContain(a);
    expect(logs.join("\n")).toContain("· E1: verify_fixed: `npm test` failed"); // the evidence is shown
    logs = [];
    lessonsCommand(undefined, undefined, { cwd: repo.root, pending: true, json: true });
    expect(JSON.parse(logs.join("\n")).map((l: { key: string }) => l.key)).toEqual([p]);
    lessonsCommand("approve", p, { cwd: repo.root });
    expect(listLessons(repo.root).find((l) => l.key === p)?.meta.status).toBe("approved");
    lessonsCommand("forget", a, { cwd: repo.root });
    expect(listLessons(repo.root).map((l) => l.key)).toEqual([p]);
    expect(() => lessonsCommand("explode", a, { cwd: repo.root })).toThrow(/Unknown action/);
  });

  it("learn --run learns one finished run with the given runners", async () => {
    const s: RunState = { id: "old1", task: "t", status: "pr_open", baseBranch: "main", base: "x", branch: "agentos/run-old1", runWorktree: "/w", createdAt: new Date().toISOString(), updatedAt: "", subtasks: [], fixRound: 1, findings: [] };
    saveRun(repo.root, s);
    logEvent(repo.root, "old1", { type: "verify", ok: false, findings: [], command: "npm test", output: "boom" });
    logEvent(repo.root, "old1", { type: "fix", round: 1, files: ["a.js"] });
    logEvent(repo.root, "old1", { type: "verify", ok: true, findings: [] });
    const read: Runner = async () => reply(JSON.stringify({ kind: "bug-fix", lessons: [{ text: "Check a.js edge cases before the verify step", roles: ["worker"], evidence: ["E1"] }] }));
    await learnRuns({ cwd: repo.root, run: "old1" }, { claude: { read, write: read }, codex: { read, write: read } });
    expect(loadRun(repo.root, "old1")).toMatchObject({ learned: "done", kind: "bug-fix" });
    expect(listLessons(repo.root)[0].meta.status).toBe("auto");
  });

  it("filters by --role and rejects an unknown role", () => {
    const [w, p] = saveLessons(repo.root, "r1", undefined, [
      { text: "Run migrations in tests before seeding data", roles: ["worker"], evidence: EV },
      { text: "Prefer smaller subtasks for views", roles: ["planner"], evidence: EV },
    ]);
    lessonsCommand(undefined, undefined, { cwd: repo.root, role: "planner", json: true });
    expect(JSON.parse(logs.join("\n")).map((l: { key: string }) => l.key)).toEqual([p]);
    expect(w).not.toBe(p);
    expect(() => lessonsCommand(undefined, undefined, { cwd: repo.root, role: "boss" })).toThrow(/Unknown role/);
  });

  const runOf = (id: string, status: RunState["status"], learned?: RunState["learned"]): RunState =>
    ({ id, task: "t", status, learned, baseBranch: "main", base: "x", branch: `agentos/run-${id}`, runWorktree: "/w", createdAt: new Date().toISOString(), updatedAt: "", subtasks: [], fixRound: 0, findings: [] });
  const fakeRunners = () => {
    const read: Runner = async () => reply(JSON.stringify({ kind: "misc", lessons: [] }));
    return { claude: { read, write: read }, codex: { read, write: read } };
  };

  it("learn --run fails clearly for an unknown run id", async () => {
    await expect(learnRuns({ cwd: repo.root, run: "nope" }, fakeRunners())).rejects.toThrow(/No run "nope"/);
  });

  it("learn --pending-runs skips cancelled, done and skipped runs and retries failed ones", async () => {
    for (const [id, st, l] of [["new", "pr_open", undefined], ["retry", "needs_human", "failed"], ["c", "cancelled", undefined], ["d", "pr_open", "done"], ["s", "failed", "skipped"]] as const) saveRun(repo.root, runOf(id, st, l));
    await learnRuns({ cwd: repo.root, pendingRuns: true }, fakeRunners());
    const out = logs.join("\n");
    expect(out).toMatch(/new: /);
    expect(out).toMatch(/retry: /);
    expect(out).not.toMatch(/^(c|d|s): /m);
    expect(loadRun(repo.root, "new").learned).toBe("done");
    expect(loadRun(repo.root, "c").learned).toBeUndefined();
  });

  it("learn --run refuses a run that has not finished", async () => {
    saveRun(repo.root, runOf("busy", "running"));
    await expect(learnRuns({ cwd: repo.root, run: "busy" }, fakeRunners())).rejects.toThrow("run busy is running; learn it after it finishes");
    expect(loadRun(repo.root, "busy").learned).toBeUndefined();
  });

  it("learn --pending-runs skips a run an engine still holds the lock of", async () => {
    saveRun(repo.root, runOf("locked", "pr_open"));
    saveRun(repo.root, runOf("free", "pr_open"));
    writeFileSync(path.join(runDir(repo.root, "locked"), "lock"), String(process.pid));
    await learnRuns({ cwd: repo.root, pendingRuns: true }, fakeRunners());
    expect(logs.join("\n")).not.toMatch(/^locked: /m);
    expect(loadRun(repo.root, "locked").learned).toBeUndefined();
    expect(loadRun(repo.root, "free").learned).toBe("done");
  });

  it("learn --run refuses a run whose lock is held by a live process", async () => {
    saveRun(repo.root, runOf("held", "pr_open"));
    writeFileSync(path.join(runDir(repo.root, "held"), "lock"), String(process.pid));
    await expect(learnRuns({ cwd: repo.root, run: "held" }, fakeRunners())).rejects.toThrow(`run held is still held by agentos process ${process.pid}`);
    expect(loadRun(repo.root, "held").learned).toBeUndefined();
  });

  it("learn --pending-runs takes over a run whose lock holder is dead", async () => {
    saveRun(repo.root, runOf("orphan", "needs_human"));
    writeFileSync(path.join(runDir(repo.root, "orphan"), "lock"), "999999"); // never a live PID (and not a multiple of 4, so never one on Windows)
    await learnRuns({ cwd: repo.root, pendingRuns: true }, fakeRunners());
    expect(logs.join("\n")).toMatch(/^orphan: done$/m);
    expect(loadRun(repo.root, "orphan").learned).toBe("done");
  });

  it("skill approve prints the full draft before installing it", async () => {
    const GOOD = "---\nname: erp-report\ndescription: Build a new ERP report page. Use when the owner asks for a report over ledger or stock data.\n---\n\n# ERP report\n\n## Workflow\n1. Add the query in a service class.\n\n## Rules\n- Eager load relations.\n"
    const r = await draftSkill(repo.root, "erp-report", [], async () => reply(GOOD), 1000);
    expect(r.ok).toBe(true);
    const draftPresent: boolean[] = [];
    vi.mocked(console.log).mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); draftPresent.push(existsSync(path.join(draftsDir(repo.root), "erp-report"))); });
    skillApproveCommand("erp-report", repo.root);
    expect(logs[0]).toContain("## Workflow");
    expect(draftPresent[0]).toBe(true); // printed while the draft still exists
    expect(logs[logs.length - 1]).toContain("installed");
    expect(draftPresent[draftPresent.length - 1]).toBe(false);
    expect(() => skillApproveCommand("erp-report", repo.root)).toThrow(/No skill draft/);
  });

  it("skill drafts: empty list and reject of a missing draft", () => {
    skillDraftsCommand(repo.root);
    expect(logs.join("\n")).toContain("No skill drafts");
    expect(() => skillRejectCommand("nope", repo.root)).toThrow(/No skill draft/);
  });

  it("doctor warns when active lessons exceed the limit", () => {
    // every word unique per lesson, so none of them merge
    const drafts = Array.from({ length: 201 }, (_, i) => ({ text: `topic${i} alpha${i} beta${i} gamma${i}`, roles: ["worker" as const], evidence: EV }));
    for (let i = 0; i < drafts.length; i += 3) saveLessons(repo.root, `r${i}`, undefined, drafts.slice(i, i + 3));
    const check = doctor({ cwd: repo.root, quiet: true }).checks.find((c) => c.name === "lessons:count");
    expect(check?.status).toBe("warn");
  });
});
