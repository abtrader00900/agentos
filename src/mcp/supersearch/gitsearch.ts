import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * FR-4.3/4.4: git history search — "yeh line/cheez kis ne kab change ki".
 * Pure local git, zero network.
 */

export interface HistoryMatch {
  commit: string;
  date: string;
  author: string;
  message: string;
}

export interface BlameLine {
  commit: string;
  author: string;
  date: string;
  line: number;
  content: string;
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "agentos",
  GIT_AUTHOR_EMAIL: "agentos@local",
  GIT_COMMITTER_NAME: "agentos",
  GIT_COMMITTER_EMAIL: "agentos@local",
};

/** LLM-supplied counts end up in git argv — keep them positive integers within a sane bound */
const clampInt = (n: number | undefined, dflt: number, max: number): number =>
  Number.isFinite(n) ? Math.min(max, Math.max(1, Math.floor(n as number))) : dflt;

function git(args: string[], cwd: string): { ok: boolean; stdout: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, maxBuffer: 16 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: r.stdout ?? "" };
}

/** Commits whose diffs touched `query` (pickaxe) */
export function searchHistory(cwd: string, query: string, maxResults = 20): HistoryMatch[] {
  if (!query.trim()) return [];
  const { ok, stdout } = git(
    ["log", `-S${query}`, "--format=%h|%ad|%an|%s", "--date=short", `-${clampInt(maxResults, 20, 500)}`],
    cwd,
  );
  if (!ok) return [];
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [commit, date, author, ...rest] = l.split("|");
      return { commit, date, author, message: rest.join("|") };
    });
}

/** Who last touched each line of a file */
export function blameFile(cwd: string, file: string, maxLines = 200): BlameLine[] {
  const limit = clampInt(maxLines, 200, 5000);
  // Ask git for only the lines we return: whole-file porcelain of a 50k-line file
  // overflows maxBuffer and came back as "no blame info" after 10+ seconds.
  // -L past the end of the file is an error, so clamp to the file's length.
  let range: string[] = [];
  try {
    const text = readFileSync(path.join(cwd, file), "utf8");
    const count = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    if (count < 1) return [];
    range = ["-L", `1,${Math.min(limit, count)}`];
  } catch { /* not in the working tree: let git decide */ }
  const { ok, stdout } = git(["blame", "--line-porcelain", ...range, "--", file], cwd);
  if (!ok) return [];
  const lines = stdout.split("\n");
  const out: BlameLine[] = [];
  let current: Partial<BlameLine> & { time?: number } = {};
  for (const l of lines) {
    if (out.length >= limit) break;
    const header = l.match(/^([0-9a-f]{40}) \d+ (\d+)( \d+)?$/);
    if (header) {
      current = { commit: header[1].slice(0, 12), line: parseInt(header[2], 10) };
      continue;
    }
    if (l.startsWith("author ")) current.author = l.slice(7);
    else if (l.startsWith("author-time ")) current.time = parseInt(l.slice(12), 10);
    else if (l.startsWith("author-tz ")) {
      // the author's own calendar date, like `git log --date=short` in supersearch_history
      const m = l.slice(10).match(/^([+-])(\d\d)(\d\d)$/);
      const offset = m ? (m[1] === "-" ? -1 : 1) * (parseInt(m[2], 10) * 3600 + parseInt(m[3], 10) * 60) : 0;
      if (current.time !== undefined) current.date = new Date((current.time + offset) * 1000).toISOString().slice(0, 10);
    } else if (l.startsWith("\t")) {
      out.push({ commit: current.commit!, author: current.author ?? "?", date: current.date ?? "", line: current.line ?? 0, content: l.slice(1).replace(/\r$/, "").slice(0, 300) });
      current = {};
    }
  }
  return out;
}

export function isGitRepo(cwd: string): boolean {
  return git(["rev-parse", "--is-inside-work-tree"], cwd).ok;
}
