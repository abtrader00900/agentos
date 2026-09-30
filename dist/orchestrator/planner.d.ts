import type { AgentName, Plan, Runner } from "./types.js";
export interface PlannerInput {
    task: string;
    /** relevant project memory, "[topic/key] value" */
    facts: string[];
    files: string[];
    workers: AgentName[];
    /** lessons block from earlier runs ("" = none) */
    notes?: string;
}
export declare function plannerPrompt(input: PlannerInput): string;
/** the JSON object in an agent's reply: first "{" to last "}" */
export declare function extractJson(text: string): unknown;
/** Ask for a plan; one retry that quotes the validation error. */
export declare function makePlan(runner: Runner, input: PlannerInput, cwd: string, timeoutMs: number): Promise<{
    plan?: Plan;
    error?: string;
    rateLimited?: boolean;
    rejected?: string;
}>;
