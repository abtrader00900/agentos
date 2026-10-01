import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { startTestServer, req, post } from "./helpers.js";
import { makeRepo } from "../orchestrator/helpers.js";
import { registerProject } from "../../src/ui/projects.js";
import { listJobs, updateJob } from "../../src/daemon/queue.js";

let t: Awaited<ReturnType<typeof startTestServer>>;
let repo: ReturnType<typeof makeRepo>;
let pid: string;
const del = (p: string) => req(t.port, { method: "DELETE", path: p, body: "{}", headers: { origin: `http://127.0.0.1:${t.port}`, "content-type": "application/json" } });

beforeEach(async () => {
  t = await startTestServer();
  repo = makeRepo({ "agent.config.yaml": "project: { name: t }\ndaemon: { enabled: true }\n" });
  pid = registerProject(repo.root, t.home)!.id;
});
afterEach(async () => { await t.close(); repo.cleanup(); });

describe("queue API", () => {
  it("adds a job for a registered project and lists it newest first with the project name", async () => {
    const r = await post(t.port, "/api/queue", { projectId: pid, task: "add a report", quick: true });
    expect(r.status).toBe(201);
    const { id } = JSON.parse(r.body);
    const list = JSON.parse((await req(t.port, { path: "/api/queue" })).body);
    expect(list[0]).toMatchObject({ id, task: "add a report", quick: true, status: "queued", source: "manual", project: repo.root.split(/[\\/]/).pop() });
  });

  it("validates the body and refuses a project without the daemon on", async () => {
    expect((await post(t.port, "/api/queue", { projectId: pid, task: "x" })).status).toBe(400);
    expect((await post(t.port, "/api/queue", { projectId: pid, task: "fine task", quick: "yes" })).status).toBe(400);
    expect((await post(t.port, "/api/queue", { projectId: "nope-0000", task: "fine task" })).status).toBe(404);
    writeFileSync(path.join(repo.root, "agent.config.yaml"), "project: { name: t }\n");
    const off = await post(t.port, "/api/queue", { projectId: pid, task: "fine task" });
    expect(off.status).toBe(409);
    expect(JSON.parse(off.body).error).toContain("daemon");
  });

  it("removes a queued job only", async () => {
    const { id } = JSON.parse((await post(t.port, "/api/queue", { projectId: pid, task: "add a report" })).body);
    expect((await del(`/api/queue/${id}`)).status).toBe(200);
    expect(listJobs(t.home)[0].status).toBe("removed");
    const { id: id2 } = JSON.parse((await post(t.port, "/api/queue", { projectId: pid, task: "another one" })).body);
    updateJob(id2, { status: "running" }, t.home);
    expect((await del(`/api/queue/${id2}`)).status).toBe(409);
    expect((await del("/api/queue/deadbeef")).status).toBe(404);
  });

  it("reports the daemon status", async () => {
    const s = JSON.parse((await req(t.port, { path: "/api/daemon" })).body);
    expect(s).toMatchObject({ running: false, today: 0, maxRunsPerDay: 6 });
  });

  it("needs the token like every other route", async () => {
    expect((await req(t.port, { path: "/api/queue", cookie: false })).status).toBe(401);
  });
});
