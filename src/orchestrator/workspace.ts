import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, mkdirSync, lstatSync, unlinkSync, rmdirSync, symlinkSync } from "node:fs";
import path from "node:path";

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();
}

export function tryGit(cwd: string, args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: git(cwd, args) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}`.trim() || err.message };
  }
}

export const head = (cwd: string) => git(cwd, ["rev-parse", "HEAD"]);

/** origin's default branch when git knows it, else the current branch */
export function defaultBranch(root: string): string {
  const r = tryGit(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  return r.ok && r.out ? r.out.replace(/^origin\//, "") : git(root, ["branch", "--show-current"]);
}

/** porcelain status ("" = clean) */
export const statusOf = (cwd: string) => git(cwd, ["status", "--porcelain"]);

/** add a pattern to .git/info/exclude: ignored locally, the committed .gitignore stays untouched */
export function ensureExcluded(root: string, pattern: string): void {
  const file = path.join(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "info", "exclude");
  mkdirSync(path.dirname(file), { recursive: true });
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (text.split(/\r?\n/).includes(pattern)) return;
  appendFileSync(file, `${text && !text.endsWith("\n") ? "\n" : ""}${pattern}\n`);
}

/** create a worktree at dir on branch (new from `from`, or existing); an existing worktree is reused on resume */
export function addWorktree(root: string, dir: string, branch: string, from: string): void {
  if (existsSync(path.join(dir, ".git"))) return;
  const exists = tryGit(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).ok;
  git(root, exists ? ["worktree", "add", dir, branch] : ["worktree", "add", "-b", branch, dir, from]);
}

/**
 * Link installed dependency folders (node_modules, vendor) from the checkout into a worktree, so
 * verify commands run without a fresh install. Junctions on Windows need no admin rights. The links
 * are excluded from git so commitAll never commits them.
 */
export function linkDeps(root: string, dir: string, links: string[]): void {
  for (const rel of links) {
    const target = path.join(root, rel);
    const at = path.join(dir, rel);
    if (!existsSync(target) || existsSync(at)) continue;
    ensureExcluded(root, `/${rel.replace(/\\/g, "/")}`);
    mkdirSync(path.dirname(at), { recursive: true });
    symlinkSync(target, at, "junction");
  }
}

/** stage and commit everything; false when there was nothing to commit */
export function commitAll(cwd: string, message: string): boolean {
  git(cwd, ["add", "-A"]);
  if (tryGit(cwd, ["diff", "--cached", "--quiet"]).ok) return false;
  git(cwd, ["commit", "-q", "-m", message]);
  return true;
}

/** merge ref into the worktree at cwd; on conflict the merge is left in progress for a fixer */
export function mergeBranch(cwd: string, ref: string, message: string): { ok: boolean; conflicts: string[] } {
  if (tryGit(cwd, ["merge", "--no-ff", "-m", message, ref]).ok) return { ok: true, conflicts: [] };
  const conflicts = tryGit(cwd, ["diff", "--name-only", "--diff-filter=U"]).out.split("\n").filter(Boolean);
  return { ok: false, conflicts };
}

export const mergeInProgress = (cwd: string) => tryGit(cwd, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).ok;

export function abortMerge(cwd: string): void {
  tryGit(cwd, ["merge", "--abort"]);
}

/**
 * Remove a worktree. The dependency links go first: `git worktree remove --force`
 * would otherwise follow a junction and delete the checkout's real node_modules.
 */
export function removeWorktree(root: string, dir: string, links: string[]): void {
  for (const rel of links) {
    const at = path.join(dir, rel);
    try {
      if (!lstatSync(at).isSymbolicLink()) continue;
    } catch {
      continue;
    }
    try { unlinkSync(at); } catch { rmdirSync(at); }
  }
  tryGit(root, ["worktree", "remove", "--force", dir]);
  tryGit(root, ["worktree", "prune"]);
}
