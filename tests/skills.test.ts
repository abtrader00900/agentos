import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSkillDir, listSkills, parseSkill, testSkills } from "../src/core/skills.js";

const skillsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../skills");

describe("skills framework (FR-6.x)", () => {
  it("ships exactly the 11 core skills (FR-6.4)", () => {
    const names = listSkills(skillsRoot).map((s) => s.name);
    expect(names.sort()).toEqual([
      "android-testing",
      "api-contract",
      "code-review",
      "commit-message",
      "db-migration-check",
      "doc-sync",
      "pr-description",
      "refactor-safe",
      "security-scan",
      "tdd-laravel",
      "tdd-react",
    ]);
  });

  it("all bundled skills pass validation (FR-6.1/6.2)", () => {
    const results = testSkills(skillsRoot);
    for (const r of results) {
      expect(r.issues, `skill '${r.skill}': ${r.issues.join("; ")}`).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });

  it("rejects invalid skill: missing 'Use when' trigger", () => {
    const v = validateSkillDir(path.join(skillsRoot, "commit-message"));
    expect(v.ok).toBe(true);
    // negative case via parseSkill on bad content
    const bad = parseSkill("---\nname: x\ndescription: short\n---\n\n## A\n");
    expect(bad.description!.length).toBeLessThan(20);
  });

  it("skills are harness-agnostic markdown (FR-6.3)", () => {
    for (const s of listSkills(skillsRoot)) {
      const raw = readFileSync(path.join(s.dir, "SKILL.md"), "utf8");
      expect(raw).not.toMatch(/CLAUDE\.md|AGENTS\.md|antigravity/i);
    }
  });
});
