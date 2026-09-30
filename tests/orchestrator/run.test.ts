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
    saveRun(root, state("r1", "2000-01-01T00:00:00.000Z"));
    const s = loadRun(root, "r1");
    expect(s.task).toBe("t");
    expect(s.updatedAt > "2000-01-01T00:00:00.000Z").toBe(true); // saveRun stamps the current time
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
