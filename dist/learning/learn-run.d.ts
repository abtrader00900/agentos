import type { LearningConfig } from "../core/schema.js";
import type { AgentName, Runner } from "../orchestrator/types.js";
/**
 * Learn from one finished run. It never throws: the outcome lands in state.learned and the event log.
 * budgetMs is one deadline for every agent call it makes (the retrospective, its retry, the skill draft).
 */
export declare function learnFromRun(root: string, runId: string, learning: LearningConfig, runners: Record<AgentName, {
    read: Runner;
    write: Runner;
}>, budgetMs: number, now?: () => number): Promise<"done" | "skipped" | "failed">;
