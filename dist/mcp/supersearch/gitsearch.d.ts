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
/** Commits whose diffs touched `query` (pickaxe) */
export declare function searchHistory(cwd: string, query: string, maxResults?: number): HistoryMatch[];
/** Who last touched each line of a file */
export declare function blameFile(cwd: string, file: string, maxLines?: number): BlameLine[];
export declare function isGitRepo(cwd: string): boolean;
