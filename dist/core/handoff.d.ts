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
    memory: {
        topic: string;
        key: string;
        value: string;
        pinned: boolean;
    }[];
    git: {
        branch: string;
        lastCommits: string[];
        status: string;
        diffStat: string;
    };
}
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
