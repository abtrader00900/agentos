// FR-6.2: skill contract test — structure + frontmatter validity.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillName = path.basename(skillDir);

describe(`skill contract: ${skillName}`, () => {
  const skillPath = path.join(skillDir, "SKILL.md");

  it("SKILL.md exists", () => {
    expect(existsSync(skillPath)).toBe(true);
  });

  it("frontmatter: name matches directory, description has 'Use when'", () => {
    const raw = readFileSync(skillPath, "utf8");
    const fm = raw.split("---")[1] ?? "";
    expect(fm).toContain(`name: ${skillName}`);
    expect(fm).toMatch(/description:\s*\S/);
    expect(fm).toMatch(/Use when/i);
  });

  it("body has at least 2 '##' sections", () => {
    const body = readFileSync(skillPath, "utf8").split("---").slice(2).join("---");
    expect((body.match(/^## /gm) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
