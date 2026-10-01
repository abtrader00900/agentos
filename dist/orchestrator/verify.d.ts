import type { Finding } from "./types.js";
/** a long text cut to its head and tail: the error message sits at the top, the summary at the bottom */
export declare function excerpt(text: string, max?: number): string;
/** Run the configured commands through the shell, in order, stopping at the first failure. */
export declare function runVerify(cwd: string, commands: string[], timeoutMs: number): Promise<{
    ok: boolean;
    output: string;
}>;
/** The findings array that ends the reviewer's reply; null when there is none. */
export declare function parseFindings(text: string): Finding[] | null;
export declare const blocking: (findings: Finding[]) => Finding[];
export declare function reviewPrompt(task: string, diff: string, notes?: string): string;
/**
 * The review after a fix round: the earlier findings plus only the fixer's diff, so the reviewer
 * checks the fix instead of re-reading the whole change (and finding new nits in it) every round.
 */
export declare function reReviewPrompt(task: string, earlier: Finding[], fixDiff: string, base: string, notes?: string): string;
