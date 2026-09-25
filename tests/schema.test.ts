import { describe, it, expect } from "vitest";
import { agentConfigSchema, rulesForHarness } from "../src/core/schema.js";

describe("agentConfigSchema", () => {
  it("accepts a minimal valid config", () => {
    const parsed = agentConfigSchema.parse({ project: { name: "x" } });
    expect(parsed.stack).toEqual([]);
    expect(parsed.rules).toEqual([]);
  });

  it("rejects config without project name", () => {
    expect(agentConfigSchema.safeParse({}).success).toBe(false);
  });

  it("rejects invalid harness name in rule", () => {
    const result = agentConfigSchema.safeParse({
      project: { name: "x" },
      rules: [{ id: "r1", text: "t", harnesses: ["not-a-harness"] }],
    });
    expect(result.success).toBe(false);
  });
});

describe("rulesForHarness", () => {
  const config = agentConfigSchema.parse({
    project: { name: "x" },
    rules: [
      { id: "all", text: "everyone" },
      { id: "codex-only", text: "codex", harnesses: ["codex"] },
    ],
  });

  it("returns all rules without harness filter", () => {
    expect(rulesForHarness(config, "claude-code").map((r) => r.id)).toEqual(["all"]);
  });

  it("returns filtered rules for specific harness", () => {
    expect(rulesForHarness(config, "codex").map((r) => r.id)).toEqual(["all", "codex-only"]);
  });
});
