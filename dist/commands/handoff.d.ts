/** FR-2.5 / FR-7.x: agentos handoff */
export interface HandoffOptions {
    cwd?: string;
    to?: string;
    from?: string;
    task?: string;
    files?: string;
    decisions?: string;
    questions?: string;
    notes?: string;
}
export declare function handoff(options?: HandoffOptions): void;
export declare function handoffShow(options?: {
    cwd?: string;
}): void;
export declare function detectHarness(cwd: string): string;
