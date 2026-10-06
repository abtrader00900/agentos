import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, existsSync, readFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeRepo, sh } from "./helpers.js";
import { startRun, resumeRun, type EngineDeps } from "../../src/orchestrator/engine.js";
import { requestCancel, runDir, loadRun } from "../../src/orchestrator/run.js";
import { statusOf } from "../../src/orchestrator/workspace.js";
import { orchestratorSchema } from "../../src/core/schema.js";
import { memoryQuota } from "../../src/orchestrator/quota.js";
import type { AgentName, Runner, RunnerResult } from "../../src/orchestrator/types.js";

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
function deps(f: {
  plan: object | (() => RunnerResult);
  work?: Work;
  review?: (prompt: string, cwd: string) => string | RunnerResult | Promise<string | RunnerResult>;
  /** per-agent fakes, overriding the shared ones */
  runners?: Partial<Record<AgentName, { read?: Runner; write?: Runner }>>;
}) {
  const reviewed = (r: string | RunnerResult) => (typeof r === "string" ? reply(r) : r);
  const read: Runner = async (req) =>
    req.prompt.includes("You are the planner")
      ? typeof f.plan === "function" ? (f.plan as () => RunnerResult)() : reply(JSON.stringify(f.plan))
      : reviewed(f.review ? await f.review(req.prompt, req.cwd) : "[]");
  const write: Runner = async (req) => (await f.work?.(req.cwd, req.prompt)) ?? reply();
  const gh = vi.fn((_cwd: string, args: string[]) => (args[0] === "pr" ? "https://github.com/o/r/pull/7\n" : ""));
  // an object literal, not an `: EngineDeps` annotation: runners is Partial there, and these tests reassign claude/codex
  const d = {
    runners: {
      claude: { read: f.runners?.claude?.read ?? read, write: f.runners?.claude?.write ?? write },
      codex: { read: f.runners?.codex?.read ?? read, write: f.runners?.codex?.write ?? write },
    },
    quota: memoryQuota(),
    gh,
    freeMemMb: () => 1e6,
  } satisfies EngineDeps;
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

  it("undoes and fails a read-mode call that edits the worktree", async () => {
    const d = deps({
      plan: planOf(sub("a")),
      work: creates,
      review: (_p, cwd) => { writeFileSync(path.join(cwd, "sneaky.txt"), "x"); return "[]"; },
    });
    await startRun(repo.root, "guard", cfg(), d, "g1");
    const events = readFileSync(path.join(runDir(repo.root, "g1"), "events.jsonl"), "utf8");
    expect(events).toContain('"type":"read-guard"');
    // the reviewer's edit never reaches any commit, local or pushed
    expect(sh(repo.root, ["log", "--all", "--name-only", "--format="])).not.toContain("sneaky.txt");
    expect(sh(repo.remote, ["log", "--all", "--name-only", "--format="])).not.toContain("sneaky.txt");
  });

  it("sees a read-mode call that only modifies a tracked file with a one-character name", async () => {
    // porcelain writes " M a"; the guard must not read the dirty flag or the name off a fixed offset
    writeFileSync(path.join(repo.root, "a"), "1");
    sh(repo.root, ["add", "-A"]);
    sh(repo.root, ["commit", "-qm", "short name"]);
    sh(repo.root, ["push", "-q", "origin", "main"]);
    const d = deps({
      plan: planOf(sub("b")),
      work: creates,
      review: (_p, cwd) => { writeFileSync(path.join(cwd, "a"), "2"); return "[]"; },
    });
    await startRun(repo.root, "short name", cfg(), d, "g2");
    const events = readFileSync(path.join(runDir(repo.root, "g2"), "events.jsonl"), "utf8");
    expect(events).toContain('"type":"read-guard"');
    expect(events).toMatch(/"files":\[[^\]]*"a"[,\]]/); // the name survives, not just the first character

  });

  it("puts back a tracked file a reader changed in the run worktree by its absolute path", async () => {
    let runWt = "";
    const d = deps({
      plan: planOf(sub("a")),
      work: (cwd, p) => { runWt ||= cwd; creates(cwd, p); },
      // the reviewer writes past its disposable worktree, into the real run worktree's README
      review: (prompt, cwd) => {
        if (!prompt.includes("You are the planner")) {
          const s = loadRun(repo.root, "g3");
          writeFileSync(path.join(s.runWorktree, "README.md"), "tampered");
        }
        return "[]";
      },
    });
    await startRun(repo.root, "absolute path", cfg(), d, "g3");
    const events = readFileSync(path.join(runDir(repo.root, "g3"), "events.jsonl"), "utf8");
    expect(events).toContain('"type":"read-guard"');
    expect(sh(repo.root, ["log", "--all", "-p", "--format="])).not.toContain("tampered");
    expect(sh(repo.remote, ["log", "--all", "-p", "--format="])).not.toContain("tampered");
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
    // one agent, so a limit has nowhere to fall back to
    const c = cfg({ planner: "claude", workers: ["claude"], reviewer: "claude", maxWorkers: 1 });
    const paused = await startRun(repo.root, "limited", c, d, "t9");
    expect(paused.status).toBe("paused");
    expect(paused.resumeFrom).toBe("working");
    d.quota!.clear(); // the limit marked claude for an hour; the owner resumes sooner
    const s = await resumeRun(repo.root, "t9", c, d);
    expect(s.status).toBe("pr_open");
    expect(aCalls).toBe(1);
    expect(bCalls).toBe(2);
  });

  it("pauses when the planner hits a limit", async () => {
    const replies = [LIMIT, reply(JSON.stringify(planOf(sub("a"))))];
    const d = deps({ plan: () => replies.shift()!, work: creates });
    const c = cfg({ planner: "claude", workers: ["claude"], reviewer: "claude" }); // one agent, so a limit has nowhere to fall back to
    expect((await startRun(repo.root, "later", c, d, "t10")).status).toBe("paused");
    d.quota!.clear();
    expect((await resumeRun(repo.root, "t10", c, d)).status).toBe("pr_open");
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
    const c = cfg({ planner: "claude", workers: ["claude"], reviewer: "claude", maxWorkers: 1 }); // one agent, so a limit pauses the run
    const paused = await startRun(repo.root, "crash mid-merge", c, d, "sm1");
    expect(paused.status).toBe("paused");
    // what a crash inside resolveConflicts leaves behind: a merge stopped on conflicts
    const stray = path.join(repo.tmp, "stray");
    sh(repo.root, ["worktree", "add", "-q", "-b", "stray", stray, paused.base]);
    writeFileSync(path.join(stray, "a.txt"), "stray\n");
    sh(stray, ["add", "-A"]);
    sh(stray, ["commit", "-qm", "stray"]);
    expect(() => sh(paused.runWorktree, ["merge", "stray"])).toThrow();
    d.quota!.clear();
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
    const c = cfg({ planner: "claude", workers: ["claude"], reviewer: "claude" }); // one agent, so the planner's limit pauses the run
    expect((await startRun(repo.root, "locked", c, d, "lk1")).status).toBe("paused");
    const lock = path.join(runDir(repo.root, "lk1"), "lock");
    expect(existsSync(lock)).toBe(false); // released when the engine stopped
    writeFileSync(lock, String(process.pid)); // this process is alive
    d.quota!.clear();
    await expect(resumeRun(repo.root, "lk1", c, d)).rejects.toThrow(/already being driven by agentos process/);
    expect(loadRun(repo.root, "lk1").status).toBe("paused");
    writeFileSync(lock, String(spawnSync(process.execPath, ["-e", ""]).pid)); // a process that has exited
    d.quota!.clear();
    expect((await resumeRun(repo.root, "lk1", c, d)).status).toBe("pr_open");
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
    // two parallel workers start from the same base, so the second merge conflicts; one agent, so the fixer's limit pauses
    const c = cfg({ planner: "claude", workers: ["claude"], reviewer: "claude" });
    const paused = await startRun(repo.root, "limited fixer", c, d, "cf1");
    expect(paused.status).toBe("paused");
    expect(paused.resumeFrom).toBe("working");
    d.quota!.clear();
    const s = await resumeRun(repo.root, "cf1", c, d);
    expect(s.status).toBe("pr_open");
    expect(sh(repo.remote, ["show", `${s.branch}:shared.txt`])).toBe("a and b");
  });
});

describe("orchestrator engine: speed", { timeout: 60_000 }, () => {
  const high = (issue: string) => JSON.stringify([{ severity: "high", file: "a.txt", line: 1, issue }]);

  it("reviews while the tests run, not after them", async () => {
    // the test command holds a flag file for 4 s; a review that starts after the tests never sees it.
    // The flag lives outside the repo: the review runs in a disposable worktree (the read guard), which
    // cannot see a file the tests write into the run worktree.
    const flag = path.join(mkdtempSync(path.join(tmpdir(), "flag-")), "testing.flag").replace(/\\/g, "/");
    const verify = [`node -e "const f=require('fs');f.writeFileSync('${flag}','');setTimeout(()=>f.unlinkSync('${flag}'),4000)"`];
    let sawTests = false;
    const d = deps({
      plan: planOf(sub("a")), work: creates,
      review: async () => {
        for (let i = 0; i < 160 && !sawTests; i++) { sawTests = existsSync(flag); await new Promise((r) => setTimeout(r, 25)); }
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

  it("asks the reviewer again when a fixer that changed nothing still made claims", async () => {
    const prompts: string[] = [];
    const d = deps({
      plan: planOf(sub("a")),
      review: (p) => { prompts.push(p); return high("still wrong"); },
      work: (cwd, p) => (p.includes("does not pass yet") ? reply("CHANGED: a.txt\nNOT DONE: none") : creates(cwd, p)),
    });
    const s = await startRun(repo.root, "claiming fixer", cfg({ maxFixRounds: 1 }), d);
    expect(s.status).toBe("needs_human");
    expect(prompts).toHaveLength(2); // the claim is new even though the commit is not
    expect(prompts[1]).toContain("CHANGED: a.txt");
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

  it("--quick skips the planner and gives the whole task to the first worker (subtask 'task': 'main' reads like the branch)", async () => {
    let planned = false;
    let workPrompt = "";
    const d = deps({ plan: () => { planned = true; return LIMIT; }, work: (cwd, p) => { workPrompt = p; creates(cwd, p); } });
    const s = await startRun(repo.root, "create q.txt", cfg({ workers: ["codex", "claude"] }), d, "q1", { quick: true });
    expect(s.status).toBe("pr_open");
    expect(planned).toBe(false);
    expect(s.subtasks.map((t) => [t.id, t.agent])).toEqual([["task", "codex"]]);
    expect(workPrompt).toContain("create q.txt");
    expect(sh(repo.remote, ["show", `${s.branch}:q.txt`])).toBe("q.txt");
  });
});

describe("orchestrator engine: --onto", { timeout: 60_000 }, () => {
  /** an agentos PR branch on the remote, one commit past main */
  const prBranch = (name = "agentos/run-pr1") => {
    sh(repo.root, ["checkout", "-q", "-b", name]);
    writeFileSync(path.join(repo.root, "feature.txt"), "feature\n");
    sh(repo.root, ["add", "-A"]);
    sh(repo.root, ["commit", "-qm", "feature"]);
    sh(repo.root, ["push", "-q", "origin", name]);
    sh(repo.root, ["checkout", "-q", "main"]);
    return { name, tip: sh(repo.root, ["rev-parse", name]) };
  };

  it("refuses a branch that is not an agentos run branch", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates });
    await expect(startRun(repo.root, "fix ci", cfg(), d, "o1", { onto: "main" })).rejects.toThrow(/agentos\/run-/);
    await expect(startRun(repo.root, "fix ci", cfg(), d, "o2", { onto: "feature/x" })).rejects.toThrow(/agentos\/run-/);
  });

  it("works on top of the PR branch, pushes there fast-forward, and opens no new PR", async () => {
    const pr = prBranch();
    const d = deps({ plan: planOf(sub("a")), work: creates });
    const s = await startRun(repo.root, "create main.txt", cfg(), d, "o3", { onto: pr.name, quick: true });
    expect(s.status).toBe("pr_open");
    expect(s.onto).toBe(pr.name);
    expect(s.baseBranch).toBe(pr.name);
    const files = sh(repo.remote, ["ls-tree", "--name-only", pr.name]);
    expect(files).toContain("feature.txt");
    expect(files).toContain("main.txt"); // quick: the whole task is the one subtask, and creates() writes main.txt
    expect(sh(repo.remote, ["merge-base", "--is-ancestor", pr.tip, pr.name])).toBe(""); // fast-forward: the old tip is kept
    expect(d.gh.mock.calls.some((c) => c[1][0] === "pr" && c[1][1] === "create")).toBe(false);
    expect(d.gh.mock.calls.some((c) => c[1][0] === "pr" && c[1][1] === "view" && c[1][2] === pr.name)).toBe(true);
    expect(s.prUrl).toBe("https://github.com/o/r/pull/7");
  });

  it("keeps onto across a pause and resume", async () => {
    const pr = prBranch("agentos/run-pr2");
    let calls = 0;
    const d = deps({ plan: planOf(sub("a")), work: (cwd, p) => (++calls === 1 ? LIMIT : creates(cwd, p)) });
    const c = cfg({ planner: "claude", workers: ["claude"], reviewer: "claude" }); // one agent, so the limit pauses the run
    const paused = await startRun(repo.root, "create main.txt", c, d, "o4", { onto: pr.name, quick: true });
    expect(paused.status).toBe("paused");
    d.quota!.clear();
    const s = await resumeRun(repo.root, "o4", c, d);
    expect(s.status).toBe("pr_open");
    expect(sh(repo.remote, ["merge-base", "--is-ancestor", pr.tip, pr.name])).toBe("");
  });
});

describe("orchestrator engine: smart gates", { timeout: 60_000 }, () => {
  const lockfile = (cwd: string) => writeFileSync(path.join(cwd, "package-lock.json"), "{}\n");

  it("flags a risky file in the PR body and still opens the PR", async () => {
    const d = deps({ plan: planOf(sub("a")), work: (cwd, p) => { creates(cwd, p); lockfile(cwd); } });
    const s = await startRun(repo.root, "add a", cfg(), d);
    expect(s.status).toBe("pr_open");
    expect(s.risk).toEqual([{ rule: "lockfile", action: "flag", files: ["package-lock.json"] }]);
    const body = prCalls(d)[0][1][prCalls(d)[0][1].indexOf("--body") + 1];
    expect(body).toContain("⚠️ Look here");
    expect(body).toContain("lockfile: package-lock.json");
  });

  it("stops at needs_human when a block rule matches, and opens no PR", async () => {
    const d = deps({ plan: planOf(sub("a")), work: (cwd, p) => { creates(cwd, p); lockfile(cwd); } });
    const s = await startRun(repo.root, "add a", cfg({ risk: [{ name: "lockfile", action: "block", paths: ["package-lock.json"] }] }), d);
    expect(s.status).toBe("needs_human");
    expect(s.reason).toContain('risk rule "lockfile" blocks the PR');
    expect(prCalls(d)).toHaveLength(0);
  });

  it("hands a skipped test to the fixer as a high finding", async () => {
    const r2 = makeRepo({ "tests/a.test.js": "it('works', () => { expect(1).toBe(1); });\n" });
    try {
      let fixPrompt = "";
      const d = deps({
        plan: planOf(sub("a")),
        work: (cwd, p) => {
          if (p.includes("does not pass yet")) {
            fixPrompt = p;
            writeFileSync(path.join(cwd, "tests/a.test.js"), "it('works', () => { expect(1).toBe(1); });\n");
          } else writeFileSync(path.join(cwd, "tests/a.test.js"), "it.skip('works', () => { expect(1).toBe(1); });\n");
        },
      });
      const s = await startRun(r2.root, "make it pass", cfg(), d);
      expect(fixPrompt).toMatch(/\[high\] tests\/a\.test\.js:0 a test was skipped/);
      expect(s.status).toBe("pr_open");
    } finally { r2.cleanup(); }
  });

  it("puts the agents' reports in the PR body and tells the reviewer to check them", async () => {
    let reviewPromptText = "";
    const d = deps({
      plan: planOf(sub("a")),
      work: (cwd, p) => { creates(cwd, p); return reply("Made a.txt.\nCHANGED: a.txt\nNOT DONE: the docs\nASSUMED: UTF-8\nNOT VERIFIED: none"); },
      review: (p) => { reviewPromptText = p; return "[]"; },
    });
    const s = await startRun(repo.root, "add a", cfg(), d);
    expect(s.subtasks[0].report).toEqual({ changed: ["a.txt"], notDone: ["the docs"], assumed: ["UTF-8"], notVerified: [] });
    const body = prCalls(d)[0][1][prCalls(d)[0][1].indexOf("--body") + 1];
    expect(body).toContain("What the agents report");
    expect(body).toContain("Not done: the docs");
    expect(body).toContain("Assumed: UTF-8");
    expect(reviewPromptText).toContain("NOT DONE: the docs");
    expect(reviewPromptText).toContain("Tests made weaker to pass");
  });

  it("says when an agent gave no report", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates });
    await startRun(repo.root, "add a", cfg(), d);
    const body = prCalls(d)[0][1][prCalls(d)[0][1].indexOf("--body") + 1];
    expect(body).toContain("a (claude): no report");
  });

  it("asks workers for the report", async () => {
    let workPrompt = "";
    const d = deps({ plan: planOf(sub("a")), work: (cwd, p) => { workPrompt = p; creates(cwd, p); } });
    await startRun(repo.root, "add a", cfg(), d);
    expect(workPrompt).toContain("NOT VERIFIED:");
  });
});

describe("orchestrator engine: decider", { timeout: 60_000 }, () => {
  const dc = { autoQuick: true, contentRisk: true, quickAbove: 0.8, riskAbove: 0.6, url: "http://127.0.0.1:8017" };
  /** a fake decider: answers from the map; records what it was asked */
  const fakeDecide = (answers: Record<string, number> | null) => {
    const asked: { state: unknown; keys: string[] }[] = [];
    const decide = async (state: string | object, q: Record<string, string>) => { asked.push({ state, keys: Object.keys(q) }); return answers && Object.fromEntries(Object.keys(q).map((k) => [k, answers[k] ?? 0])); };
    return { decide, asked };
  };

  it("skips the planner when the decider is sure the task is small, and says so in the PR", async () => {
    const f = fakeDecide({ small: 0.91 });
    const d = Object.assign(deps({ plan: () => { throw new Error("planner must not run"); }, work: creates }), { decide: f.decide, deciderConfig: dc });
    const s = await startRun(repo.root, "create q.txt", cfg(), d);
    expect(s.status).toBe("pr_open");
    expect(s.quick).toBe(true);
    expect(s.autoQuick).toEqual({ p: 0.91 });
    const body = prCalls(d)[0][1][prCalls(d)[0][1].indexOf("--body") + 1];
    expect(body).toContain("**Planner:** skipped by the decider (jevos 0.91)");
  });

  it("plans when the decider is unsure, when --plan or --quick is given, and never asks for a CI fix", async () => {
    const f = fakeDecide({ small: 0.5 });
    const d = Object.assign(deps({ plan: planOf(sub("a")), work: creates }), { decide: f.decide, deciderConfig: dc });
    expect((await startRun(repo.root, "add a", cfg(), d, "dq1")).quick).toBeUndefined();
    const sure = fakeDecide({ small: 0.99 });
    const d2 = Object.assign(deps({ plan: planOf(sub("a")), work: creates }), { decide: sure.decide, deciderConfig: dc });
    expect((await startRun(repo.root, "add a", cfg(), d2, "dq2", { plan: true })).quick).toBeUndefined();
    expect(sure.asked.filter((a) => a.keys.includes("small"))).toHaveLength(0);
  });

  it("adds a content flag above riskAbove, never blocks, and shows the percentage", async () => {
    const f = fakeDecide({ small: 0, money: 0.82, "data-loss": 0.1, access: 0.3 });
    const d = Object.assign(deps({ plan: planOf(sub("a")), work: creates }), { decide: f.decide, deciderConfig: dc });
    const s = await startRun(repo.root, "add a", cfg(), d);
    expect(s.status).toBe("pr_open");
    expect(s.risk).toEqual([{ rule: "jevos:money", action: "flag", files: [], p: 0.82 }]);
    const body = prCalls(d)[0][1][prCalls(d)[0][1].indexOf("--body") + 1];
    expect(body).toContain("- jevos:money (82%)");
    expect(String(f.asked.find((a) => a.keys.includes("money"))!.state)).toContain("+a.txt");
  });

  it("changes nothing when the decider is down", async () => {
    const f = fakeDecide(null);
    const d = Object.assign(deps({ plan: planOf(sub("a")), work: creates }), { decide: f.decide, deciderConfig: dc });
    const s = await startRun(repo.root, "add a", cfg(), d);
    expect(s.status).toBe("pr_open");
    expect(s.quick).toBeUndefined();
    expect(s.risk).toEqual([]);
    const events = readFileSync(path.join(runDir(repo.root, s.id), "events.jsonl"), "utf8");
    expect(events).toContain('"use":"auto-quick","skipped":true');
    expect(events).toContain('"use":"content-risk","skipped":true');
  });
});

describe("orchestrator engine: quota fallback", { timeout: 60_000 }, () => {
  it("finishes on the next allowed agent when the first hits its quota, without pausing", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates });
    d.runners.claude.write = async () => LIMIT;
    const s = await startRun(repo.root, "quota", cfg(), d, "q1");
    expect(s.status).toBe("pr_open");
    // claude is limited, so codex reviewed its own code: allowed, but flagged for the owner
    expect(s.selfReview).toBe(true);
    const body = prCalls(d)[0][1] as string[];
    expect(body[body.indexOf("--body") + 1]).toContain("reviewed by the same model that wrote it");
    expect(d.quota!.until("claude", new Date())).toBeDefined();
    const events = readFileSync(path.join(runDir(repo.root, "q1"), "events.jsonl"), "utf8");
    expect(events).toContain('"type":"fallback"');
    expect(events).toContain('"why":"quota"');
  });

  it("pauses with resumeAt only when every allowed agent is limited", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates });
    d.runners.claude.write = async () => LIMIT;
    d.runners.codex.write = async () => LIMIT;
    const s = await startRun(repo.root, "all limited", cfg(), d, "q2");
    expect(s.status).toBe("paused");
    expect(Date.parse(s.resumeAt!)).toBeGreaterThan(Date.now());
  });

  it("skips an agent the store already marks limited", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates });
    let claudeCalls = 0;
    const base = d.runners.claude.write;
    d.runners.claude.write = async (r) => { claudeCalls++; return base(r); };
    d.quota!.mark("claude", new Date(Date.now() + 60_000));
    expect((await startRun(repo.root, "pre-limited", cfg(), d, "q3")).status).toBe("pr_open");
    expect(claudeCalls).toBe(0);
  });

  it("an early resume while every agent is still limited pauses again without calling any agent", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates });
    let calls = 0;
    for (const a of ["claude", "codex"] as const) {
      const w = d.runners[a].write; d.runners[a].write = async (r) => { calls++; return w(r); };
      const rd = d.runners[a].read; d.runners[a].read = async (r) => { calls++; return rd(r); };
      d.quota!.mark(a, new Date(Date.now() + 3_600_000));
    }
    const s = await startRun(repo.root, "all pre-limited", cfg(), d, "q5");
    expect(s.status).toBe("paused");
    expect(calls).toBe(0);
    expect((await resumeRun(repo.root, "q5", cfg(), d)).status).toBe("paused");
    expect(calls).toBe(0);
  });

  it("never leaves the agents allowlist", () => {
    expect(() => cfg({ agents: ["claude"], workers: ["claude", "codex"] })).toThrow();
    expect(cfg({}).agents).toEqual(["claude", "codex"]);
  });

  it("fails the subtask instead of waiting for a cooldown when a limit follows an error", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates });
    // claude never reaches its quota, so a pause would make the daemon wait for codex's cooldown for nothing
    d.runners.claude.write = async () => ({ ok: false, output: "crashed\n", rateLimited: false, timedOut: false });
    d.runners.codex.write = async () => LIMIT;
    const s = await startRun(repo.root, "error then quota", cfg(), d, "q7");
    expect(s.status).toBe("needs_human");
    expect(s.resumeAt).toBeUndefined();
    expect(d.quota!.until("claude", new Date())).toBeUndefined();
  });

  it("skips a fallback agent that something else limited while the first call ran", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates });
    let codexCalls = 0;
    // what a parallel worker or another run does to the shared store mid-call
    d.runners.claude.write = async () => { d.quota!.mark("codex", new Date(Date.now() + 3_600_000)); return LIMIT; };
    const codexWrite = d.runners.codex.write;
    d.runners.codex.write = async (r) => { codexCalls++; return codexWrite(r); };
    const s = await startRun(repo.root, "limited mid-call", cfg(), d, "q8");
    expect(s.status).toBe("paused");
    expect(codexCalls).toBe(0);
  });

  it("retries an agent whose limit expired while the fallback ran, instead of pausing", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates });
    let claudeCalls = 0;
    const claudeWrite = d.runners.claude.write;
    d.runners.claude.write = async (r) => { claudeCalls++; return claudeWrite(r); };
    // claude is limited when the chain starts, and free again by the time codex burns its own quota
    d.quota!.mark("claude", new Date(Date.now() + 3_600_000));
    d.runners.codex.write = async () => { d.quota!.clear("claude"); return LIMIT; };
    const s = await startRun(repo.root, "limit expired mid-chain", cfg(), d, "q9");
    expect(s.status).toBe("pr_open");
    expect(claudeCalls).toBe(1);
  });

  it("retries instead of pausing when a cooldown ended while the rest of the step ran", async () => {
    // the reviewer exhausts both agents, then both cooldowns end while the verify command is still running
    const reviews: (string | RunnerResult)[] = [LIMIT, LIMIT];
    const d = deps({ plan: planOf(sub("a")), work: creates, review: () => reviews.shift() ?? "[]" });
    const c = cfg({ quotaCooldownMinutes: 0.03, verify: [`node -e "setTimeout(function () {}, 4000)"`] });
    const s = await startRun(repo.root, "free again before the pause", c, d, "q10");
    expect(s.status).toBe("pr_open"); // pausing would make the daemon wait for limits that are already gone
    expect(s.resumeAt).toBeUndefined();
    expect(readFileSync(path.join(runDir(repo.root, "q10"), "events.jsonl"), "utf8")).toContain('"type":"quota-freed"');
  });

  it("picks a reviewer that did not write the code, even after a fallback", async () => {
    let reviewers: string[] = [];
    const d = deps({ plan: planOf(sub("a")), work: creates });
    // an error (not a quota limit, which would also bar claude from reviewing) hands the claude subtask to codex
    d.runners.claude.write = async () => ({ ok: false, output: "crashed\n", rateLimited: false, timedOut: false });
    const codexRead = d.runners.codex.read;
    d.runners.codex.read = async (r) => { if (!r.prompt.includes("You are the planner")) reviewers.push("codex"); return codexRead(r); };
    const claudeRead = d.runners.claude.read;
    d.runners.claude.read = async (r) => { if (!r.prompt.includes("You are the planner")) reviewers.push("claude"); return claudeRead(r); };
    await startRun(repo.root, "who reviews", cfg(), d, "q4");
    expect(reviewers[0]).toBe("claude");
  });

  it("counts a fallback fixer as an author: its own re-review is flagged as a self-review", async () => {
    const findings = [JSON.stringify([{ severity: "high", file: "a.txt", line: 1, issue: "a.txt must say hello" }]), "[]"];
    // the subtask creates a.txt; the fixer (any prompt without "create") must change a file, or the re-review is skipped as unchanged
    const work: Work = (cwd, p) => (/create \S+\.txt/.test(p) ? creates(cwd, p) : writeFileSync(path.join(cwd, "a.txt"), "hello"));
    const d = deps({ plan: planOf(sub("a")), work, review: () => findings.shift() ?? "[]" });
    let claudeWrites = 0;
    const claudeWrite = d.runners.claude.write;
    // claude writes the subtask, then crashes as the fixer: codex fixes, and only claude or codex can review
    d.runners.claude.write = async (r) => (++claudeWrites === 1 ? claudeWrite(r) : { ok: false, output: "crashed\n", rateLimited: false, timedOut: false });
    const s = await startRun(repo.root, "fix by fallback", cfg(), d, "q7");
    expect(s.status).toBe("pr_open");
    expect(loadRun(repo.root, "q7").editors).toEqual(["codex"]);
    expect(s.selfReview).toBe(true);
  });

  it("fails instead of pausing when no allowed agent has a runner at all", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates });
    delete (d.runners as Record<string, unknown>).claude;
    delete (d.runners as Record<string, unknown>).codex;
    const s = await startRun(repo.root, "no runners", cfg(), d, "q8");
    expect(s.status).not.toBe("paused");
    expect(s.resumeAt).toBeUndefined();
  });

  it("fails instead of pausing when the only quota marks belong to agents with no runner", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates });
    delete (d.runners as Record<string, unknown>).claude;
    delete (d.runners as Record<string, unknown>).codex;
    d.quota!.mark("claude", new Date(Date.now() + 3_600_000));
    const s = await startRun(repo.root, "stale mark", cfg(), d, "q10");
    expect(s.status).not.toBe("paused");
  });

  it("clears resumeAt when a paused run resumes", async () => {
    const d = deps({ plan: planOf(sub("a")), work: creates });
    const w = d.runners.claude.write;
    let first = true;
    d.runners.claude.write = async (r) => { if (first) { first = false; return LIMIT; } return w(r); };
    const c = cfg({ planner: "claude", workers: ["claude"], reviewer: "claude", agents: ["claude"] });
    const paused = await startRun(repo.root, "resume clears", c, d, "q9");
    expect(paused.status).toBe("paused");
    expect(paused.resumeAt).toBeDefined();
    d.quota!.clear();
    const s = await resumeRun(repo.root, "q9", c, d);
    expect(s.status).toBe("pr_open");
    expect(loadRun(repo.root, "q9").resumeAt).toBeUndefined();
  });
});
