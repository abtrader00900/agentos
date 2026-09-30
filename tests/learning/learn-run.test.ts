// tests/learning/learn-run.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { makeRepo } from "../orchestrator/helpers.js";
import { startRun, type EngineDeps } from "../../src/orchestrator/engine.js";
import { loadRun } from "../../src/orchestrator/run.js";
import { orchestratorSchema, learningSchema } from "../../src/core/schema.js";
import { readEvents } from "../../src/learning/evidence.js";
import { listLessons } from "../../src/learning/lessons.js";
import { draftsDir } from "../../src/learning/skilldraft.js";
import type { Runner, RunnerResult } from "../../src/orchestrator/types.js";

let repo: ReturnType<typeof makeRepo>;
beforeEach(() => { repo = makeRepo(); });
afterEach(() => repo.cleanup());

const reply = (text = "done"): RunnerResult => ({ ok: true, output: JSON.stringify({ type: "result", result: text }) + "\n", rateLimited: false, timedOut: false });
const plan = { summary: "p", subtasks: [{ id: "a", title: "a", prompt: "create a.txt", files: ["a.txt"], dependsOn: [], agent: "claude" }] };
const SKILL = "---\nname: file-add\ndescription: Add a small file with a test. Use when a task adds one new file.\n---\n\n## Workflow\n- add it\n\n## Rules\n- keep it small\n";

function deps(retro: (prompt: string) => RunnerResult, over: Partial<EngineDeps> = {}, fixNeeded = false): EngineDeps {
  const read: Runner = async (req) => {
    if (req.prompt.includes("You are the planner")) return reply(JSON.stringify(plan));
    if (req.prompt.includes("You write the retrospective")) return retro(req.prompt);
    if (req.prompt.includes("Write a SKILL.md")) return reply(SKILL);
    return reply("[]");
  };
  const write: Runner = async (req) => {
    writeFileSync(path.join(req.cwd, "a.txt"), "a\n");
    if (fixNeeded && req.prompt.includes("does not pass yet")) writeFileSync(path.join(req.cwd, "fixed.txt"), "ok");
    return reply();
  };
  return { runners: { claude: { read, write }, codex: { read, write } }, gh: vi.fn((_c: string, a: string[]) => (a[0] === "pr" ? "https://x/pull/1\n" : "")), freeMemMb: () => 1e6, learning: learningSchema.parse({ skillAfterRuns: 2 }), ...over };
}
const verify = [`node -e "process.exit(require('fs').existsSync('fixed.txt') ? 0 : 1)"`];

describe("learning after a run", { timeout: 90_000 }, () => {
  it("a run with a fix round stores an auto lesson citing its evidence", async () => {
    const d = deps((p) => reply(JSON.stringify({ kind: "file-add", lessons: [{ text: "Create fixed.txt whenever the verify command checks for it", roles: ["worker"], evidence: [p.includes("E1:") ? "E1" : "E0"] }] })), {}, true);
    const s = await startRun(repo.root, "create a", orchestratorSchema.parse({ link: [], verify }), d, "lr1");
    expect(s.status).toBe("pr_open");
    expect(loadRun(repo.root, "lr1")).toMatchObject({ learned: "done", kind: "file-add" });
    const [l] = listLessons(repo.root);
    expect(l.meta).toMatchObject({ status: "auto", kind: "file-add", runs: ["lr1"] });
    expect(l.meta.evidence[0]).toMatch(/^E1: verify_fixed/);
  });

  it("a learning failure never changes the run's status", async () => {
    const d = deps(() => { throw new Error("retro exploded"); });
    const s = await startRun(repo.root, "create a", orchestratorSchema.parse({ link: [] }), d, "lr2");
    expect(s.status).toBe("pr_open");
    expect(loadRun(repo.root, "lr2").learned).toBe("failed");
    expect(readEvents(repo.root, "lr2").some((e) => e.type === "learn-failed" && e.reason === "retro exploded")).toBe(true);
  });

  it("retro: false skips learning", async () => {
    const d = deps(() => reply("{}"), { learning: learningSchema.parse({ retro: false }) });
    await startRun(repo.root, "create a", orchestratorSchema.parse({ link: [] }), d, "lr3");
    expect(loadRun(repo.root, "lr3").learned).toBe("skipped");
  });

  it("drafts a skill once the kind has skillAfterRuns successes, and says so on the run", async () => {
    const d = deps(() => reply(JSON.stringify({ kind: "file-add", lessons: [] })));
    await startRun(repo.root, "create a", orchestratorSchema.parse({ link: [] }), d, "lr4");
    expect(existsSync(path.join(draftsDir(repo.root), "file-add"))).toBe(false);
    const s = await startRun(repo.root, "create a again", orchestratorSchema.parse({ link: [] }), d, "lr5");
    expect(s.draft).toBe("file-add");
    expect(existsSync(path.join(draftsDir(repo.root), "file-add", "SKILL.md"))).toBe(true);
  });

  it("a draft agent that throws leaves the run learned: done and logs skill-draft-rejected", async () => {
    let skillCalls = 0;
    const base = deps(() => reply(JSON.stringify({ kind: "file-add", lessons: [] })));
    const read: Runner = async (req) => {
      if (req.prompt.includes("Write a SKILL.md")) { skillCalls++; throw new Error("draft exploded"); }
      return base.runners.claude.read(req);
    };
    const d = { ...base, runners: { claude: { read, write: base.runners.claude.write }, codex: base.runners.codex } };
    await startRun(repo.root, "create a", orchestratorSchema.parse({ link: [] }), d, "lr6");
    const s = await startRun(repo.root, "create a again", orchestratorSchema.parse({ link: [] }), d, "lr7");
    expect(s.status).toBe("pr_open");
    expect(skillCalls).toBe(1);
    expect(loadRun(repo.root, "lr7").learned).toBe("done");
    expect(readEvents(repo.root, "lr7").some((e) => e.type === "skill-draft-rejected" && e.reason === "draft exploded")).toBe(true);
    expect(existsSync(path.join(draftsDir(repo.root), "file-add"))).toBe(false);
  });

  it("a needs_human run still learns, but never drafts a skill", async () => {
    const d = deps(() => reply(JSON.stringify({ kind: "file-add", lessons: [] })), { learning: learningSchema.parse({ skillAfterRuns: 2 }) });
    await startRun(repo.root, "create a", orchestratorSchema.parse({ link: [] }), d, "lr8");
    const s = await startRun(repo.root, "create a but fail", orchestratorSchema.parse({ link: [], verify: [`node -e "process.exit(1)"`], maxFixRounds: 0 }), d, "lr9");
    expect(s.status).toBe("needs_human");
    expect(loadRun(repo.root, "lr9")).toMatchObject({ status: "needs_human", learned: "done", kind: "file-add" });
    expect(loadRun(repo.root, "lr9").draft).toBeUndefined();
    expect(existsSync(path.join(draftsDir(repo.root), "file-add"))).toBe(false);
  });
});
