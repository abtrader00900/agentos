import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerProject, listProjects, getProject, removeProject, projectId, registryFile } from "../../src/ui/projects.js";
import { makeRepo } from "../orchestrator/helpers.js";
import { run } from "../../src/commands/run.js";

let home: string;
const dirs: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(path.join(tmpdir(), p)); dirs.push(d); return d; };
beforeEach(() => { home = tmp("agentos-home-"); });
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); delete process.env.AGENTOS_HOME; });

describe("project registry", () => {
  it("registers a folder once and lists it", () => {
    const a = tmp("proj-a-");
    registerProject(a, home);
    registerProject(a, home);
    const all = listProjects(home);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ path: path.resolve(a), missing: false, name: path.basename(a) });
    expect(all[0].id).toMatch(/^[a-z0-9-]{1,24}-[0-9a-f]{4}$/);
  });

  it("ids are stable per path and resolve only through the registry", () => {
    const a = tmp("proj-b-");
    expect(projectId(a)).toBe(projectId(a));
    const p = registerProject(a, home);
    expect(getProject(p.id, home)?.path).toBe(path.resolve(a));
    expect(getProject("nope-0000", home)).toBeUndefined();
  });

  it("marks a deleted folder missing; remove drops the entry", () => {
    const a = tmp("proj-c-");
    const p = registerProject(a, home);
    rmSync(a, { recursive: true, force: true });
    expect(listProjects(home)[0].missing).toBe(true);
    expect(removeProject(p.id, home)).toBe(true);
    expect(listProjects(home)).toEqual([]);
    expect(removeProject(p.id, home)).toBe(false);
  });

  it("treats a corrupt registry as empty", () => {
    mkdirSync(path.dirname(registryFile(home)), { recursive: true });
    writeFileSync(registryFile(home), "{not json");
    expect(listProjects(home)).toEqual([]);
    registerProject(tmp("proj-d-"), home);
    expect(JSON.parse(readFileSync(registryFile(home), "utf8"))).toHaveLength(1);
  });

  it("agentos run registers the project it runs in, even when the run itself fails", async () => {
    const repo = makeRepo({ "agent.config.yaml": "project: { name: t }\n" });
    dirs.push(repo.tmp);
    process.env.AGENTOS_HOME = home;
    await expect(run("", { cwd: repo.root, status: "missing-run" })).rejects.toThrow();
    expect(listProjects(home).map((p) => p.path)).toContain(path.resolve(repo.root));
  });
});
