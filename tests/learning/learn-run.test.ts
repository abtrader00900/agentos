// tests/learning/learn-run.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { makeRepo, sh } from "../orchestrator/helpers.js";
import { startRun, type EngineDeps } from "../../src/orchestrator/engine.js";
import { loadRun, saveRun, type RunState } from "../../src/orchestrator/run.js";
import { learnFromRun } from "../../src/learning/learn-run.js";
import { listLessons, saveLessons } from "../../src/learning/lessons.js";
import { orchestratorSchema, learningSchema } from "../../src/core/schema.js";
import { readEvents } from "../../src/learning/evidence.js";
import { draftsDir } from "../../src/learning/skilldraft.js";
import { LESSONS_HEADER } from "../../src/learning/inject.js";
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

  it("chained: run 1's auto lesson reaches run 2's planner prompt and is listed in its PR body", async () => {
    const LESSON = "Create fixed.txt whenever the verify command checks for it";
    const d1 = deps((p) => reply(JSON.stringify({ kind: "file-add", lessons: [{ text: LESSON, roles: ["planner", "worker"], evidence: [p.includes("E1:") ? "E1" : "E0"] }] })), {}, true);
    expect((await startRun(repo.root, "create a", orchestratorSchema.parse({ link: [], verify }), d1, "ch1")).status).toBe("pr_open");
    const [l] = listLessons(repo.root);
    expect(l.meta).toMatchObject({ status: "auto", runs: ["ch1"] });

    const planPrompts: string[] = [];
    const base = deps(() => reply(JSON.stringify({ kind: "file-add", lessons: [] })));
    const read: Runner = async (req) => {
      if (req.prompt.includes("You are the planner")) planPrompts.push(req.prompt);
      return base.runners.claude.read(req);
    };
    const d2 = { ...base, runners: { claude: { read, write: base.runners.claude.write }, codex: base.runners.codex } };
    const s2 = await startRun(repo.root, "create a file again", orchestratorSchema.parse({ link: [] }), d2, "ch2");
    expect(s2.status).toBe("pr_open");
    expect(planPrompts[0]).toContain(`${LESSONS_HEADER}\n- ${LESSON}`);
    const args = vi.mocked(d2.gh).mock.calls.map((c) => c[1]).find((a) => a[0] === "pr")!;
    expect(args[args.indexOf("--body") + 1]).toContain(l.key);
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

  it("cleans up the run's worktrees and subtask branches before the retrospective, and reports learning start and end", async () => {
    let seen: { run: boolean; sub: boolean; branches: string } | undefined;
    const learning: Array<string | undefined> = [];
    const d = deps(() => {
      const s = loadRun(repo.root, "lr10");
      seen = { run: existsSync(s.runWorktree), sub: existsSync(s.subtasks[0].worktree), branches: sh(repo.root, ["branch", "--list", "agentos/run-lr10-*"]) };
      return reply(JSON.stringify({ kind: "file-add", lessons: [] }));
    }, { onLearning: (r) => learning.push(r) });
    const s = await startRun(repo.root, "create a", orchestratorSchema.parse({ link: [] }), d, "lr10");
    expect(s.status).toBe("pr_open");
    expect(seen).toEqual({ run: false, sub: false, branches: "" });
    expect(learning).toEqual([undefined, "done"]);
  });

  it("skips the retrospective when the project's agents allowlist bars the retroAgent", async () => {
    let claudeCalls = 0;
    const d = deps(() => reply(JSON.stringify({ kind: "file-add", lessons: [] })));
    const claude = d.runners.claude!;
    d.runners.claude = {
      read: async (r) => { claudeCalls++; return claude.read(r); },
      write: async (r) => { claudeCalls++; return claude.write(r); },
    };
    // retroAgent defaults to claude; this project allows only codex, so the run's evidence never reaches claude
    const c = orchestratorSchema.parse({ link: [], planner: "codex", workers: ["codex"], reviewer: "codex", agents: ["codex"] });
    const s = await startRun(repo.root, "create a", c, d, "la1");
    expect(s.status).toBe("pr_open");
    expect(claudeCalls).toBe(0);
    expect(loadRun(repo.root, "la1").learned).toBe("skipped");
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

describe("learnFromRun inputs", () => {
  const runOf = (id: string, kind: string | undefined, minute: number): RunState =>
    ({ id, task: "t", status: "pr_open", kind, baseBranch: "main", base: "x", branch: `agentos/run-${id}`, runWorktree: "/w", createdAt: `2026-09-30T10:${String(minute).padStart(2, "0")}:00.000Z`, updatedAt: "", subtasks: [], fixRound: 0, findings: [] });
  const runners = (read: Runner) => ({ claude: { read, write: read }, codex: { read, write: read } });

  it("the retro prompt carries only auto/approved lessons and the kinds earlier runs got, most recent first", async () => {
    saveLessons(repo.root, "r0", "k", [
      { text: "Run the migration before the seed step", roles: ["worker"], evidence: ["E1: verify_fixed: x"] },
      { text: "Maybe split views into their own subtask", roles: ["planner"], evidence: [] },
    ]);
    saveRun(repo.root, runOf("old-a", "erp-report", 1));
    saveRun(repo.root, runOf("old-b", "bug-fix", 2));
    saveRun(repo.root, runOf("old-c", "erp-report", 3));
    saveRun(repo.root, runOf("cur", undefined, 4));
    let prompt = "";
    const read: Runner = async (req) => { prompt = req.prompt; return reply(JSON.stringify({ kind: "misc", lessons: [] })); };
    expect(await learnFromRun(repo.root, "cur", learningSchema.parse({}), runners(read), 1000)).toBe("done");
    expect(prompt).toContain("Run the migration before the seed step");
    expect(prompt).not.toContain("Maybe split views"); // pending text never reaches a prompt
    expect(prompt).toContain("Kinds this project already uses (reuse one when it fits): erp-report, bug-fix\n");
  });

  it("one learning budget: the retro retry and the draft get only the time left", async () => {
    saveRun(repo.root, runOf("prev1", "file-add", 5)); // skillAfterRuns is at least 2
    saveRun(repo.root, runOf("b1", undefined, 6));
    let clock = 0;
    const timeouts: Array<[string, number]> = [];
    const retro = [reply("not json"), reply(JSON.stringify({ kind: "file-add", lessons: [] }))];
    const read: Runner = async (req) => {
      const draft = req.prompt.includes("Write a SKILL.md");
      timeouts.push([draft ? "draft" : "retro", req.timeoutMs]);
      clock += 4 * 60_000; // each call takes 4 minutes
      return draft ? reply(SKILL) : retro.shift()!;
    };
    expect(await learnFromRun(repo.root, "b1", learningSchema.parse({ skillAfterRuns: 2 }), runners(read), 10 * 60_000, () => clock)).toBe("done");
    expect(timeouts).toEqual([["retro", 600_000], ["retro", 360_000], ["draft", 120_000]]);
    expect(loadRun(repo.root, "b1").draft).toBe("file-add");
  });

  it("skips the draft when less than a minute of the learning budget is left", async () => {
    saveRun(repo.root, runOf("prev2", "file-add", 5));
    saveRun(repo.root, runOf("b2", undefined, 7));
    let clock = 0;
    const calls: string[] = [];
    const read: Runner = async (req) => {
      calls.push(req.prompt.includes("Write a SKILL.md") ? "draft" : "retro");
      clock += 9.5 * 60_000;
      return reply(JSON.stringify({ kind: "file-add", lessons: [] }));
    };
    expect(await learnFromRun(repo.root, "b2", learningSchema.parse({ skillAfterRuns: 2 }), runners(read), 10 * 60_000, () => clock)).toBe("done");
    expect(calls).toEqual(["retro"]);
    expect(readEvents(repo.root, "b2").some((e) => e.type === "skill-draft-rejected" && e.reason === "no time left for the draft")).toBe(true);
    expect(existsSync(path.join(draftsDir(repo.root), "file-add"))).toBe(false); // no tombstone: a later run may still draft it
  });

  it("the learn-failed reason masks a pattern secret", async () => {
    const token = "gh" + "p_" + "B".repeat(36);
    saveRun(repo.root, runOf("boom2", undefined, 8));
    const read: Runner = async () => { throw new Error(`bad token ${token}`); };
    expect(await learnFromRun(repo.root, "boom2", learningSchema.parse({}), runners(read), 1000)).toBe("failed");
    expect(readEvents(repo.root, "boom2").find((e) => e.type === "learn-failed")!.reason).toBe("bad token ***");
  });

  it("the learn-failed reason is redacted and capped at 300 chars", async () => {
    const secret = "s3cr3t-value-123456";
    process.env.AGENTOS_TEST_TOKEN = secret;
    try {
      saveRun(repo.root, runOf("boom", undefined, 5));
      const read: Runner = async () => { throw new Error(`bad key ${secret} ${"x".repeat(1000)}`); };
      expect(await learnFromRun(repo.root, "boom", learningSchema.parse({}), runners(read), 1000)).toBe("failed");
      const ev = readEvents(repo.root, "boom").find((e) => e.type === "learn-failed")!;
      expect(ev.reason).toContain("***");
      expect(ev.reason).not.toContain(secret);
      expect((ev.reason as string).length).toBeLessThanOrEqual(300);
    } finally {
      delete process.env.AGENTOS_TEST_TOKEN;
    }
  });
});
