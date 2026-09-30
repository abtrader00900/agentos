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
      minFreeMemoryMb: 1500, link: ["node_modules"], models: {},
    });
  });

  it("takes an optional model per agent CLI, and only names safe on a command line", () => {
    expect(orchestratorSchema.parse({ models: { codex: "gpt-5.6-sol" } }).models).toEqual({ codex: "gpt-5.6-sol" });
    expect(orchestratorSchema.parse({ models: { claude: "claude-opus-5-5" } }).models.claude).toBe("claude-opus-5-5");
    for (const bad of ["gpt 5", "x&calc", "a\"b", "", "m".repeat(65)]) {
      expect(orchestratorSchema.safeParse({ models: { codex: bad } }).success).toBe(false);
    }
    expect(orchestratorSchema.safeParse({ models: { gemini: "x" } }).success).toBe(false);
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
