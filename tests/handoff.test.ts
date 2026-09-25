import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { exportHandoff, writeHandoff, importHandoff, bundleToMarkdown, latestHandoffDir } from "../src/core/handoff.js";
import { MemoryStore } from "../src/mcp/memory/store.js";

let dir: string;

function git(args: string[]) {
  return execFileSync("git", args, {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agentos-ho-"));
  writeFileSync(path.join(dir, "agent.config.yaml"), "project: { name: ho }\n");
  git(["init", "-q"]);
  writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
  git(["add", "-A"]);
  git(["commit", "-qm", "first"]);
  const store = new MemoryStore(path.join(dir, ".agentos", "memory.json"));
  store.store({ topic: "architecture", key: "auth", value: "Sanctum", pinned: true });
  store.close();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("handoff protocol (FR-7.x)", () => {
  it("exports a complete bundle (FR-7.1)", () => {
    const bundle = exportHandoff(dir, {
      task: "Invoice PDF export half-done",
      filesInProgress: ["src/PdfExport.php"],
      pendingDecisions: ["queue vs sync"],
      openQuestions: ["ledger entry?"],
      fromHarness: "claude-code",
      toHarness: "codex",
    });
    expect(bundle.format).toBe("agentos-handoff");
    expect(bundle.version).toBe(1);
    expect(bundle.task).toContain("PDF export");
    expect(bundle.memory).toHaveLength(1);
    expect(bundle.memory[0]).toMatchObject({ topic: "architecture", pinned: true });
    expect(bundle.git.branch).toBeTruthy();
    expect(bundle.git.lastCommits[0]).toContain("first");
  });

  it("roundtrips: write → import (FR-7.2)", () => {
    const bundle = exportHandoff(dir, { task: "t", filesInProgress: [], pendingDecisions: [], openQuestions: [] });
    const { dir: bundleDir } = writeHandoff(dir, bundle);
    const loaded = importHandoff(path.join(bundleDir, "bundle.json"));
    expect(loaded).toEqual(bundle);
    expect(latestHandoffDir(dir)).toBe(bundleDir);
  });

  it("rejects non-handoff JSON", () => {
    writeFileSync(path.join(dir, "fake.json"), JSON.stringify({ hello: 1 }));
    expect(() => importHandoff(path.join(dir, "fake.json"))).toThrow(/Not an agentos handoff/);
  });

  it("markdown rendering includes all sections + machine-readable pointer", () => {
    const bundle = exportHandoff(dir, {
      task: "task body",
      filesInProgress: ["a.ts"],
      pendingDecisions: ["d1"],
      openQuestions: ["q1"],
      notes: "n",
    });
    const md = bundleToMarkdown(bundle);
    for (const section of ["Active Task", "Files In Progress", "Pending Decisions", "Open Questions", "Git State", "Memory Snapshot", "Notes", "bundle.json"]) {
      expect(md).toContain(section);
    }
  });

  it("writes HANDOFF.md at project root for harness injection (FR-7.3)", () => {
    const bundle = exportHandoff(dir, { task: "x", filesInProgress: [], pendingDecisions: [], openQuestions: [] });
    writeHandoff(dir, bundle);
    expect(existsSync(path.join(dir, "HANDOFF.md"))).toBe(true);
    expect(readFileSync(path.join(dir, "HANDOFF.md"), "utf8")).toContain("x");
  });
});
