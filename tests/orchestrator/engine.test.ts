import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { makeRepo, sh } from "./helpers.js";
import { startRun, resumeRun, type EngineDeps } from "../../src/orchestrator/engine.js";
import { requestCancel, runDir, loadRun } from "../../src/orchestrator/run.js";
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
function deps(f: { plan: object | (() => RunnerResult); work?: Work; review?: (prompt: string, cwd: string) => string | RunnerResult | Promise<string | RunnerResult> }) {
  const reviewed = (r: string | RunnerResult) => (typeof r === "string" ? reply(r) : r);
  const read: Runner = async (req) =>
    req.prompt.includes("You are the planner")
      ? typeof f.plan === "function" ? (f.plan as () => RunnerResult)() : reply(JSON.stringify(f.plan))
      : reviewed(f.review ? await f.review(req.prompt, req.cwd) : "[]");
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

  it("commits the build commands' output into the pushed branch", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates });
    const build = [`node -e "require('fs').writeFileSync('built.txt','ok')"`];
    const s = await startRun(repo.root, "build before the PR", cfg({ build }), d);
    expect(s.status).toBe("pr_open");
    expect(sh(repo.remote, ["show", `${s.branch}:built.txt`])).toBe("ok");
  });

  it("stops at needs_human when a build command fails", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates });
    const build = [`node -e "console.error('boom'); process.exit(1)"`];
    const s = await startRun(repo.root, "build breaks", cfg({ build }), d);
    expect(s.status).toBe("needs_human");
    expect(s.reason).toContain("boom");
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

describe("orchestrator engine: review fixes", { timeout: 60_000 }, () => {
  const fakeKey = () => "AKIA" + "Q".repeat(16); // built at runtime: this file holds no key-shaped string
  const remoteHas = (branch: string) => sh(repo.remote, ["branch", "--list", branch]) !== "";

  it("blocks the PR when an earlier commit added a secret that a fixer removed later", async () => {
    const reviews = [JSON.stringify([{ severity: "high", file: "a.txt", line: 1, issue: "remove the hard-coded key" }]), "[]"];
    const d = deps({
      plan: planOf(sub("a")),
      review: () => reviews.shift() ?? "[]",
      work: (cwd, p) => writeFileSync(path.join(cwd, "a.txt"), p.includes("does not pass yet") ? "clean\n" : `key=${fakeKey()}\n`),
    });
    const s = await startRun(repo.root, "leaky history", cfg(), d);
    expect(s.fixRound).toBe(1); // the final diff is clean; only the history holds the key
    expect(s.status).toBe("needs_human");
    expect(s.reason).toContain("secret scan");
    expect(prCalls(d)).toHaveLength(0);
    expect(remoteHas(s.branch)).toBe(false);
  });

  it("blocks the PR when a conflict resolution added a secret that a later fix removed", async () => {
    const reviews = [JSON.stringify([{ severity: "high", file: "shared.txt", line: 1, issue: "remove the hard-coded key" }]), "[]"];
    const d = deps({
      plan: planOf(sub("a"), sub("b")),
      review: () => reviews.shift() ?? "[]",
      work: (cwd, p) => {
        const shared = path.join(cwd, "shared.txt");
        if (p.includes("stopped with conflicts")) return writeFileSync(shared, `a and b\nkey=${fakeKey()}\n`);
        if (p.includes("does not pass yet")) return writeFileSync(shared, "a and b\n");
        writeFileSync(shared, `${p.includes("create a.txt") ? "a" : "b"}\n`);
      },
    });
    const s = await startRun(repo.root, "leaky merge", cfg(), d);
    expect(s.fixRound).toBe(1); // the key lives only in the merge commit
    expect(s.status).toBe("needs_human");
    expect(s.reason).toContain("secret scan");
    expect(prCalls(d)).toHaveLength(0);
    expect(remoteHas(s.branch)).toBe(false);
  });

  it("pushes and opens the PR from the checkout, so a relative remote URL still resolves", async () => {
    sh(repo.root, ["remote", "set-url", "origin", "../remote.git"]); // relative to the checkout, not to a worktree
    const d = deps({ plan: planOf(sub("a")), work: creates });
    const s = await startRun(repo.root, "relative origin", cfg(), d);
    expect(s.status).toBe("pr_open");
    expect(sh(repo.remote, ["ls-tree", "--name-only", s.branch])).toContain("a.txt");
    expect(prCalls(d)[0][0]).toBe(repo.root);
  });

  it("treats an empty or malformed lock file as stale", async () => {
    const d = deps({ plan: () => LIMIT, work: creates });
    expect((await startRun(repo.root, "odd locks", cfg(), d, "lk2")).status).toBe("paused");
    const lock = path.join(runDir(repo.root, "lk2"), "lock");
    for (const junk of ["", "not-a-pid", "-5"]) {
      writeFileSync(lock, junk);
      expect((await resumeRun(repo.root, "lk2", cfg(), d)).status).toBe("paused");
      expect(existsSync(lock)).toBe(false);
    }
  });

  it("aborts a half-finished merge left by a dead engine instead of committing it on resume", async () => {
    let bCalls = 0;
    const d = deps({
      plan: planOf(sub("a"), sub("b")),
      work: (cwd, p) => {
        if (p.includes("stopped with conflicts")) return writeFileSync(path.join(cwd, "a.txt"), "resolved\n");
        if (p.includes("create b.txt") && ++bCalls === 1) return LIMIT;
        creates(cwd, p);
      },
    });
    const c = cfg({ maxWorkers: 1 });
    const paused = await startRun(repo.root, "crash mid-merge", c, d, "sm1");
    expect(paused.status).toBe("paused");
    // what a crash inside resolveConflicts leaves behind: a merge stopped on conflicts
    const stray = path.join(repo.tmp, "stray");
    sh(repo.root, ["worktree", "add", "-q", "-b", "stray", stray, paused.base]);
    writeFileSync(path.join(stray, "a.txt"), "stray\n");
    sh(stray, ["add", "-A"]);
    sh(stray, ["commit", "-qm", "stray"]);
    expect(() => sh(paused.runWorktree, ["merge", "stray"])).toThrow();
    const s = await resumeRun(repo.root, "sm1", c, d);
    expect(s.status).toBe("pr_open");
    expect(sh(repo.root, ["show", `${s.branch}:b.txt`])).toBe("b.txt");
    expect(sh(repo.root, ["show", `${s.branch}:a.txt`])).toBe("a.txt");
    expect(() => sh(repo.root, ["merge-base", "--is-ancestor", "stray", s.branch])).toThrow();
  });

  it("hands the run to a human when the reviewer fails, and pushes nothing", async () => {
    const failed: RunnerResult = { ok: false, output: "reviewer crashed\n", rateLimited: false, timedOut: false };
    const d = deps({ plan: planOf(sub("a")), work: creates, review: () => failed });
    const s = await startRun(repo.root, "unreviewed", cfg(), d);
    expect(s.status).toBe("needs_human");
    expect(s.reason).toContain("reviewer");
    expect(prCalls(d)).toHaveLength(0);
    expect(remoteHas(s.branch)).toBe(false);
  });

  it("does not push when a cancel arrives during the review", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates, review: () => { requestCancel(repo.root, "cr1"); return "[]"; } });
    const s = await startRun(repo.root, "cancel in review", cfg(), d, "cr1");
    expect(s.status).toBe("cancelled");
    expect(prCalls(d)).toHaveLength(0);
    expect(remoteHas(s.branch)).toBe(false);
  });

  it("keeps verify output out of the PR body", async () => {
    const verify = [`node -e "console.log('DATABASE_URL=postgres://app:pw@db/prod')"`];
    const d = deps({ plan: planOf(sub("a")), work: creates });
    const s = await startRun(repo.root, "quiet body", cfg({ verify }), d, "vb1");
    expect(s.status).toBe("pr_open");
    const args = prCalls(d)[0][1] as string[];
    const body = args[args.indexOf("--body") + 1];
    expect(body).not.toContain("postgres://");
    expect(body).toContain("passed");
    expect(body).toContain(".agentos/runs/vb1/state.json");
  });

  it("refuses a second engine on a run whose engine is alive, and takes over a dead engine's lock", async () => {
    const replies = [LIMIT, reply(JSON.stringify(planOf(sub("a"))))];
    const d = deps({ plan: () => replies.shift()!, work: creates });
    expect((await startRun(repo.root, "locked", cfg(), d, "lk1")).status).toBe("paused");
    const lock = path.join(runDir(repo.root, "lk1"), "lock");
    expect(existsSync(lock)).toBe(false); // released when the engine stopped
    writeFileSync(lock, String(process.pid)); // this process is alive
    await expect(resumeRun(repo.root, "lk1", cfg(), d)).rejects.toThrow(/already being driven by agentos process/);
    expect(loadRun(repo.root, "lk1").status).toBe("paused");
    writeFileSync(lock, String(spawnSync(process.execPath, ["-e", ""]).pid)); // a process that has exited
    expect((await resumeRun(repo.root, "lk1", cfg(), d)).status).toBe("pr_open");
    expect(readFileSync(path.join(runDir(repo.root, "lk1"), "events.jsonl"), "utf8")).toContain('"stale-lock"');
    expect(existsSync(lock)).toBe(false);
  });

  it("keeps the checkout clean after storing the run in memory, so the next run can start", async () => {
    expect((await startRun(repo.root, "first", cfg(), deps({ plan: planOf(sub("a")), work: creates }))).status).toBe("pr_open");
    expect(existsSync(path.join(repo.root, ".agentos", "memory.json"))).toBe(true);
    expect(statusOf(repo.root)).toBe("");
    expect((await startRun(repo.root, "second", cfg(), deps({ plan: planOf(sub("b")), work: creates }))).status).toBe("pr_open");
  });

  it("refuses to reuse the id of an existing run", async () => {
    const d = deps({ plan: () => LIMIT, work: creates });
    expect((await startRun(repo.root, "original", cfg(), d, "dup1")).status).toBe("paused");
    await expect(startRun(repo.root, "impostor", cfg(), d, "dup1")).rejects.toThrow(/already exists/);
    expect(loadRun(repo.root, "dup1").task).toBe("original");
  });

  it("pauses when the conflict fixer hits a rate limit, and resolves on resume", async () => {
    let fixerCalls = 0;
    const d = deps({
      plan: planOf(sub("a"), sub("b")),
      work: (cwd, p) => {
        if (p.includes("stopped with conflicts")) {
          if (++fixerCalls === 1) return LIMIT;
          return writeFileSync(path.join(cwd, "shared.txt"), "a and b\n");
        }
        writeFileSync(path.join(cwd, "shared.txt"), `${p.includes("create a.txt") ? "a" : "b"}\n`);
      },
    });
    const c = cfg(); // two parallel workers start from the same base, so the second merge conflicts
    const paused = await startRun(repo.root, "limited fixer", c, d, "cf1");
    expect(paused.status).toBe("paused");
    expect(paused.resumeFrom).toBe("working");
    const s = await resumeRun(repo.root, "cf1", c, d);
    expect(s.status).toBe("pr_open");
    expect(sh(repo.remote, ["show", `${s.branch}:shared.txt`])).toBe("a and b");
  });
});

describe("orchestrator engine: speed", { timeout: 60_000 }, () => {
  const high = (issue: string) => JSON.stringify([{ severity: "high", file: "a.txt", line: 1, issue }]);

  it("reviews while the tests run, not after them", async () => {
    // the test command holds a flag file for 4 s; a review that starts after the tests never sees it
    const verify = [`node -e "const f=require('fs');f.writeFileSync('testing.flag','');setTimeout(()=>f.unlinkSync('testing.flag'),4000)"`];
    let sawTests = false;
    const d = deps({
      plan: planOf(sub("a")), work: creates,
      review: async (_p, cwd) => {
        for (let i = 0; i < 160 && !sawTests; i++) { sawTests = existsSync(path.join(cwd, "testing.flag")); await new Promise((r) => setTimeout(r, 25)); }
        return "[]";
      },
    });
    const s = await startRun(repo.root, "parallel verify", cfg({ verify }), d);
    expect(s.status).toBe("pr_open");
    expect(sawTests).toBe(true);
  });

  it("gives the fixer the review findings in the same round as failing tests", async () => {
    const verify = [`node -e "process.exit(require('fs').existsSync('fixed.txt') ? 0 : 1)"`];
    const reviews = [high("a.txt must say hello"), "[]"];
    let fixPrompt = "";
    const d = deps({
      plan: planOf(sub("a")),
      review: () => reviews.shift() ?? "[]",
      work: (cwd, p) => {
        if (!p.includes("does not pass yet")) return creates(cwd, p);
        fixPrompt = p;
        writeFileSync(path.join(cwd, "fixed.txt"), "ok");
        writeFileSync(path.join(cwd, "a.txt"), "hello");
      },
    });
    const s = await startRun(repo.root, "both at once", cfg({ verify }), d);
    expect(s.status).toBe("pr_open");
    expect(s.fixRound).toBe(1);
    expect(fixPrompt).toContain("Failing checks");
    expect(fixPrompt).toContain("a.txt must say hello");
  });

  it("re-reviews only the fixer's change, against the earlier findings", async () => {
    const reviews = [high("a.txt must say hello"), "[]"];
    const prompts: string[] = [];
    const d = deps({
      plan: planOf(sub("a")),
      review: (p) => { prompts.push(p); return reviews.shift() ?? "[]"; },
      work: (cwd, p) => (p.includes("does not pass yet") ? writeFileSync(path.join(cwd, "a.txt"), "hello") : creates(cwd, p)),
    });
    const s = await startRun(repo.root, "scoped review", cfg(), d);
    expect(s.status).toBe("pr_open");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("new file mode"); // the first review sees the whole change
    expect(prompts[1]).toContain("[high] a.txt:1 a.txt must say hello");
    expect(prompts[1]).toContain("+hello");
    expect(prompts[1]).not.toContain("new file mode");
    expect(prompts[1]).toContain(`git diff ${s.base}..HEAD`);
  });

  it("does not hand a failing change to a human because its reviewer failed; the next review is a full one", async () => {
    const verify = [`node -e "process.exit(require('fs').existsSync('fixed.txt') ? 0 : 1)"`];
    const failed: RunnerResult = { ok: false, output: "reviewer crashed\n", rateLimited: false, timedOut: false };
    const results: (string | RunnerResult)[] = [failed, "[]"];
    const prompts: string[] = [];
    const d = deps({
      plan: planOf(sub("a")),
      review: (p) => { prompts.push(p); return results.shift() ?? "[]"; },
      work: (cwd, p) => (p.includes("does not pass yet") ? writeFileSync(path.join(cwd, "fixed.txt"), "ok") : creates(cwd, p)),
    });
    const s = await startRun(repo.root, "flaky reviewer", cfg({ verify }), d);
    expect(s.status).toBe("pr_open");
    expect(prompts[1]).toContain("new file mode");
  });

  it("stops when a verify command commits while the review runs", async () => {
    const verify = [`git commit -q --allow-empty -m sneaky`];
    const d = deps({ plan: planOf(sub("a")), work: creates });
    const s = await startRun(repo.root, "committing verify", cfg({ verify }), d);
    expect(s.status).toBe("needs_human");
    expect(s.reason).toContain("orchestrator.build");
    expect(prCalls(d)).toHaveLength(0);
  });

  it("keeps the earlier findings without asking the reviewer again when the fixer changed nothing", async () => {
    let reviews = 0;
    const d = deps({
      plan: planOf(sub("a")),
      review: () => { reviews++; return high("still wrong"); },
      work: (cwd, p) => (p.includes("does not pass yet") ? undefined : creates(cwd, p)),
    });
    const s = await startRun(repo.root, "lazy fixer", cfg({ maxFixRounds: 2 }), d);
    expect(s.status).toBe("needs_human");
    expect(reviews).toBe(1);
    expect(s.findings[0].issue).toBe("still wrong");
  });

  it("sends failing tests to the fixer when the reviewer hits a rate limit, instead of pausing", async () => {
    const verify = [`node -e "process.exit(require('fs').existsSync('fixed.txt') ? 0 : 1)"`];
    const results: (string | RunnerResult)[] = [LIMIT, "[]"];
    const d = deps({
      plan: planOf(sub("a")),
      review: () => results.shift() ?? "[]",
      work: (cwd, p) => (p.includes("does not pass yet") ? writeFileSync(path.join(cwd, "fixed.txt"), "ok") : creates(cwd, p)),
    });
    const s = await startRun(repo.root, "limited reviewer", cfg({ verify }), d);
    expect(s.status).toBe("pr_open");
    expect(s.fixRound).toBe(1);
  });

  it("--quick skips the planner and gives the whole task to the first worker", async () => {
    let planned = false;
    let workPrompt = "";
    const d = deps({ plan: () => { planned = true; return LIMIT; }, work: (cwd, p) => { workPrompt = p; creates(cwd, p); } });
    const s = await startRun(repo.root, "create q.txt", cfg({ workers: ["codex", "claude"] }), d, "q1", { quick: true });
    expect(s.status).toBe("pr_open");
    expect(planned).toBe(false);
    expect(s.subtasks.map((t) => [t.id, t.agent])).toEqual([["main", "codex"]]);
    expect(workPrompt).toContain("create q.txt");
    expect(sh(repo.remote, ["show", `${s.branch}:q.txt`])).toBe("q.txt");
  });
});
