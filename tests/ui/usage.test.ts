import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { usageFromLine, runUsage } from "../../src/ui/usage.js";
import { saveRun, logEvent, type RunState } from "../../src/orchestrator/run.js";

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), "agentos-usage-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
const run = (id: string): RunState => ({ id, task: "t", status: "pr_open", baseBranch: "main", base: "x", branch: `agentos/run-${id}`, runWorktree: "", createdAt: new Date().toISOString(), updatedAt: "", subtasks: [], fixRound: 0, findings: [] });

describe("usage", () => {
  it("reads Claude result and Codex turn.completed lines", () => {
    expect(usageFromLine(JSON.stringify({ type: "result", result: "x".repeat(9000), total_cost_usd: 0.25, usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 7 } })))
      .toEqual({ costUsd: 0.25, inputTokens: 115, outputTokens: 7 });
    expect(usageFromLine(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 40, cached_input_tokens: 10, output_tokens: 3 } })))
      .toEqual({ inputTokens: 40, outputTokens: 3 });
    expect(usageFromLine('{"type":"system"}')).toBeNull();
    expect(usageFromLine("not json")).toBeNull();
  });

  it("sums usage events per run and per agent, falling back to agent lines", () => {
    saveRun(root, run("r1"));
    logEvent(root, "r1", { type: "usage", agent: "claude", costUsd: 0.2, inputTokens: 100, outputTokens: 10 });
    logEvent(root, "r1", { type: "usage", agent: "codex", inputTokens: 50, outputTokens: 5 });
    expect(runUsage(root, "r1")).toMatchObject({ costUsd: 0.2, inputTokens: 150, outputTokens: 15, byAgent: { claude: { costUsd: 0.2 }, codex: { inputTokens: 50 } } });
    saveRun(root, run("r2"));
    logEvent(root, "r2", { type: "agent", agent: "claude", line: JSON.stringify({ type: "result", total_cost_usd: 0.1, usage: { input_tokens: 1, output_tokens: 1 } }) });
    expect(runUsage(root, "r2").costUsd).toBe(0.1);
  });
});
