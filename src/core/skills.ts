import { readFileSync, readdirSync, existsSync, cpSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

/**
 * FR-6.x: skills framework.
 * Skill format: SKILL.md (required) with YAML frontmatter (name, description),
 * optional scripts/, required test/ (validated via the skill linter).
 * Skills are harness-agnostic markdown consumed by any agent.
 */

export interface SkillMeta {
  name: string;
  description: string;
  dir: string;
}

export interface SkillValidation {
  skill: string;
  ok: boolean;
  issues: string[];
}

export function parseSkill(skillMd: string): { name?: string; description?: string; body: string } {
  // Accept CRLF: skills authored on Windows, and community skills pulled from
  // git by the registry, arrive with \r\n. An LF-only regex silently fails to
  // match, so every such skill parsed as "no frontmatter" and failed validation.
  const m = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { body: skillMd };
  const fm = parseYaml(m[1]) as Record<string, unknown>;
  return {
    name: typeof fm.name === "string" ? fm.name : undefined,
    description: typeof fm.description === "string" ? fm.description : undefined,
    body: m[2],
  };
}

export function validateSkillDir(skillDir: string): SkillValidation {
  const skillName = path.basename(skillDir);
  const issues: string[] = [];
  const skillMdPath = path.join(skillDir, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    return { skill: skillName, ok: false, issues: ["SKILL.md missing"] };
  }
  const raw = readFileSync(skillMdPath, "utf8");
  const meta = parseSkill(raw);

  if (!meta.name) issues.push("frontmatter 'name' missing");
  else if (meta.name !== skillName) issues.push(`frontmatter name '${meta.name}' != directory name '${skillName}'`);
  if (!meta.description) issues.push("frontmatter 'description' missing");
  else if (meta.description.length < 20) issues.push("description too short (<20 chars) — must tell the agent WHEN to use it");
  if (!/use when/i.test(meta.description ?? "")) {
    issues.push("description must contain a 'Use when' trigger so agents know when to apply the skill");
  }
  const headings = (meta.body.match(/^## /gm) ?? []).length;
  if (headings < 2) issues.push("body must have at least 2 '##' sections (e.g. Workflow, Rules)");
  if (/TODO|TBD|PLACEHOLDER/i.test(raw)) issues.push("contains TODO/TBD/PLACEHOLDER");
  if (!existsSync(path.join(skillDir, "test"))) {
    issues.push("test/ directory missing (FR-6.2)");
  }
  return { skill: skillName, ok: issues.length === 0, issues };
}

export function listSkills(skillsRoot: string): SkillMeta[] {
  if (!existsSync(skillsRoot)) return [];
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dir = path.join(skillsRoot, e.name);
      const md = path.join(dir, "SKILL.md");
      let description = "";
      try {
        description = parseSkill(readFileSync(md, "utf8")).description ?? "";
      } catch { /* leave empty */ }
      return { name: e.name, description, dir };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function testSkills(skillsRoot: string): SkillValidation[] {
  return listSkills(skillsRoot).map((s) => validateSkillDir(s.dir));
}

/** FR-6.4: install a bundled skill into a project's .agentos/skills/ */
export function installSkill(bundledRoot: string, projectDir: string, name: string): void {
  const src = path.join(bundledRoot, name);
  if (!existsSync(src)) throw new Error(`Skill '${name}' not found in ${bundledRoot}`);
  const check = validateSkillDir(src);
  if (!check.ok) {
    throw new Error(`Skill '${name}' is invalid:\n  - ${check.issues.join("\n  - ")}`);
  }
  const dst = path.join(projectDir, ".agentos", "skills", name);
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
}

export function bundledSkillsRoot(): string {
  // works from src/ (tsx) and dist/ alike; import.meta.dirname would need Node >= 20.11
  return fileURLToPath(new URL("../../skills", import.meta.url));
}
