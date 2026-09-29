/**
 * FR-7.x: Handoff Protocol.
 * Bundle = versioned JSON + human-readable markdown summary.
 * Captures: memory snapshot, task state, pending decisions, git state.
 */
export interface HandoffInput {
    task: string;
    filesInProgress: string[];
    pendingDecisions: string[];
    openQuestions: string[];
    fromHarness?: string;
    toHarness?: string;
    /** free-form notes */
    notes?: string;
}
export interface HandoffBundle {
    format: "agentos-handoff";
    version: 1;
    createdAt: string;
    fromHarness: string;
    toHarness: string;
    task: string;
    filesInProgress: string[];
    pendingDecisions: string[];
    openQuestions: string[];
    notes: string;
    /** updatedAt: absent in bundles written before 0.2.2 */
    memory: {
        topic: string;
        key: string;
        value: string;
        pinned: boolean;
        updatedAt?: string;
    }[];
    /** head: the full commit the handoff was written at ("" before 0.2.2 or outside git) */
    git: {
        branch: string;
        head: string;
        lastCommits: string[];
        status: string;
        diffStat: string;
    };
}
export declare function gitCapture(cwd: string, args: string[]): string;
export declare function collectGitState(cwd: string): HandoffBundle["git"];
export declare function exportHandoff(cwd: string, input: HandoffInput): HandoffBundle;
export declare function bundleToMarkdown(bundle: HandoffBundle): string;
/** FR-7.1/7.2: write bundle to .agentos/handoffs/<ts>/ (+ HANDOFF.md at project root) */
export declare function writeHandoff(cwd: string, bundle: HandoffBundle): {
    dir: string;
    rootMd: string;
};
export declare function latestHandoffDir(cwd: string): string | null;
export declare function importHandoff(bundlePath: string): HandoffBundle;
export declare const HANDOFF_FIX = "Finished? Run: agentos handoff --clear, then agentos sync. Still in progress? Write a fresh one: agentos handoff --task \"...\"";
/**
 * Staleness of the handoff sync injects into every rule file (the root HANDOFF.md): days since
 * it was written and commits since its HEAD. Nobody refreshed the ERP's, and it kept telling
 * every new chat to do work finished days earlier. null when there is no HANDOFF.md.
 */
export declare function handoffStaleness(cwd: string, limits: {
    handoffDays: number;
    handoffCommits: number;
}): {
    stale: boolean;
    detail: string;
} | null;
/** Stop injecting a finished handoff. Its bundle (and markdown copy) stay in .agentos/handoffs/. */
export declare function clearHandoff(cwd: string): boolean;
