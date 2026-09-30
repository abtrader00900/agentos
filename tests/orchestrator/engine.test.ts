import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { makeRepo, sh } from "./helpers.js";
import { startRun, resumeRun, type EngineDeps } from "../../src/orchestrator/engine.js";
import { requestCancel } from "../../src/orchestrator/run.js";
import { statusOf } from "../../src/orchestrator/workspace.js";
import { orchestratorSchema } from "../../src/core/schema.js";
import type { Runner, RunnerResult } from "../../src/orchestrator/types.js";

let repo: ReturnType<typeof makeRepo>;
beforeEach(() => { repo = makeRepo(); });
afterEach(() => repo.cleanup());

const reply = (text = "done"): RunnerResult => ({ ok: true, output: JSON.stringify({ type: "result", result: text }) + "\n", rateLimited: false, timedOut: false });
const LIMIT: RunnerResult = { ok: false, output: "rate limit reached\n", rateLimited: true, timedOut: false };
const cfg = (over: Record<string, unknown> = {}) => orchestratorSchema.parse({ link: [], ...over });
const sub = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, title: id, prompt: `create ${id}.txt`, files: [`${id}.txt`], dependsOn: [], agent: "claude", ...over });
const planOf = (...subtasks: object[]) => ({ summary: "test plan", subtasks });

type Work = (cwd: string, prompt: string) => void | RunnerResult | Promise<void | RunnerResult>;
function deps(f: { plan: object | (() => RunnerResult); work?: Work; review?: () => string }) {
  const read: Runner = async (req) =>
    req.prompt.includes("You are the planner")
      ? typeof f.plan === "function" ? (f.plan as () => RunnerResult)() : reply(JSON.stringify(f.plan))
      : reply(f.review ? f.review() : "[]");
  const write: Runner = async (req) => (await f.work?.(req.cwd, req.prompt)) ?? reply();
  const gh = vi.fn((_cwd: string, args: string[]) => (args[0] === "pr" ? "https://github.com/o/r/pull/7\n" : ""));
  const d: EngineDeps = { runners: { claude: { read, write }, codex: { read, write } }, gh, freeMemMb: () => 1e6 };
  return Object.assign(d, { gh });
}
/** a worker that creates the file its subtask prompt names */
const creates: Work = (cwd, prompt) => {
  const m = /create (\S+\.txt)/.exec(prompt);
  if (m) writeFileSync(path.join(cwd, m[1]), m[1]);
};
const prCalls = (d: ReturnType<typeof deps>) => d.gh.mock.calls.filter((c) => c[1][0] === "pr");

describe("orchestrator engine", { timeout: 60_000 }, () => {
  it("runs two subtasks in parallel and opens one PR with both", async () => {
    const d = deps({ plan: planOf(sub("a"), sub("b", { agent: "codex" })), work: creates });
    const s = await startRun(repo.root, "add a and b", cfg(), d, "t1");
    expect(s.status).toBe("pr_open");
    expect(s.prUrl).toBe("https://github.com/o/r/pull/7");
    const files = sh(repo.remote, ["ls-tree", "--name-only", "agentos/run-t1"]);
    expect(files).toContain("a.txt");
    expect(files).toContain("b.txt");
    const args = prCalls(d)[0][1] as string[];
    expect(args.slice(0, 6)).toEqual(["pr", "create", "--base", "main", "--head", "agentos/run-t1"]);
    expect(args[args.indexOf("--body") + 1]).toContain("add a and b");
    expect(statusOf(repo.root)).toBe("");
    expect(existsSync(s.runWorktree)).toBe(false);
    expect(sh(repo.root, ["branch", "--show-current"])).toBe("main");
  });

  it("starts a dependent subtask from its dependency's code", async () => {
    let sawA = false;
    const d = deps({
      plan: planOf(sub("a"), sub("b", { dependsOn: ["a"] })),
      work: (cwd, p) => { if (p.includes("create b.txt")) sawA = existsSync(path.join(cwd, "a.txt")); creates(cwd, p); },
    });
    expect((await startRun(repo.root, "chain", cfg(), d)).status).toBe("pr_open");
    expect(sawA).toBe(true);
  });

  it("fixes failing verify commands, then opens the PR", async () => {
    const verify = [`node -e "process.exit(require('fs').existsSync('fixed.txt') ? 0 : 1)"`];
    const d = deps({ plan: planOf(sub("a")), work: (cwd, p) => (p.includes("does not pass yet") ? writeFileSync(path.join(cwd, "fixed.txt"), "ok") : creates(cwd, p)) });
    const s = await startRun(repo.root, "needs a fix", cfg({ verify }), d);
    expect(s.status).toBe("pr_open");
    expect(s.fixRound).toBe(1);
  });

  it("stops at maxFixRounds without opening a PR", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates });
    const s = await startRun(repo.root, "never passes", cfg({ verify: [`node -e "process.exit(1)"`], maxFixRounds: 1 }), d);
    expect(s.status).toBe("needs_human");
    expect(s.fixRound).toBe(1);
    expect(s.reason).toContain("verify commands fail");
    expect(prCalls(d)).toHaveLength(0);
  });

  it("sends blocking review findings to a fixer", async () => {
    const reviews = [JSON.stringify([{ severity: "high", file: "a.txt", line: 1, issue: "a.txt must say hello" }]), "[]"];
    let fixPrompt = "";
    const d = deps({
      plan: planOf(sub("a")),
      review: () => reviews.shift() ?? "[]",
      work: (cwd, p) => {
        if (!p.includes("does not pass yet")) return creates(cwd, p);
        fixPrompt = p;
        writeFileSync(path.join(cwd, "a.txt"), "hello");
      },
    });
    const s = await startRun(repo.root, "reviewed", cfg(), d);
    expect(s.status).toBe("pr_open");
    expect(s.fixRound).toBe(1);
    expect(fixPrompt).toContain("a.txt must say hello");
  });

  it("resolves a merge conflict between subtasks with a fixer", async () => {
    // the planner promised different files, but both parallel workers write shared.txt
    // (both start from the same base, so the second merge conflicts)
    const d = deps({
      plan: planOf(sub("a"), sub("b")),
      work: (cwd, p) => {
        if (p.includes("stopped with conflicts")) return writeFileSync(path.join(cwd, "shared.txt"), "a and b\n");
        writeFileSync(path.join(cwd, "shared.txt"), `${p.includes("create a.txt") ? "a" : "b"}\n`);
      },
    });
    const s = await startRun(repo.root, "conflict", cfg(), d);
    expect(s.status).toBe("pr_open");
    expect(sh(repo.remote, ["show", `${s.branch}:shared.txt`])).toBe("a and b");
  });

  it("blocks the PR when the diff adds a secret", async () => {
    const fakeKey = "AKIA" + "Q".repeat(16); // built at runtime: this file holds no key-shaped string
    const d = deps({ plan: planOf(sub("a")), work: (cwd) => writeFileSync(path.join(cwd, "a.txt"), `key=${fakeKey}\n`) });
    const s = await startRun(repo.root, "leaky", cfg(), d);
    expect(s.status).toBe("needs_human");
    expect(s.reason).toContain("secret scan");
    expect(prCalls(d)).toHaveLength(0);
    expect(sh(repo.remote, ["branch", "--list", s.branch])).toBe("");
  });

  it("fails the run when an agent writes into the main checkout", async () => {
    const d = deps({ plan: planOf(sub("a")), work: (cwd, p) => { creates(cwd, p); writeFileSync(path.join(repo.root, "evil.txt"), "x"); } });
    const s = await startRun(repo.root, "escape", cfg(), d);
    expect(s.status).toBe("failed");
    expect(s.reason).toContain("outside its worktree");
  });

  it("pauses on a worker rate limit and resumes without redoing finished subtasks", async () => {
    let aCalls = 0;
    let bCalls = 0;
    const d = deps({
      plan: planOf(sub("a"), sub("b")),
      work: (cwd, p) => {
        if (p.includes("create b.txt") && ++bCalls === 1) return LIMIT;
        if (p.includes("create a.txt")) aCalls++;
        creates(cwd, p);
      },
    });
    const c = cfg({ maxWorkers: 1 });
    const paused = await startRun(repo.root, "limited", c, d, "t9");
    expect(paused.status).toBe("paused");
    expect(paused.resumeFrom).toBe("working");
    const s = await resumeRun(repo.root, "t9", c, d);
    expect(s.status).toBe("pr_open");
    expect(aCalls).toBe(1);
    expect(bCalls).toBe(2);
  });

  it("pauses when the planner hits a limit", async () => {
    const replies = [LIMIT, reply(JSON.stringify(planOf(sub("a"))))];
    const d = deps({ plan: () => replies.shift()!, work: creates });
    expect((await startRun(repo.root, "later", cfg(), d, "t10")).status).toBe("paused");
    expect((await resumeRun(repo.root, "t10", cfg(), d)).status).toBe("pr_open");
  });

  it("records a cancel request as cancelled", async () => {
    const d = deps({ plan: planOf(sub("a")), work: (cwd, p) => { requestCancel(repo.root, "t11"); creates(cwd, p); } });
    const s = await startRun(repo.root, "cancel me", cfg(), d, "t11");
    expect(s.status).toBe("cancelled");
    expect(prCalls(d)).toHaveLength(0);
  });

  it("merges a base branch that moved during the run before opening the PR", async () => {
    const d = deps({
      plan: planOf(sub("a")),
      work: (cwd, p) => {
        creates(cwd, p);
        const other = path.join(repo.tmp, "other");
        if (existsSync(other)) return;
        sh(repo.tmp, ["clone", "-q", repo.remote, other]);
        writeFileSync(path.join(other, "o.txt"), "o");
        sh(other, ["add", "-A"]);
        sh(other, ["commit", "-qm", "moved"]);
        sh(other, ["push", "-q", "origin", "main"]);
      },
    });
    const s = await startRun(repo.root, "moving base", cfg(), d);
    expect(s.status).toBe("pr_open");
    const files = sh(repo.remote, ["ls-tree", "--name-only", s.branch]);
    expect(files).toContain("o.txt");
    expect(files).toContain("a.txt");
  });

  it("refuses to start on a dirty checkout", async () => {
    writeFileSync(path.join(repo.root, "wip.txt"), "x");
    await expect(startRun(repo.root, "t", cfg(), deps({ plan: planOf(sub("a")) }))).rejects.toThrow(/uncommitted changes/);
  });

  it("hands an unusable plan to a human after one retry", async () => {
    const s = await startRun(repo.root, "vague", cfg(), deps({ plan: () => reply("I cannot plan this"), work: creates }));
    expect(s.status).toBe("needs_human");
    expect(s.reason).toContain("planner:");
  });
});
