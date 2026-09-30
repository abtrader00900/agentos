// tests/ui/live.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { startTestServer, TOKEN } from "./helpers.js";
import { makeRepo } from "../orchestrator/helpers.js";
import { registerProject } from "../../src/ui/projects.js";
import { saveRun, logEvent, type RunState } from "../../src/orchestrator/run.js";

let t: Awaited<ReturnType<typeof startTestServer>>;
let repo: ReturnType<typeof makeRepo>;
let pid: string;
const run = (id: string): RunState => ({ id, task: "t", status: "working", baseBranch: "main", base: "x", branch: `agentos/run-${id}`, runWorktree: "", createdAt: new Date().toISOString(), updatedAt: "", subtasks: [], fixRound: 0, findings: [] });

/** open the SSE stream and collect frames until `until` says stop, or 5 s pass */
function stream(p: string, headers: Record<string, string>, until: (text: string) => boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    const r = http.get({ host: "127.0.0.1", port: t.port, path: p, headers: { host: `127.0.0.1:${t.port}`, cookie: `agentos_ui=${TOKEN}`, ...headers } }, (res) => {
      expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
      res.setEncoding("utf8");
      res.on("data", (d) => { text += d; if (until(text)) { r.destroy(); resolve(text); } });
    });
    r.on("error", (e) => (text ? resolve(text) : reject(e)));
    setTimeout(() => { r.destroy(); resolve(text); }, 5000);
  });
}

beforeEach(async () => {
  t = await startTestServer();
  repo = makeRepo();
  pid = registerProject(repo.root, t.home).id;
  saveRun(repo.root, run("s1"));
  logEvent(repo.root, "s1", { type: "status", status: "planning" });
  logEvent(repo.root, "s1", { type: "status", status: "working" });
});
afterEach(async () => { await t.close(); repo.cleanup(); });

describe("live events", () => {
  it("sends existing lines with ids, then lines appended later", async () => {
    setTimeout(() => logEvent(repo.root, "s1", { type: "status", status: "verifying" }), 800);
    const text = await stream(`/api/p/${pid}/runs/s1/events`, {}, (s) => s.includes("verifying"));
    expect(text).toMatch(/id: 1\ndata: .*planning/);
    expect(text).toMatch(/id: 2\ndata: .*"working"/);
    expect(text).toMatch(/id: 3\ndata: .*verifying/);
  });

  it("resumes after since= or Last-Event-ID", async () => {
    const a = await stream(`/api/p/${pid}/runs/s1/events?since=1`, {}, (s) => s.includes("id: 2"));
    expect(a).not.toContain("id: 1\n");
    const b = await stream(`/api/p/${pid}/runs/s1/events`, { "last-event-id": "2" }, (s) => s.length > 0);
    expect(b).not.toContain("id: 2\n");
  });

  it("restarts at id 1 when the event log shrinks", async () => {
    setTimeout(() => writeFileSync(path.join(repo.root, ".agentos", "runs", "s1", "events.jsonl"), '{"type":"new"}\n'), 800);
    const text = await stream(`/api/p/${pid}/runs/s1/events`, {}, (s) => s.includes('data: {"type":"new"}'));
    expect(text).toContain('id: 1\ndata: {"type":"new"}');
  });

  it("404s for an unknown run", async () => {
    const status = await new Promise<number>((r) => http.get({ host: "127.0.0.1", port: t.port, path: `/api/p/${pid}/runs/zzz/events`, headers: { host: `127.0.0.1:${t.port}`, cookie: `agentos_ui=${TOKEN}` } }, (res) => { r(res.statusCode!); res.resume(); }));
    expect(status).toBe(404);
  });

  it("404s an unreadable run without opening a stream", async () => {
    const dir = path.join(repo.root, ".agentos", "runs", "bad");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "state.json"), JSON.stringify({ id: "bad", status: "working" }));
    const out = await new Promise<{ status: number; body: string }>((resolve) => http.get({ host: "127.0.0.1", port: t.port, path: `/api/p/${pid}/runs/bad/events`, headers: { host: `127.0.0.1:${t.port}`, cookie: `agentos_ui=${TOKEN}` } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode!, body }));
    }));
    expect(out).toEqual({ status: 404, body: JSON.stringify({ error: "unreadable run" }) });
  });
});
