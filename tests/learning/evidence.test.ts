import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveRun, logEvent, type RunState } from "../../src/orchestrator/run.js";
import { collectEvidence, describeEvidence } from "../../src/learning/evidence.js";

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), "agentos-ev-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = (id: string, over: Partial<RunState> = {}): RunState => ({
  id, task: "t", status: "pr_open", baseBranch: "main", base: "x", branch: `agentos/run-${id}`, runWorktree: "/w",
  createdAt: new Date().toISOString(), updatedAt: "", subtasks: [], fixRound: 0, findings: [], ...over,
});
const high = { severity: "high", file: "a.ts", line: 3, issue: "crash on empty list" };

describe("collectEvidence", () => {
  it("turns fail → fix → pass into verify_fixed with the command and fixed files", () => {
    saveRun(root, run("r1"));
    logEvent(root, "r1", { type: "verify", ok: false, findings: [], command: "npm test", output: "…expected 5 got -1" });
    logEvent(root, "r1", { type: "fix", round: 1, files: ["sum.js"] });
    logEvent(root, "r1", { type: "verify", ok: true, findings: [] });
    const [e] = collectEvidence(root, "r1");
    expect(e).toMatchObject({ id: "E1", type: "verify_fixed", command: "npm test", files: ["sum.js"], round: 1 });
    expect(describeEvidence(e)).toContain("`npm test` failed");
  });

  it("turns a blocking finding that disappeared into finding_fixed, ignoring low ones", () => {
    saveRun(root, run("r2"));
    logEvent(root, "r2", { type: "verify", ok: true, findings: [high, { severity: "low", file: "", line: 0, issue: "nit" }] });
    logEvent(root, "r2", { type: "fix", round: 1, files: ["a.ts"] });
    logEvent(root, "r2", { type: "verify", ok: true, findings: [] });
    expect(collectEvidence(root, "r2")).toEqual([{ id: "E1", type: "finding_fixed", severity: "high", file: "a.ts", issue: "crash on empty list" }]);
  });

  it("does not count a finding as fixed while the reviewer still reports blocking ones", () => {
    saveRun(root, run("r3"));
    logEvent(root, "r3", { type: "verify", ok: true, findings: [high] });
    logEvent(root, "r3", { type: "verify", ok: true, findings: [high] });
    expect(collectEvidence(root, "r3")).toEqual([]);
  });

  it("collects fallbacks, conflicts, planner retries and needs_human", () => {
    saveRun(root, run("r4", { status: "needs_human", reason: "still failing after 3 fix round(s)\nmore" }));
    logEvent(root, "r4", { type: "planner-retry", error: "no JSON object" });
    logEvent(root, "r4", { type: "fallback", from: "codex", to: "claude", why: "error", error: "model not supported" });
    logEvent(root, "r4", { type: "conflict-resolved", files: ["shared.txt"] });
    expect(collectEvidence(root, "r4").map((e) => e.type)).toEqual(["planner_retry", "fallback", "conflict_resolved", "needs_human"]);
    expect(collectEvidence(root, "r4")[3]).toMatchObject({ reason: "still failing after 3 fix round(s)" });
  });

  it("masks secret-pattern text in a description", () => {
    const gh = "ghp_" + "a".repeat(36);
    saveRun(root, run("r6", { status: "needs_human", reason: `token ${gh} rejected` }));
    const [e] = collectEvidence(root, "r6");
    expect(describeEvidence(e)).not.toContain(gh);
    expect(describeEvidence(e)).toContain("***");
  });

  it("returns nothing for a clean run", () => {
    saveRun(root, run("r5"));
    logEvent(root, "r5", { type: "verify", ok: true, findings: [] });
    expect(collectEvidence(root, "r5")).toEqual([]);
  });
});
