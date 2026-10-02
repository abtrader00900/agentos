import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { makeRepo } from "../orchestrator/helpers.js";
import { startRun, type EngineDeps } from "../../src/orchestrator/engine.js";
import { orchestratorSchema, learningSchema } from "../../src/core/schema.js";
import { saveLessons, listLessons } from "../../src/learning/lessons.js";
import { lessonsFor, LESSONS_HEADER } from "../../src/learning/inject.js";
import type { Runner, RunnerResult } from "../../src/orchestrator/types.js";

let repo: ReturnType<typeof makeRepo>;
beforeEach(() => { repo = makeRepo(); });
afterEach(() => repo.cleanup());

const reply = (text = "done"): RunnerResult => ({ ok: true, output: JSON.stringify({ type: "result", result: text }) + "\n", rateLimited: false, timedOut: false });
const EV = ["E1: verify_fixed: `npm test` failed"];
const plan = { summary: "p", subtasks: [{ id: "a", title: "a", prompt: "create a.txt", files: ["a.txt"], dependsOn: [], agent: "claude" }] };

describe("lesson injection", { timeout: 60_000 }, () => {
  it("lessonsFor returns auto/approved lessons for the role, most relevant first, and counts uses", () => {
    saveLessons(repo.root, "r1", undefined, [
      { text: "Report queries must eager load customers", roles: ["worker"], evidence: EV },
      { text: "Planner: include migrations for new report columns", roles: ["planner"], evidence: EV },
      { text: "Guess: reports are nicer in blue", roles: ["worker"], evidence: [] },
    ]);
    const r = lessonsFor(repo.root, "worker", "add a customer report", 5);
    expect(r.block.startsWith(LESSONS_HEADER)).toBe(true);
    expect(r.block).toContain("eager load customers");
    expect(r.block).not.toContain("migrations");
    expect(r.block).not.toContain("blue");
    expect(listLessons(repo.root).find((l) => l.text.includes("eager"))?.meta.uses).toBe(1);
    expect(lessonsFor(repo.root, "worker", "x", 0)).toEqual({ block: "", keys: [] });
  });

  it("leaves out lessons that share no meaningful word with the task", () => {
    saveLessons(repo.root, "r2", undefined, [
      { text: "Run php artisan migrate --pretend before a database migration", roles: ["worker"], evidence: EV },
      { text: "Keep CSS class names in kebab-case", roles: ["worker"], evidence: EV },
    ]);
    const r = lessonsFor(repo.root, "worker", "add a database migration for invoices", 5);
    expect(r.block).toContain("migration");
    expect(r.block).not.toContain("CSS");
  });

  it("puts lessons in the planner, worker and reviewer prompts, never pending ones, and lists them in the PR body", async () => {
    saveLessons(repo.root, "r0", undefined, [
      { text: "Always create files with a trailing newline", roles: ["planner", "worker", "reviewer", "fixer"], evidence: EV },
      { text: "Unproven idea about naming things carefully", roles: ["planner", "worker", "reviewer", "fixer"], evidence: [] },
    ]);
    const prompts: string[] = [];
    const read: Runner = async (req) => { prompts.push(req.prompt); return req.prompt.includes("You are the planner") ? reply(JSON.stringify(plan)) : reply("[]"); };
    const write: Runner = async (req) => { prompts.push(req.prompt); writeFileSync(path.join(req.cwd, "a.txt"), "a\n"); return reply(); };
    const gh = vi.fn((_c: string, a: string[]) => (a[0] === "pr" ? "https://x/pull/1\n" : ""));
    const deps: EngineDeps = { runners: { claude: { read, write }, codex: { read, write } }, gh, freeMemMb: () => 1e6, learning: learningSchema.parse({ retro: false }) };
    const s = await startRun(repo.root, "create a", orchestratorSchema.parse({ link: [] }), deps);
    expect(s.status).toBe("pr_open");
    const withNote = prompts.filter((p) => p.includes("trailing newline"));
    expect(withNote.length).toBe(3); // planner, worker, reviewer
    expect(prompts.some((p) => p.includes("Unproven idea"))).toBe(false);
    const body = gh.mock.calls.find((c) => c[1][0] === "pr")![1] as string[];
    expect(body[body.indexOf("--body") + 1]).toMatch(/Lessons used:.*L-[0-9a-f]{8}/);
  });

  it("without learning config the prompts are unchanged", async () => {
    saveLessons(repo.root, "r0", undefined, [{ text: "Always create files with a trailing newline", roles: ["worker"], evidence: EV }]);
    const prompts: string[] = [];
    const read: Runner = async (req) => (req.prompt.includes("You are the planner") ? reply(JSON.stringify(plan)) : reply("[]"));
    const write: Runner = async (req) => { prompts.push(req.prompt); writeFileSync(path.join(req.cwd, "a.txt"), "a\n"); return reply(); };
    const deps: EngineDeps = { runners: { claude: { read, write }, codex: { read, write } }, gh: () => "https://x/pull/1\n", freeMemMb: () => 1e6 };
    await startRun(repo.root, "create a", orchestratorSchema.parse({ link: [] }), deps);
    expect(prompts.some((p) => p.includes("trailing newline"))).toBe(false);
  });

  // pending lessons must never reach a prompt, not even through the planner's word-match "Project memory" recall
  it.each([["learning on", true], ["learning off", false]])("a pending lesson sharing a word with the task never reaches any prompt (%s)", async (_n, on) => {
    saveLessons(repo.root, "r0", undefined, [
      { text: "Unproven: create files in alphabetical order", roles: ["planner", "worker", "reviewer", "fixer"], evidence: [] },
    ]);
    expect(listLessons(repo.root)[0].meta.status).toBe("pending");
    const prompts: string[] = [];
    const read: Runner = async (req) => { prompts.push(req.prompt); return req.prompt.includes("You are the planner") ? reply(JSON.stringify(plan)) : reply("[]"); };
    const write: Runner = async (req) => { prompts.push(req.prompt); writeFileSync(path.join(req.cwd, "a.txt"), "a\n"); return reply(); };
    const deps: EngineDeps = {
      runners: { claude: { read, write }, codex: { read, write } }, gh: () => "https://x/pull/1\n", freeMemMb: () => 1e6,
      ...(on ? { learning: learningSchema.parse({ retro: false }) } : {}),
    };
    const s = await startRun(repo.root, "create a", orchestratorSchema.parse({ link: [] }), deps);
    expect(s.status).toBe("pr_open");
    expect(prompts.length).toBeGreaterThanOrEqual(3);
    expect(prompts.some((p) => p.includes("alphabetical"))).toBe(false);
  });
});
