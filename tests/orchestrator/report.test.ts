import { describe, it, expect } from "vitest";
import { prTitle } from "../../src/orchestrator/report.js";

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
