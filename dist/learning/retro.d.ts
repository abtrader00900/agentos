import type { Runner } from "../orchestrator/types.js";
import { type Evidence } from "./evidence.js";
import type { Lesson, Role } from "./lessons.js";
export interface RetroInput {
    task: string;
    planSummary: string;
    status: string;
    evidence: Evidence[];
    existing: Lesson[];
    /** kinds earlier runs got, most recent first */
    kinds: string[];
}
export interface RetroResult {
    kind: string;
    lessons: Array<{
        text: string;
        roles: Role[];
        evidence: string[];
        sameAs?: string;
    }>;
}
export declare function retroPrompt(input: RetroInput): string;
export declare function retrospective(runner: Runner, input: RetroInput, cwd: string, timeoutMs: number): Promise<{
    result?: RetroResult;
    error?: string;
    rateLimited?: boolean;
}>;
