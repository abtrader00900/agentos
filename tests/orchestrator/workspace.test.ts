import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { makeRepo, sh } from "./helpers.js";
import {
  ensureExcluded, statusOf, addWorktree, commitAll, mergeBranch, linkDeps, removeWorktree, defaultBranch, head,
} from "../../src/orchestrator/workspace.js";

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo.cleanup());

describe("workspace", () => {
  it("hides .agentos/runs from git status, adding the pattern once", () => {
    repo = makeRepo();
    mkdirSync(path.join(repo.root, ".agentos", "runs", "x"), { recursive: true });
    writeFileSync(path.join(repo.root, ".agentos", "runs", "x", "state.json"), "{}");
    expect(statusOf(repo.root)).not.toBe("");
    ensureExcluded(repo.root, "/.agentos/runs/");
    ensureExcluded(repo.root, "/.agentos/runs/");
    expect(statusOf(repo.root)).toBe("");
    const exclude = readFileSync(path.join(repo.root, ".git", "info", "exclude"), "utf8");
    expect(exclude.match(/\/\.agentos\/runs\//g)).toHaveLength(1);
  });

  it("adds a worktree on a new branch and reuses it on resume", () => {
    repo = makeRepo();
    const dir = path.join(repo.tmp, "wt");
    addWorktree(repo.root, dir, "agentos/run-1", head(repo.root));
    addWorktree(repo.root, dir, "agentos/run-1", head(repo.root));
    expect(sh(dir, ["branch", "--show-current"])).toBe("agentos/run-1");
  });

  it("commitAll says whether anything was committed", () => {
    repo = makeRepo();
    expect(commitAll(repo.root, "nothing")).toBe(false);
    writeFileSync(path.join(repo.root, "a.txt"), "a");
    expect(commitAll(repo.root, "add a")).toBe(true);
    expect(statusOf(repo.root)).toBe("");
  });

  it("merges cleanly, or reports the conflicting files", () => {
    repo = makeRepo({ "f.txt": "base\n" });
    const base = head(repo.root);
    const [a, b, run] = ["a", "b", "run"].map((n) => path.join(repo.tmp, n));
    addWorktree(repo.root, a, "br-a", base);
    addWorktree(repo.root, b, "br-b", base);
    writeFileSync(path.join(a, "f.txt"), "from a\n");
    commitAll(a, "a");
    writeFileSync(path.join(b, "f.txt"), "from b\n");
    commitAll(b, "b");
    addWorktree(repo.root, run, "run", base);
    expect(mergeBranch(run, "br-a", "merge a")).toEqual({ ok: true, conflicts: [] });
    expect(mergeBranch(run, "br-b", "merge b")).toEqual({ ok: false, conflicts: ["f.txt"] });
  });

  it("links dependency folders, keeps them out of commits, and removal keeps their targets", () => {
    repo = makeRepo();
    mkdirSync(path.join(repo.root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(path.join(repo.root, "node_modules", "pkg", "index.js"), "x");
    const dir = path.join(repo.tmp, "wt");
    addWorktree(repo.root, dir, "w", head(repo.root));
    linkDeps(repo.root, dir, ["node_modules", "missing-dir"]);
    expect(existsSync(path.join(dir, "node_modules", "pkg", "index.js"))).toBe(true);
    expect(commitAll(dir, "must not commit the link")).toBe(false);
    removeWorktree(repo.root, dir, ["node_modules", "missing-dir"]);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(path.join(repo.root, "node_modules", "pkg", "index.js"))).toBe(true);
  });

  it("falls back to the current branch when origin/HEAD is unknown", () => {
    repo = makeRepo();
    expect(defaultBranch(repo.root)).toBe("main");
  });
});
