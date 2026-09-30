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
