import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addJob, listJobs, removeJob, updateJob, nextJob, startedOn, queueFile, type Job } from "../../src/daemon/queue.js";

let home: string;
beforeEach(() => { home = realpathSync.native(mkdtempSync(path.join(tmpdir(), "agentos-q-"))); });
const add = (over: Partial<Parameters<typeof addJob>[0]> = {}, at = "2026-10-01T10:00:00Z") =>
  addJob({ projectId: "p-1234", task: "do it", source: "manual", ...over }, home, new Date(at));

describe("job queue", () => {
  it("adds a queued job and keeps it in ~/.agentos/queue.json", () => {
    const j = add()!;
    expect(j).toMatchObject({ projectId: "p-1234", task: "do it", quick: false, source: "manual", status: "queued", addedAt: "2026-10-01T10:00:00.000Z" });
    expect(j.id).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.parse(readFileSync(queueFile(home), "utf8"))).toHaveLength(1);
    expect(listJobs(home)).toEqual([j]);
  });

  it("refuses a second open job with the same dedupe key, but allows it once the first is finished", () => {
    expect(add({ dedupeKey: "ci:p:agentos/run-x" })).toBeDefined();
    expect(add({ dedupeKey: "ci:p:agentos/run-x" })).toBeUndefined();
    updateJob(listJobs(home)[0].id, { status: "done" }, home);
    expect(add({ dedupeKey: "ci:p:agentos/run-x" })).toBeDefined();
  });

  it("removes only queued jobs", () => {
    const a = add()!;
    const b = add()!;
    updateJob(b.id, { status: "running" }, home);
    expect(removeJob(a.id, home)).toBe("removed");
    expect(removeJob(b.id, home)).toBe("not-queued");
    expect(removeJob("deadbeef", home)).toBe("not-found");
    expect(listJobs(home).find((j) => j.id === a.id)!.status).toBe("removed");
  });

  it("picks a paused job before queued ones, then the oldest queued", () => {
    const jobs = [
      { id: "1", status: "queued", addedAt: "2026-10-01T09:00:00Z" },
      { id: "2", status: "queued", addedAt: "2026-10-01T08:00:00Z" },
      { id: "3", status: "paused", addedAt: "2026-10-01T11:00:00Z" },
      { id: "4", status: "done", addedAt: "2026-10-01T07:00:00Z" },
    ] as Job[];
    expect(nextJob(jobs)!.id).toBe("3");
    expect(nextJob(jobs.filter((j) => j.id !== "3"))!.id).toBe("2");
    expect(nextJob([])).toBeUndefined();
  });

  it("counts runs started on a local calendar day", () => {
    const day = new Date(2026, 9, 1, 12);
    const at = (h: number) => new Date(2026, 9, 1, h).toISOString();
    const jobs = [
      { status: "done", startedAt: at(1) },
      { status: "running", startedAt: at(23) },
      { status: "queued" },
      { status: "done", startedAt: new Date(2026, 8, 30, 23).toISOString() },
    ] as Job[];
    expect(startedOn(jobs, day)).toBe(2);
  });

  it("reads a corrupt queue file as empty instead of crashing", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(path.dirname(queueFile(home)), { recursive: true });
    writeFileSync(queueFile(home), "{not json");
    expect(listJobs(home)).toEqual([]);
  });
});
