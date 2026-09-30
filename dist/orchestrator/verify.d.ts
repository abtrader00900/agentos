import type { Finding } from "./types.js";
/** Run the configured commands through the shell, in order, stopping at the first failure. */
export declare function runVerify(cwd: string, commands: string[], timeoutMs: number): {
    ok: boolean;
    output: string;
};
/** The findings array that ends the reviewer's reply; null when there is none. */
export declare function parseFindings(text: string): Finding[] | null;
export declare const blocking: (findings: Finding[]) => Finding[];
export declare function reviewPrompt(task: string, diff: string, notes?: string): string;
