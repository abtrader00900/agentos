// src/learning/skilldraft.ts
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import { listRuns, type RunState } from "../orchestrator/run.js";
import { validateSkillDir, parseSkill } from "../core/skills.js";
import { installSkillsFromDir } from "../core/registry.js";
import { ensureExcluded } from "../orchestrator/workspace.js";
import { finalText } from "../orchestrator/runners.js";
import type { Runner } from "../orchestrator/types.js";
import { listLessons, safetyCheck } from "./lessons.js";

const KIND = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const draftsDir = (root: string) => path.join(root, ".agentos", "skill-drafts");

// the same contract test the bundled skills ship with, so a draft validates like any skill
const SKILL_TEST = `// skill contract test — structure + frontmatter validity (written by agentos for a skill draft)
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillName = path.basename(skillDir);

describe(\`skill contract: \${skillName}\`, () => {
  const skillPath = path.join(skillDir, "SKILL.md");
  it("SKILL.md exists", () => expect(existsSync(skillPath)).toBe(true));
  it("frontmatter: name matches directory, description has 'Use when'", () => {
    const fm = readFileSync(skillPath, "utf8").split("---")[1] ?? "";
    expect(fm).toContain(\`name: \${skillName}\`);
    expect(fm).toMatch(/Use when/i);
  });
});
`;

/** the kind's successful runs when a skill should be drafted now, else null */
export function skillDue(root: string, kind: string, after: number): RunState[] | null {
  if (!KIND.test(kind)) return null;
  if (existsSync(path.join(root, ".agentos", "skills", kind)) || existsSync(path.join(draftsDir(root), kind))) return null;
  const runs = listRuns(root).filter((r) => r.kind === kind && r.status === "pr_open");
  return runs.length >= after ? runs.slice(0, 5) : null;
}

function skillPrompt(kind: string, runs: RunState[], lessons: string[]): string {
  return [
    `Write a SKILL.md for coding agents working in this project on tasks of kind "${kind}". Do not edit any files.`,
    `Successful runs of this kind:\n${runs.map((r) => `- Task: ${r.task}\n  Plan: ${r.plan?.summary ?? ""}\n  Files: ${[...new Set((r.plan?.subtasks ?? []).flatMap((s) => s.files))].join(", ")}`).join("\n")}`,
    lessons.length ? `Lessons learned on these tasks:\n${lessons.map((l) => `- ${l}`).join("\n")}` : "",
    [
      `Format: YAML frontmatter with "name: ${kind}" and a "description" that contains "Use when …",`,
      "then a body with at least two '## ' sections (for example ## Workflow and ## Rules).",
      "Be specific to this project. No URLs, no commands to download or pipe into a shell, no secrets, no TODO/TBD.",
    ].join("\n"),
    "Reply with ONLY the SKILL.md content.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Ask the agent for a draft, then keep it only if it validates and passes the safety filter. Never installs. */
export async function draftSkill(root: string, kind: string, runs: RunState[], runner: Runner, timeoutMs: number): Promise<{ ok: boolean; reason?: string }> {
  if (!KIND.test(kind)) return { ok: false, reason: `invalid kind "${kind}"` };
  const lessons = listLessons(root, { status: ["auto", "approved"] }).filter((l) => l.meta.kind === kind).map((l) => l.text);
  const res = await runner({ prompt: skillPrompt(kind, runs, lessons), cwd: root, timeoutMs });
  if (!res.ok) return { ok: false, reason: res.rateLimited ? "rate limit" : "the agent failed" };
  const md = finalText(res.output).trim().replace(/^```(?:markdown|md)?\s*\n/, "").replace(/\n```\s*$/, "");
  if (safetyCheck(md) !== "ok") return { ok: false, reason: "the draft failed the safety filter" };
  ensureExcluded(root, "/.agentos/skill-drafts/");
  const dir = path.join(draftsDir(root), kind);
  mkdirSync(path.join(dir, "test"), { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `${md}\n`);
  writeFileSync(path.join(dir, "test", "skill.test.mjs"), SKILL_TEST);
  const v = validateSkillDir(dir);
  if (!v.ok) {
    rmSync(dir, { recursive: true, force: true });
    return { ok: false, reason: v.issues.join("; ") };
  }
  return { ok: true };
}

export function listDrafts(root: string): Array<{ kind: string; description: string }> {
  if (!existsSync(draftsDir(root))) return [];
  return readdirSync(draftsDir(root))
    .filter((k) => existsSync(path.join(draftsDir(root), k, "SKILL.md")))
    .map((kind) => ({ kind, description: parseSkill(readFileSync(path.join(draftsDir(root), kind, "SKILL.md"), "utf8")).description ?? "" }));
}

/** Install a draft as a project skill (the owner's approval) and remove the draft. Returns the installed SKILL.md. */
export function approveDraft(root: string, kind: string): string {
  const file = path.join(draftsDir(root), kind, "SKILL.md");
  if (!KIND.test(kind) || !existsSync(file)) throw new Error(`No skill draft "${kind}" — see: agentos skill drafts`);
  const text = readFileSync(file, "utf8");
  installSkillsFromDir(draftsDir(root), root, "skill drafts", kind);
  rmSync(path.join(draftsDir(root), kind), { recursive: true, force: true });
  return text;
}

export function rejectDraft(root: string, kind: string): boolean {
  const dir = path.join(draftsDir(root), kind);
  if (!KIND.test(kind) || !existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
