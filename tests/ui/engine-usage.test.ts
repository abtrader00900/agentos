import { describe, it, expect, afterEach, vi } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { makeRepo } from "../orchestrator/helpers.js";
import { startRun, type EngineDeps } from "../../src/orchestrator/engine.js";
import { runDir } from "../../src/orchestrator/run.js";
import { orchestratorSchema } from "../../src/core/schema.js";
import type { Runner, RunnerResult } from "../../src/orchestrator/types.js";

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo.cleanup());
const reply = (text = "done"): RunnerResult => ({ ok: true, output: JSON.stringify({ type: "result", result: text }) + "\n", rateLimited: false, timedOut: false });
const plan = { summary: "p", subtasks: [{ id: "a", title: "a", prompt: "create a.txt", files: ["a.txt"], dependsOn: [], agent: "claude" }] };

describe("engine usage events", { timeout: 60_000 }, () => {
  it("logs a usage event from the agent's result line, before truncation", async () => {
    repo = makeRepo();
    const read: Runner = async (req) => (req.prompt.includes("You are the planner") ? reply(JSON.stringify(plan)) : reply("[]"));
    const write: Runner = async (req) => {
      req.onLine?.(JSON.stringify({ type: "result", result: "x".repeat(9000), total_cost_usd: 0.3, usage: { input_tokens: 5, output_tokens: 2 } }));
      writeFileSync(path.join(req.cwd, "a.txt"), "a\n");
      return reply();
    };
    const deps: EngineDeps = { runners: { claude: { read, write }, codex: { read, write } }, gh: vi.fn(() => "https://x/pull/1\n"), freeMemMb: () => 1e6 };
    await startRun(repo.root, "create a", orchestratorSchema.parse({ link: [] }), deps, "u1");
    const events = readFileSync(path.join(runDir(repo.root, "u1"), "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(events.find((e) => e.type === "usage")).toMatchObject({ agent: "claude", costUsd: 0.3, inputTokens: 5, outputTokens: 2 });
  });
});
