import { spawnSync } from "node:child_process";
const GIT_ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: "agentos",
    GIT_AUTHOR_EMAIL: "agentos@local",
    GIT_COMMITTER_NAME: "agentos",
    GIT_COMMITTER_EMAIL: "agentos@local",
};
/** LLM-supplied counts end up in git argv — keep them positive integers within a sane bound */
const clampInt = (n, dflt, max) => Number.isFinite(n) ? Math.min(max, Math.max(1, Math.floor(n))) : dflt;
function git(args, cwd) {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, maxBuffer: 16 * 1024 * 1024 });
    return { ok: r.status === 0, stdout: r.stdout ?? "" };
}
/** Commits whose diffs touched `query` (pickaxe) */
export function searchHistory(cwd, query, maxResults = 20) {
    if (!query.trim())
        return [];
    const { ok, stdout } = git(["log", `-S${query}`, "--format=%h|%ad|%an|%s", "--date=short", `-${clampInt(maxResults, 20, 500)}`], cwd);
    if (!ok)
        return [];
    return stdout
        .split("\n")
        .filter(Boolean)
        .map((l) => {
        const [commit, date, author, ...rest] = l.split("|");
        return { commit, date, author, message: rest.join("|") };
    });
}
/** Who last touched each line of a file */
export function blameFile(cwd, file, maxLines = 200) {
    const limit = clampInt(maxLines, 200, 5000);
    const { ok, stdout } = git(["blame", "--line-porcelain", "--", file], cwd);
    if (!ok)
        return [];
    const lines = stdout.split("\n");
    const out = [];
    let current = {};
    for (const l of lines) {
        if (out.length >= limit)
            break;
        const header = l.match(/^([0-9a-f]{40}) \d+ (\d+)( \d+)?$/);
        if (header) {
            current = { commit: header[1].slice(0, 12), line: parseInt(header[2], 10) };
            continue;
        }
        if (l.startsWith("author "))
            current.author = l.slice(7);
        else if (l.startsWith("author-time ")) {
            current.date = new Date(parseInt(l.slice(12), 10) * 1000).toISOString().slice(0, 10);
        }
        else if (l.startsWith("\t")) {
            out.push({ commit: current.commit, author: current.author ?? "?", date: current.date ?? "", line: current.line ?? 0, content: l.slice(1).slice(0, 300) });
            current = {};
        }
    }
    return out;
}
export function isGitRepo(cwd) {
    return git(["rev-parse", "--is-inside-work-tree"], cwd).ok;
}
//# sourceMappingURL=gitsearch.js.map