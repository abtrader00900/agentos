import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { makeRepo } from "../orchestrator/helpers.js";
import { queueCommand } from "../../src/commands/daemon.js";
import { listJobs } from "../../src/daemon/queue.js";

let repo: ReturnType<typeof makeRepo>;
let out: string[];
beforeEach(() => {
  repo = makeRepo({ "agent.config.yaml": "project: { name: t }\ndaemon: { enabled: true }\n" });
  out = [];
  vi.spyOn(console, "log").mockImplementation((s: string) => { out.push(String(s)); });
});
afterEach(() => { vi.restoreAllMocks(); repo.cleanup(); });

describe("agentos queue", () => {
  it("adds a job for the project in the current folder, then lists and removes it", () => {
    queueCommand("add", ["add", "a", "report"], { cwd: repo.root, quick: true });
    const [job] = listJobs();
    expect(job).toMatchObject({ task: "add a report", quick: true, source: "manual", status: "queued" });
    queueCommand("list", [], { cwd: repo.root });
    expect(out.join("\n")).toContain(job.id);
    queueCommand("remove", [job.id], { cwd: repo.root });
    expect(listJobs()[0].status).toBe("removed");
  });

  it("refuses a project that has not turned the daemon on", () => {
    writeFileSync(path.join(repo.root, "agent.config.yaml"), "project: { name: t }\n");
    expect(() => queueCommand("add", ["x", "y", "z"], { cwd: repo.root })).toThrow(/daemon: \{ enabled: true \}/);
  });
});
