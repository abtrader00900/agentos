import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, realpathSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeRepo } from "../orchestrator/helpers.js";
import { registerProject } from "../../src/ui/projects.js";
import { addJob, listJobs, updateJob } from "../../src/daemon/queue.js";
import { Daemon, readState, writeState, type DaemonDeps } from "../../src/daemon/daemon.js";
import { saveRun, runDir, type RunState } from "../../src/orchestrator/run.js";

let home: string;
let repo: ReturnType<typeof makeRepo>;
let pid: string;
let launched: string[][];
let clock: Date;
let finishAs: Partial<RunState> | null;

const CONFIG = (daemon: string) => `project: { name: t }\norchestrator: { verify: [] }\ndaemon: ${daemon}\n`;
const runState = (id: string, over: Partial<RunState>): RunState => ({ id, task: "t", status: "pr_open", baseBranch: "main", base: "x", branch: `agentos/run-${id}`, runWorktree: "", createdAt: "", updatedAt: "", subtasks: [], fixRound: 0, findings: [], ...over });

function deps(over: Partial<DaemonDeps> = {}): DaemonDeps {
  return {
    home, now: () => clock, freeMemMb: () => 1e6, gh: () => "[]", log: () => {}, pollMs: 10,
    launch: async (root, args) => {
      launched.push(args);
      const id = args[0] === "run" && args[1] === "--resume" ? args[2] : args[args.indexOf("--id") + 1];
      if (finishAs) saveRun(root, runState(id, finishAs));
      return 0;
    },
    ...over,
  };
}

beforeEach(() => {
  home = realpathSync.native(mkdtempSync(path.join(tmpdir(), "agentos-d-")));
  repo = makeRepo({ "agent.config.yaml": CONFIG("{ enabled: true }") });
  pid = registerProject(repo.root, home)!.id;
  launched = [];
  clock = new Date(2026, 9, 1, 12);
  finishAs = { status: "pr_open", prUrl: "https://github.com/o/r/pull/9" };
});
afterEach(() => repo.cleanup());

describe("daemon tick", { timeout: 30_000 }, () => {
  it("starts the oldest queued job as an agentos run and records the PR", async () => {
    addJob({ projectId: pid, task: "add a report", source: "manual", quick: true }, home, clock);
    const d = new Daemon(deps());
    await d.tick();
    await d.idle();
    expect(launched).toHaveLength(1);
    expect(launched[0].slice(0, 2)).toEqual(["run", "--id"]);
    expect(launched[0]).toContain("--quick");
    expect(launched[0].at(-1)).toBe("add a report");
    expect(listJobs(home)[0]).toMatchObject({ status: "done", result: "https://github.com/o/r/pull/9", attempts: 1 });
  });

  it("runs one job at a time", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    addJob({ projectId: pid, task: "one", source: "manual" }, home, clock);
    addJob({ projectId: pid, task: "two", source: "manual" }, home, clock);
    const d = new Daemon(deps({ launch: async (_root, args) => { launched.push(args); await gate; return 0; } }));
    await d.tick();
    await d.tick();
    expect(launched).toHaveLength(1);
    release();
    await d.idle();
  });

  it("stops starting new jobs at the daily cap", async () => {
    for (let i = 0; i < 7; i++) addJob({ projectId: pid, task: `job ${i}`, source: "manual" }, home, clock);
    const d = new Daemon(deps());
    for (let i = 0; i < 8; i++) { await d.tick(); await d.idle(); }
    expect(launched).toHaveLength(6);
    clock = new Date(2026, 9, 2, 0, 5);
    await d.tick(); await d.idle();
    expect(launched).toHaveLength(7);
  });

  it("starts nothing once its lock was taken over, and never launches a job another daemon already marked running", async () => {
    const j = addJob({ projectId: pid, task: "contested", source: "manual" }, home, clock)!;
    await new Daemon(deps({ owns: () => false })).tick();
    expect(launched).toHaveLength(0);
    // the other daemon marked it running between our nextJob() and our start
    let raced = false;
    const d = new Daemon(deps({ freeMemMb: () => { if (!raced) { raced = true; updateJob(j.id, { status: "running", runId: "theirs" }, home); } return 1e6; } }));
    await d.tick();
    await d.idle();
    expect(launched).toHaveLength(0);
    expect(listJobs(home)[0]).toMatchObject({ status: "running", runId: "theirs" });
  });

  it("leaves the result to a newer daemon that took the lock, but records it itself when nobody did", async () => {
    let other = false;
    const run = (taken: boolean) => async (root: string, args: string[]) => {
      launched.push(args);
      other = taken; // while the run went on, this daemon was stopped (and maybe replaced)
      saveRun(root, runState(args[args.indexOf("--id") + 1], { status: "pr_open", prUrl: "u" }));
      return 0;
    };
    const a = addJob({ projectId: pid, task: "handed over", source: "manual" }, home, clock)!;
    let d = new Daemon(deps({ otherOwner: () => other, launch: run(true) }));
    await d.tick(); await d.idle();
    expect(listJobs(home).find((j) => j.id === a.id)!.status).toBe("running"); // the adopting daemon finishes it
    updateJob(a.id, { status: "done" }, home);
    const b = addJob({ projectId: pid, task: "nobody took over", source: "manual" }, home, clock)!;
    other = false;
    d = new Daemon(deps({ otherOwner: () => other, launch: run(false) }));
    await d.tick(); await d.idle();
    expect(listJobs(home).find((j) => j.id === b.id)).toMatchObject({ status: "done", result: "u" }); // never stuck running
  });

  it("waits for free memory, and says why once", async () => {
    addJob({ projectId: pid, task: "big", source: "manual" }, home, clock);
    const lines: string[] = [];
    const d = new Daemon(deps({ freeMemMb: () => 10, log: (l) => lines.push(l) }));
    await d.tick();
    await d.tick();
    expect(launched).toHaveLength(0);
    expect(lines.filter((l) => l.includes("waits for memory"))).toEqual([expect.stringContaining("10 MB free, 1500 MB needed")]);
  });

  it("pauses the whole queue after a rate limit, then resumes that run first", async () => {
    finishAs = { status: "paused", resumeFrom: "working" };
    addJob({ projectId: pid, task: "limited", source: "manual" }, home, clock);
    addJob({ projectId: pid, task: "next", source: "manual" }, home, clock);
    const d = new Daemon(deps());
    await d.tick(); await d.idle();
    expect(listJobs(home)[0].status).toBe("paused");
    clock = new Date(clock.getTime() + 10 * 60_000);
    await d.tick(); await d.idle();
    expect(launched).toHaveLength(1);
    clock = new Date(clock.getTime() + 25 * 60_000);
    finishAs = { status: "pr_open", prUrl: "u" };
    await d.tick(); await d.idle();
    expect(launched[1].slice(0, 2)).toEqual(["run", "--resume"]);
    expect(listJobs(home)[0]).toMatchObject({ status: "done", attempts: 2 });
  });

  it("waits for a paused run's resumeAt before resuming it", async () => {
    const j = addJob({ projectId: pid, task: "out of quota", source: "manual" }, home, clock)!;
    const resumeAt = new Date(clock.getTime() + 30 * 60_000).toISOString();
    saveRun(repo.root, runState("q9", { status: "paused", resumeFrom: "working", resumeAt }));
    updateJob(j.id, { status: "paused", runId: "q9" }, home);
    const d = new Daemon(deps());
    await d.tick(); await d.idle();
    expect(launched).toHaveLength(0);
    clock = new Date(Date.parse(resumeAt) + 60_000);
    await d.tick(); await d.idle();
    expect(launched[0].slice(0, 2)).toEqual(["run", "--resume"]);
  });

  it("fails a job whose project turned the daemon off, without running it", async () => {
    writeFileSync(path.join(repo.root, "agent.config.yaml"), CONFIG("{ enabled: false }"));
    addJob({ projectId: pid, task: "x x x", source: "manual" }, home, clock);
    await new Daemon(deps()).tick();
    expect(launched).toHaveLength(0);
    expect(listJobs(home)[0]).toMatchObject({ status: "failed" });
    expect(listJobs(home)[0].result).toContain("daemon.enabled");
  });

  it("records a needs_human run as failed with its reason", async () => {
    finishAs = { status: "needs_human", reason: "still failing after 3 fix round(s)" };
    addJob({ projectId: pid, task: "hard", source: "manual" }, home, clock);
    const d = new Daemon(deps());
    await d.tick(); await d.idle();
    expect(listJobs(home)[0]).toMatchObject({ status: "failed", result: "still failing after 3 fix round(s)" });
  });

  it("queues a due schedule once and a CI fix with --onto", async () => {
    writeFileSync(path.join(repo.root, "agent.config.yaml"), CONFIG(`{ enabled: true, ciFix: true, schedules: [{ cron: "0 2 * * *", task: "nightly chores" }] }`));
    const gh = (_c: string, args: string[]) =>
      args[0] === "pr" ? JSON.stringify([{ number: 4, headRefName: "agentos/run-x", statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }] }])
        : args[1] === "list" ? "[]" : "";
    const d = new Daemon(deps({ gh, launch: async () => 0 }));
    await d.tick();                                   // first sight: the schedule starts counting
    clock = new Date(2026, 9, 2, 3);
    await d.tick();
    const jobs = listJobs(home);
    expect(jobs.filter((j) => j.source === "schedule").map((j) => j.task)).toEqual(["nightly chores"]);
    const ci = jobs.find((j) => j.source === "ci")!;
    expect(ci).toMatchObject({ onto: "agentos/run-x", quick: true });
    await d.idle();
  });

  it("gives up a job whose run keeps dying", async () => {
    finishAs = { status: "working" };               // the engine exited without finishing
    addJob({ projectId: pid, task: "crashy", source: "manual" }, home, clock);
    const d = new Daemon(deps());
    for (let i = 0; i < 4; i++) { await d.tick(); await d.idle(); }
    expect(launched).toHaveLength(3);
    expect(listJobs(home)[0]).toMatchObject({ status: "failed" });
  });
});

describe("daemon recovery", { timeout: 30_000 }, () => {
  it("re-queues a running job whose engine is gone, as paused, so it resumes", () => {
    const j = addJob({ projectId: pid, task: "t t t", source: "manual" }, home, clock)!;
    updateJob(j.id, { status: "running", runId: "r1", attempts: 1 }, home);
    saveRun(repo.root, runState("r1", { status: "working" }));
    new Daemon(deps()).recover();
    expect(listJobs(home)[0].status).toBe("paused");
  });

  it("adopts a running job whose engine is still alive and waits for it", async () => {
    const j = addJob({ projectId: pid, task: "t t t", source: "manual" }, home, clock)!;
    updateJob(j.id, { status: "running", runId: "r2", attempts: 1 }, home);
    saveRun(repo.root, runState("r2", { status: "working" }));
    const lock = path.join(runDir(repo.root, "r2"), "lock");
    mkdirSync(path.dirname(lock), { recursive: true });
    writeFileSync(lock, String(process.pid));      // this test process is alive
    const d = new Daemon(deps());
    d.recover();
    expect(d.running?.id).toBe(j.id);
    saveRun(repo.root, runState("r2", { status: "pr_open", prUrl: "u2" }));
    rmSync(lock);
    await d.idle();
    expect(listJobs(home)[0]).toMatchObject({ status: "done", result: "u2" });
  });

  it("keeps state in daemon-state.json", () => {
    writeState(home, { lastFired: { k: "2026-10-01T00:00:00.000Z" }, pauseUntil: "2026-10-01T01:00:00.000Z" });
    expect(readState(home)).toMatchObject({ lastFired: { k: "2026-10-01T00:00:00.000Z" }, pauseUntil: "2026-10-01T01:00:00.000Z" });
  });
});
