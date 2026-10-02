import type { Finding } from "./types.js";
/**
 * Smart gates (PRD 4.5): deterministic checks that tell the owner where a PR needs a human.
 * Pure functions: the engine feeds them git output and agent text.
 */
export interface Change {
    path: string;
    added: number;
    deleted: number;
}
export interface RiskRule {
    name: string;
    action: "flag" | "block";
    paths?: string[];
    deletedLines?: number;
}
export interface RiskFlag {
    rule: string;
    action: "flag" | "block";
    files: string[];
}
export interface AgentReport {
    changed: string[];
    notDone: string[];
    assumed: string[];
    notVerified: string[];
}
/** `**` crosses folders, `*` and `?` stay inside one; everything else is literal */
export declare function globToRegExp(glob: string): RegExp;
/** a glob without a slash names a file anywhere (like .gitignore); one with a slash is anchored at the root */
export declare const matchesGlob: (file: string, glob: string) => boolean;
/** `git diff --numstat --no-renames` lines; binary files ("-") count as 0 */
export declare function parseNumstat(out: string): Change[];
export declare const DEFAULT_RISK: RiskRule[];
/** which rules this change trips, each with the files that tripped it (a big deletion lists the files that lost most) */
export declare function riskFlags(changes: Change[], rules: RiskRule[]): RiskFlag[];
/** Tests weakened to pass: new skip/only markers, deleted test files, fewer assertions. */
export declare function tamperFindings(diff: string, task: string): Finding[];
/** the four parts of an agent's closing report; null when it gave none */
export declare function parseReport(text: string): AgentReport | null;
export declare const REPORT_INSTRUCTIONS: string;
export declare const REVIEW_GATES: string;
