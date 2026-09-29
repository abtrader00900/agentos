/** FR-2.5 / FR-7.x: agentos handoff */
export interface HandoffOptions {
    cwd?: string;
    to?: string;
    from?: string;
    task?: string;
    /** a string or repeated flags; each value is split on , ; and newlines */
    files?: string | string[];
    /** decisions and questions are sentences: split on ; and newlines only — a comma stays inside an item */
    decisions?: string | string[];
    questions?: string | string[];
    notes?: string;
    /** remove HANDOFF.md so sync stops injecting it */
    clear?: boolean;
}
export declare function handoff(options?: HandoffOptions): void;
export declare function handoffShow(options?: {
    cwd?: string;
}): void;
/**
 * Which harness is running this command, from the environment it gives its shell.
 * (The old "newest marker file" guess always answered whichever file sync wrote last.)
 */
export declare function detectHarness(env?: NodeJS.ProcessEnv): string;
