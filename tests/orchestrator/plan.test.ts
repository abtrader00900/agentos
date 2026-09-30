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
