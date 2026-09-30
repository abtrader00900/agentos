import type { Plan } from "./types.js";
/** Kahn's algorithm: ids with dependencies first. Throws on a cycle. */
export declare function topoOrder(plan: Plan): string[];
/**
 * The planner's JSON, checked: schema, unique ids, allowed agents, known
 * dependencies, no cycles, and no two unchained subtasks changing one file
 * (they would run in parallel and conflict).
 */
export declare function validatePlan(raw: unknown, allowedAgents?: readonly string[]): {
    plan?: Plan;
    error?: string;
};
