import { spawnSync } from "node:child_process";

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

function git(args: string[], cwd: string): { ok: boolean; stdout: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, maxBuffer: 16 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: r.stdout ?? "" };
}

/** Commits whose diffs touched `query` (pickaxe) */
export function searchHistory(cwd: string, query: string, maxResults = 20): HistoryMatch[] {
  const { ok, stdout } = git(
    ["log", `-S${query}`, "--format=%h|%ad|%an|%s", "--date=short", `-${maxResults}`],
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
  const { ok, stdout } = git(["blame", "--line-porcelain", "--", file], cwd);
  if (!ok) return [];
  const lines = stdout.split("\n");
  const out: BlameLine[] = [];
  let current: Partial<BlameLine> = {};
  for (const l of lines) {
    if (out.length >= maxLines) break;
    const header = l.match(/^([0-9a-f]{40}) \d+ (\d+)( \d+)?$/);
    if (header) {
      current = { commit: header[1].slice(0, 12), line: parseInt(header[2], 10) };
      continue;
    }
    if (l.startsWith("author ")) current.author = l.slice(7);
    else if (l.startsWith("author-time ")) {
      current.date = new Date(parseInt(l.slice(12), 10) * 1000).toISOString().slice(0, 10);
    } else if (l.startsWith("\t")) {
      out.push({ commit: current.commit!, author: current.author ?? "?", date: current.date ?? "", line: current.line ?? 0, content: l.slice(1).slice(0, 300) });
      current = {};
    }
  }
  return out;
}

export function isGitRepo(cwd: string): boolean {
  return git(["rev-parse", "--is-inside-work-tree"], cwd).ok;
}
