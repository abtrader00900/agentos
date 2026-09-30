import { type RunState } from "../orchestrator/run.js";
import type { Runner } from "../orchestrator/types.js";
export declare const draftsDir: (root: string) => string;
/** the kind's successful runs when a skill should be drafted now, else null */
export declare function skillDue(root: string, kind: string, after: number): RunState[] | null;
/** Ask the agent for a draft, then keep it only if it validates and passes the safety filter. Never installs. */
export declare function draftSkill(root: string, kind: string, runs: RunState[], runner: Runner, timeoutMs: number): Promise<{
    ok: boolean;
    reason?: string;
}>;
export declare function listDrafts(root: string): Array<{
    kind: string;
    description: string;
}>;
/** The full SKILL.md of a draft; throws when there is none. */
export declare function readDraft(root: string, kind: string): string;
/** Install a draft as a project skill (the owner's approval) and remove the draft. Returns the installed SKILL.md. */
export declare function approveDraft(root: string, kind: string): string;
export declare function rejectDraft(root: string, kind: string): boolean;
