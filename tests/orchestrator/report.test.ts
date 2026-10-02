import { describe, it, expect } from "vitest";
import { prBody, prTitle } from "../../src/orchestrator/report.js";
import type { RunState } from "../../src/orchestrator/run.js";

describe("prTitle", () => {
  it("keeps a short task whole", () => {
    expect(prTitle("fix the sum bug")).toBe("agentos: fix the sum bug");
  });

  it("cuts a long task at a word boundary, never mid-word", () => {
    const t = prTitle("Add a --limit <n> option to the 'agentos runs' command that shows only the n newest runs");
    expect(t.length).toBeLessThanOrEqual(72);
    expect(t.endsWith("…")).toBe(true);
    expect(t).toBe("agentos: Add a --limit <n> option to the 'agentos runs' command that…");
  });

  it("flattens newlines", () => {
    expect(prTitle("line one\nline two")).toBe("agentos: line one line two");
  });
});

describe("prBody", () => {
  const base: RunState = {
    id: "r1", task: "add a discount field", status: "pr_open", baseBranch: "main", base: "abc", branch: "agentos/run-r1",
    runWorktree: "w", createdAt: new Date().toISOString(), updatedAt: "", subtasks: [], fixRound: 0, findings: [],
  };

  it("leads with the risk flags and lists what the agents did not do", () => {
    const body = prBody({ ...base, risk: [{ rule: "migration", action: "flag", files: ["db/migrations/1.sql"] }],
      subtasks: [{ id: "a", agent: "claude", status: "done", branch: "b", worktree: "w", report: { changed: ["x"], notDone: ["y"], assumed: [], notVerified: ["z"] } }] });
    expect(body.indexOf("⚠️ Look here")).toBeLessThan(body.indexOf("| Subtask |"));
    expect(body).toContain("migration: db/migrations/1.sql");
    expect(body).toContain("Not done: y");
    expect(body).toContain("Not verified: z");
  });

  it("says when the decider skipped the planner and shows decider flag percentages", () => {
    const body = prBody({ ...base, quick: true, autoQuick: { p: 0.91 }, risk: [{ rule: "jevos:money", action: "flag", files: [], p: 0.82 }] });
    expect(body).toContain("**Planner:** skipped by the decider (jevos 0.91)");
    expect(body).toContain("- jevos:money (82%)");
  });
});
