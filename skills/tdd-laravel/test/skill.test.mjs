// FR-6.2: every skill must have an automated test.
// Skill tests verify the SKILL.md structure + required content contracts.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";

const skillDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";

describe("skill: tdd-laravel", () => {
  const skillPath = path.join(skillDir, "SKILL.md");

  it("SKILL.md exists", () => {
    expect(existsSync(skillPath)).toBe(true);
  });

  it("has valid frontmatter with name + description", () => {
    const raw = readFileSync(skillPath, "utf8");
    expect(raw).toMatch(/^---\r?\n/);
    const fm = raw.split("---")[1];
    expect(fm).toMatch(/name:\s*tdd-laravel/);
    expect(fm).toMatch(/description:\s*\S/);
  });

  it("declares a TDD workflow", () => {
    const body = readFileSync(skillPath, "utf8").split("---").slice(2).join("---");
    expect(body).toMatch(/Red/);
    expect(body).toMatch(/Green/);
    expect(body).toMatch(/Refactor/);
  });

  it("mentions running the test suite", () => {
    const body = readFileSync(skillPath, "utf8");
    expect(body).toMatch(/php artisan test/);
  });
});
