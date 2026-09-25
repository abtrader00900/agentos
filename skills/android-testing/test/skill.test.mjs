// Contract test for skill: android-testing
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";

const skillDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const md = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");

describe("skill: android-testing", () => {
  it("has frontmatter with name and Use when trigger", () => {
    expect(md).toContain("name: android-testing");
    expect(md).toMatch(/description:[\s\S]*Use when/);
  });

  it("documents coroutine dispatcher injection", () => {
    expect(md.includes("CoroutineDispatcher") || md.includes("TestDispatcher")).toBe(true);
  });

  it("covers ViewModel, Compose, and Turbine", () => {
    for (const topic of ["ViewModel", "Compose", "Turbine"]) {
      expect(md).toContain(topic);
    }
  });

  it("flags Thread.sleep anti-pattern and naming convention", () => {
    expect(md).toContain("Thread.sleep");
    expect(
      md.includes("methodName_condition_expectedResult") || md.includes("method_condition_expected")
    ).toBe(true);
  });
});
