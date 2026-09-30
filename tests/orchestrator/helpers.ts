import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// commits made by tests (and by the engine under test) need an identity
for (const [k, v] of Object.entries({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" })) {
  process.env[k] ??= v;
}

export const sh = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** a repo on branch main with one commit, pushed to a bare "origin" beside it */
export function makeRepo(files: Record<string, string> = {}) {
  const tmp = mkdtempSync(path.join(tmpdir(), "agentos-orch-"));
  const root = path.join(tmp, "repo");
  const remote = path.join(tmp, "remote.git");
  sh(tmp, ["init", "-q", "--bare", "-b", "main", remote]);
  mkdirSync(root);
  sh(root, ["init", "-q", "-b", "main"]);
  // no .gitignore for .agentos: the engine itself must keep its files out of `git status`
  const all: Record<string, string> = { "README.md": "# test\n", ...files };
  for (const [p, c] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    writeFileSync(path.join(root, p), c);
  }
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-qm", "first"]);
  sh(root, ["remote", "add", "origin", remote]);
  sh(root, ["push", "-q", "-u", "origin", "main"]);
  return { tmp, root, remote, cleanup: () => rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }) };
}
