// tests/ui/api-actions.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { startTestServer, req, post } from "./helpers.js";
import { makeRepo } from "../orchestrator/helpers.js";
import { registerProject, listProjects } from "../../src/ui/projects.js";
import { saveRun, loadRun, runDir, type RunState } from "../../src/orchestrator/run.js";
import { saveLessons, listLessons } from "../../src/learning/lessons.js";
import { draftsDir } from "../../src/learning/skilldraft.js";
import { runArgs } from "../../src/mcp/orchestrator/server.js";

let t: Awaited<ReturnType<typeof startTestServer>>;
let repo: ReturnType<typeof makeRepo>;
let pid: string;
let spawned: string[][];
let preflightError: string | null;
const run = (id: string, over: Partial<RunState> = {}): RunState => ({ id, task: "t", status: "paused", resumeFrom: "working", baseBranch: "main", base: "x", branch: `agentos/run-${id}`, runWorktree: "", createdAt: new Date().toISOString(), updatedAt: "", subtasks: [], fixRound: 0, findings: [], ...over });

beforeEach(async () => {
  spawned = [];
  preflightError = null;
  t = await startTestServer({
    spawnRun: (root, id, task, quick) => spawned.push(["run", root, id, task, String(!!quick)]),
    spawnResume: (root, id) => spawned.push(["resume", root, id]),
    preflight: () => { if (preflightError) throw new Error(preflightError); },
  });
  repo = makeRepo();
  pid = registerProject(repo.root, t.home)!.id;
});
afterEach(async () => { await t.close(); repo.cleanup(); });

describe("actions API", () => {
  it("starts a run after preflight and returns its id", async () => {
    const r = await post(t.port, `/api/p/${pid}/runs`, { task: "add a profit report" });
    expect(r.status).toBe(201);
    const { id } = JSON.parse(r.body);
    expect(id).toMatch(/^\d{14}-[0-9a-f]{4}$/);
    expect(spawned).toEqual([["run", repo.root, id, "add a profit report", "false"]]);
  });

  it("passes quick through only when asked, and rejects a non-boolean", async () => {
    const q = await post(t.port, `/api/p/${pid}/runs`, { task: "add a profit report", quick: true });
    expect(q.status).toBe(201);
    expect(spawned).toEqual([["run", repo.root, JSON.parse(q.body).id, "add a profit report", "true"]]);

    spawned = [];
    const plain = await post(t.port, `/api/p/${pid}/runs`, { task: "add a profit report" });
    expect(plain.status).toBe(201);
    expect(spawned).toEqual([["run", repo.root, JSON.parse(plain.body).id, "add a profit report", "false"]]);

    spawned = [];
    const bad = await post(t.port, `/api/p/${pid}/runs`, { task: "add a profit report", quick: "yes" });
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body).error).toContain("quick");
    expect(spawned).toEqual([]);
  });

  it("puts --quick before the -- separator, and only when asked", () => {
    const args = runArgs("20260101000000-abcd", "add a profit report", true);
    expect(args.indexOf("--quick")).toBeGreaterThan(-1);
    expect(args.indexOf("--quick")).toBeLessThan(args.indexOf("--"));
    expect(args[args.length - 1]).toBe("add a profit report");
    expect(runArgs("20260101000000-abcd", "add a profit report")).not.toContain("--quick");
  });

  it("puts --onto before the -- separator, and only when asked", () => {
    const args = runArgs("20260101000000-abcd", "fix ci", true, "agentos/run-x");
    expect(args).toEqual(["run", "--id", "20260101000000-abcd", "--quick", "--onto", "agentos/run-x", "--", "fix ci"]);
    expect(runArgs("20260101000000-abcd", "t")).toEqual(["run", "--id", "20260101000000-abcd", "--", "t"]);
  });

  it("rejects a bad task and reports preflight problems without starting anything", async () => {
    expect((await post(t.port, `/api/p/${pid}/runs`, { task: "x" })).status).toBe(400);
    expect((await post(t.port, `/api/p/${pid}/runs`, { task: "y".repeat(2001) })).status).toBe(400);
    preflightError = "Your checkout has uncommitted changes";
    const r = await post(t.port, `/api/p/${pid}/runs`, { task: "add a report" });
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body).error).toContain("uncommitted");
    expect(spawned).toEqual([]);
  });

  it("cancels a paused run and resumes only a resumable one", async () => {
    saveRun(repo.root, run("c1"));
    expect((await post(t.port, `/api/p/${pid}/runs/c1/cancel`, {})).status).toBe(200);
    expect(loadRun(repo.root, "c1").status).toBe("cancelled");
    expect((await post(t.port, `/api/p/${pid}/runs/c1/resume`, {})).status).toBe(409);
    saveRun(repo.root, run("r1"));
    expect((await post(t.port, `/api/p/${pid}/runs/r1/resume`, {})).status).toBe(202);
    expect(spawned).toContainEqual(["resume", repo.root, "r1"]);
    saveRun(repo.root, run("r2"));
    writeFileSync(path.join(runDir(repo.root, "r2"), "lock"), String(process.pid)); // a live engine holds it
    expect((await post(t.port, `/api/p/${pid}/runs/r2/resume`, {})).status).toBe(409);
  });

  it("approves, forgets and promotes lessons", async () => {
    const [k] = saveLessons(repo.root, "x", undefined, [{ text: "Keep Blade views free of queries", roles: ["worker"], evidence: [] }]);
    expect((await post(t.port, `/api/p/${pid}/lessons/${k}/promote`, {})).status).toBe(409); // pending
    expect((await post(t.port, `/api/p/${pid}/lessons/${k}/approve`, {})).status).toBe(200);
    expect(listLessons(repo.root)[0].meta.status).toBe("approved");
    expect((await post(t.port, `/api/p/${pid}/lessons/L-00000000/forget`, {})).status).toBe(404);
  });

  it("approves and rejects skill drafts", async () => {
    const dir = path.join(draftsDir(repo.root), "erp-report");
    mkdirSync(path.join(dir, "test"), { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), "---\nname: erp-report\ndescription: Build an ERP report. Use when a report is requested.\n---\n\n## Workflow\n- a\n\n## Rules\n- b\n");
    expect((await post(t.port, `/api/p/${pid}/drafts/erp-report/approve`, {})).status).toBe(200);
    expect(existsSync(path.join(repo.root, ".agentos", "skills", "erp-report", "SKILL.md"))).toBe(true);
    expect(JSON.parse((await req(t.port, { path: `/api/p/${pid}/drafts` })).body)).toEqual([]);
    const other = path.join(draftsDir(repo.root), "api-endpoint");
    mkdirSync(path.join(other, "test"), { recursive: true });
    writeFileSync(path.join(other, "SKILL.md"), "---\nname: api-endpoint\ndescription: Add an API endpoint. Use when a route is requested.\n---\n\n## Workflow\n- a\n\n## Rules\n- b\n");
    expect((await post(t.port, `/api/p/${pid}/drafts/api-endpoint/reject`, {})).status).toBe(200);
    expect((await post(t.port, `/api/p/${pid}/drafts/never-drafted/reject`, {})).status).toBe(404);
  });

  it("removes a project from the registry without touching its files", async () => {
    const r = await req(t.port, { method: "DELETE", path: `/api/projects/${pid}`, body: "{}", headers: { origin: `http://127.0.0.1:${t.port}`, "content-type": "application/json" } });
    expect(r.status).toBe(200);
    expect(listProjects(t.home)).toEqual([]);
    expect(existsSync(repo.root)).toBe(true);
  });
});
