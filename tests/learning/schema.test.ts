import { describe, it, expect } from "vitest";
import { agentConfigSchema, learningSchema } from "../../src/core/schema.js";

describe("learning config", () => {
  it("is optional, so 0.3 configs parse unchanged", () => {
    expect(agentConfigSchema.parse({ project: { name: "p" } }).learning).toBeUndefined();
  });

  it("fills defaults", () => {
    expect(learningSchema.parse({})).toEqual({ retro: true, retroAgent: "claude", maxLessonsInPrompt: 5, skillAfterRuns: 3 });
  });

  it("bounds its numbers", () => {
    expect(learningSchema.safeParse({ maxLessonsInPrompt: 21 }).success).toBe(false);
    expect(learningSchema.safeParse({ skillAfterRuns: 1 }).success).toBe(false);
    expect(learningSchema.safeParse({ retroAgent: "gemini" }).success).toBe(false);
  });
});
