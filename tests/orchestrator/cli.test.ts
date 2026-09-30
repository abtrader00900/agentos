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

  it("records a background (--id) start that fails preflight, so run_status can explain it", async () => {
    await expect(run("do x", { cwd: repo.root, id: "bg1" })).rejects.toThrow(/orchestrator block/);
    const s = loadRun(repo.root, "bg1");
    expect(s.status).toBe("failed");
    expect(s.reason).toContain("orchestrator block");
  });

  it("never overwrites an existing run when a start with its id fails", async () => {
    saveRun(repo.root, seeded("r5", "paused"));
    await expect(run("do x", { cwd: repo.root, id: "r5" })).rejects.toThrow();
    expect(loadRun(repo.root, "r5")).toMatchObject({ status: "paused", task: "task r5" });
  });

  it("rejects path-like run ids", async () => {
    await expect(run("", { cwd: repo.root, status: "../x" })).rejects.toThrow("invalid run id");
  });
});
