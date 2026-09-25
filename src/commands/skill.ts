import { existsSync } from "node:fs";
import path from "node:path";
import { listSkills, testSkills, installSkill, bundledSkillsRoot } from "../core/skills.js";

/** FR-2.6: agentos skill list / install / test */

export function skillList(options: { cwd?: string } = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const bundled = listSkills(bundledSkillsRoot());
  const installedRoot = path.join(cwd, ".agentos", "skills");
  const installed = existsSync(installedRoot) ? new Set(listSkills(installedRoot).map((s) => s.name)) : new Set<string>();

  const lines = ["Bundled skills:", ""];
  for (const s of bundled) {
    const mark = installed.has(s.name) ? "✓ installed" : " ";
    lines.push(`  ${mark} ${s.name}`);
    lines.push(`      ${s.description.slice(0, 90)}`);
  }
  const out = lines.join("\n");
  console.log(out);
  return out;
}

export function skillInstall(name: string, options: { cwd?: string } = {}): void {
  const cwd = options.cwd ?? process.cwd();
  installSkill(bundledSkillsRoot(), cwd, name);
  console.log(`✓ Installed skill '${name}' → .agentos/skills/${name}`);
}

export function skillTest(options: { cwd?: string } = {}): void {
  const cwd = options.cwd ?? process.cwd();
  // test bundled skills, or project-installed ones if no bundled skills found
  let root = bundledSkillsRoot();
  if (!existsSync(root)) root = path.join(cwd, ".agentos", "skills");
  const results = testSkills(root);
  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      console.log(`  ✓ ${r.skill}`);
    } else {
      failed++;
      console.log(`  ✗ ${r.skill}`);
      for (const i of r.issues) console.log(`      - ${i}`);
    }
  }
  console.log(`\n${results.length - failed}/${results.length} skills valid`);
  if (failed) process.exit(1);
}
