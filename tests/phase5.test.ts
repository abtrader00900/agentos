import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { sync } from "../src/commands/sync.js";
import { learnFromHistory, applyLearnedRules } from "../src/commands/learn.js";

let dir: string;

function git(args: string[]) {
  return execFileSync("git", args, {
    cwd: dir,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
      GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    },
  });
}

function commit(files: Record<string, string>, msg: string) {
  for (const [p, content] of Object.entries(files)) {
    const abs = path.join(dir, p);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  git(["add", "-A"]);
  git(["commit", "-qm", msg]);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agentos-p5-"));
  writeFileSync(
    path.join(dir, "agent.config.yaml"),
    `project: { name: p5 }
rules:
  - id: all-rule
    text: everyone sees this
  - id: cursor-only
    text: cursor specific
    harnesses: [cursor]
`,
  );
  git(["init", "-q"]);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Phase 5 harness targets (FR-1.8)", () => {
  it("generates Cursor .mdc rule file", () => {
    sync({ cwd: dir, quiet: true });
    const mdc = readFileSync(path.join(dir, ".cursor/rules/agentos.mdc"), "utf8");
    expect(mdc).toContain("description:");
    expect(mdc).toContain("alwaysApply: true");
    expect(mdc).toContain("all-rule");
    expect(mdc).toContain("cursor specific");
  });

  it("generates Windsurf rules file", () => {
    sync({ cwd: dir, quiet: true });
    const md = readFileSync(path.join(dir, ".windsurf/rules/agentos.md"), "utf8");
    expect(md).toContain("all-rule");
    expect(md).toContain("Local Tools (AgentOS)");
  });

  it("cursor-only rule does not leak into windsurf config", () => {
    sync({ cwd: dir, quiet: true });
    const md = readFileSync(path.join(dir, ".windsurf/rules/agentos.md"), "utf8");
    expect(md).not.toContain("cursor specific");
  });

  it("sync --only cursor generates just the cursor file", () => {
    sync({ cwd: dir, quiet: true, only: ["cursor"] });
    expect(existsSync(path.join(dir, ".cursor/rules/agentos.mdc"))).toBe(true);
    expect(existsSync(path.join(dir, "CLAUDE.md"))).toBe(false);
  });
});

describe("agentos learn (auto-improvement loop)", () => {
  it("detects co-changing file pairs from git history", () => {
    for (let i = 0; i < 4; i++) {
      commit(
        { "src/a.ts": `export const a = ${i};`, "src/b.ts": `export const b = ${i};` },
        `change ${i}`,
      );
    }
    const result = learnFromHistory(dir);
    expect(result.commitCount).toBe(4);
    const cochange = result.rules.find((r) => r.id.startsWith("learned-cochange-"));
    expect(cochange).toBeDefined();
    expect(cochange!.text).toContain("src/a.ts");
    expect(cochange!.text).toContain("4 commits");
  });

  it("detects hot files", () => {
    for (let i = 0; i < 6; i++) {
      commit({ "src/hot.ts": `export const h = ${i};`, "src/once.ts": `export const o = ${i};` }, `c${i}`);
    }
    const result = learnFromHistory(dir);
    const hot = result.rules.find((r) => r.id.startsWith("learned-hot-"));
    expect(hot).toBeDefined();
    expect(hot!.text).toContain("src/hot.ts");
  });

  it("apply writes to agent.config.local.yaml without touching project config (review-then-promote)", () => {
    for (let i = 0; i < 4; i++) {
      commit({ "src/x.ts": `export const x = ${i};`, "src/y.ts": `export const y = ${i};` }, `c${i}`);
    }
    const result = learnFromHistory(dir);
    const n = applyLearnedRules(dir, result.rules);
    expect(n).toBeGreaterThan(0);

    const local = readFileSync(path.join(dir, "agent.config.local.yaml"), "utf8");
    expect(local).toContain("learned-");
    // project config untouched
    expect(readFileSync(path.join(dir, "agent.config.yaml"), "utf8")).not.toContain("learned-");

    // second apply is idempotent
    expect(applyLearnedRules(dir, result.rules)).toBe(0);
  });

  it("handles repos with no history", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "agentos-empty-"));
    git(["init", "-q", empty]);
    const result = learnFromHistory(empty);
    expect(result.commitCount).toBe(0);
    expect(result.rules).toHaveLength(0);
    rmSync(empty, { recursive: true, force: true });
  });
});
