export declare function git(cwd: string, args: string[]): string;
export declare function tryGit(cwd: string, args: string[]): {
    ok: boolean;
    out: string;
};
export declare const head: (cwd: string) => string;
/** origin's default branch when git knows it, else the current branch */
export declare function defaultBranch(root: string): string;
/** porcelain status ("" = clean) */
export declare const statusOf: (cwd: string) => string;
/** add a pattern to .git/info/exclude: ignored locally, the committed .gitignore stays untouched */
export declare function ensureExcluded(root: string, pattern: string): void;
/** create a worktree at dir on branch (new from `from`, or existing); an existing worktree is reused on resume */
export declare function addWorktree(root: string, dir: string, branch: string, from: string): void;
/**
 * Link installed dependency folders (node_modules, vendor) from the checkout into a worktree, so
 * verify commands run without a fresh install. Junctions on Windows need no admin rights. The links
 * are excluded from git so commitAll never commits them.
 */
export declare function linkDeps(root: string, dir: string, links: string[]): void;
/** stage and commit everything; false when there was nothing to commit */
export declare function commitAll(cwd: string, message: string): boolean;
/** merge ref into the worktree at cwd; on conflict the merge is left in progress for a fixer */
export declare function mergeBranch(cwd: string, ref: string, message: string): {
    ok: boolean;
    conflicts: string[];
};
export declare const mergeInProgress: (cwd: string) => boolean;
export declare function abortMerge(cwd: string): void;
/**
 * Remove a worktree. The dependency links go first: `git worktree remove --force`
 * would otherwise follow a junction and delete the checkout's real node_modules.
 */
export declare function removeWorktree(root: string, dir: string, links: string[]): void;
