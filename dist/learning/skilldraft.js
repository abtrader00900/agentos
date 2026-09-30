// src/learning/skilldraft.ts
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import { listRuns } from "../orchestrator/run.js";
import { validateSkillDir, parseSkill } from "../core/skills.js";
import { installSkillsFromDir } from "../core/registry.js";
import { ensureExcluded } from "../orchestrator/workspace.js";
import { finalText } from "../orchestrator/runners.js";
import { listLessons, safetyCheck } from "./lessons.js";
// kebab-case, and never a Windows device name (a directory called "con" cannot be created there)
const KIND = /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$)[a-z0-9][a-z0-9-]{1,39}$/;
export const draftsDir = (root) => path.join(root, ".agentos", "skill-drafts");
/** A rejected or failed draft leaves only this file behind, so skillDue never drafts the kind again (spec §8). */
function tombstone(root, kind, reason) {
    const dir = path.join(draftsDir(root), kind);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "rejected"), `${new Date().toISOString()} ${reason}\n`);
}
/** the kind's successful runs when a skill should be drafted now, else null */
export function skillDue(root, kind, after) {
    if (!KIND.test(kind))
        return null;
    if (existsSync(path.join(root, ".agentos", "skills", kind)) || existsSync(path.join(draftsDir(root), kind)))
        return null;
    const runs = listRuns(root).filter((r) => r.kind === kind && r.status === "pr_open");
    return runs.length >= after ? runs.slice(0, 5) : null;
}
function skillPrompt(kind, runs, lessons) {
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
export async function draftSkill(root, kind, runs, runner, timeoutMs) {
    if (!KIND.test(kind))
        return { ok: false, reason: `invalid kind "${kind}"` };
    const lessons = listLessons(root, { status: ["auto", "approved"] }).filter((l) => l.meta.kind === kind).map((l) => l.text);
    const res = await runner({ prompt: skillPrompt(kind, runs, lessons), cwd: root, timeoutMs });
    if (!res.ok)
        return { ok: false, reason: res.rateLimited ? "rate limit" : "the agent failed" };
    const md = finalText(res.output).trim().replace(/^```(?:markdown|md)?\s*\n/, "").replace(/\n```\s*$/, "");
    ensureExcluded(root, "/.agentos/skill-drafts/");
    if (safetyCheck(md) !== "ok") {
        tombstone(root, kind, "the draft failed the safety filter");
        return { ok: false, reason: "the draft failed the safety filter" };
    }
    const dir = path.join(draftsDir(root), kind);
    mkdirSync(path.join(dir, "test"), { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), `${md}\n`);
    const v = validateSkillDir(dir);
    if (!v.ok) {
        tombstone(root, kind, v.issues.join("; "));
        return { ok: false, reason: v.issues.join("; ") };
    }
    return { ok: true };
}
export function listDrafts(root) {
    if (!existsSync(draftsDir(root)))
        return [];
    return readdirSync(draftsDir(root))
        .filter((k) => existsSync(path.join(draftsDir(root), k, "SKILL.md")))
        .map((kind) => ({ kind, description: parseSkill(readFileSync(path.join(draftsDir(root), kind, "SKILL.md"), "utf8")).description ?? "" }));
}
/** The full SKILL.md of a draft; throws when there is none. */
export function readDraft(root, kind) {
    const file = path.join(draftsDir(root), kind, "SKILL.md");
    if (!KIND.test(kind) || !existsSync(file))
        throw new Error(`No skill draft "${kind}" — see: agentos skill drafts`);
    return readFileSync(file, "utf8");
}
/** Install a draft as a project skill (the owner's approval) and remove the draft. Returns the installed SKILL.md. */
export function approveDraft(root, kind) {
    const text = readDraft(root, kind);
    if (existsSync(path.join(root, ".agentos", "skills", kind))) {
        throw new Error(`a skill named ${kind} is already installed — remove it first or reject the draft`);
    }
    installSkillsFromDir(draftsDir(root), root, "skill drafts", kind);
    rmSync(path.join(draftsDir(root), kind), { recursive: true, force: true });
    return text;
}
export function rejectDraft(root, kind) {
    if (!KIND.test(kind) || !existsSync(path.join(draftsDir(root), kind, "SKILL.md")))
        return false;
    tombstone(root, kind, "rejected by the owner");
    return true;
}
//# sourceMappingURL=skilldraft.js.map