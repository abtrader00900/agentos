import type { LearningConfig } from "../core/schema.js";
import type { AgentName, Runner } from "../orchestrator/types.js";
/**
 * The project's agent allowlist is a hard boundary (PRD 5 §2): learning must not send a run's evidence
 * to an agent the project does not allow. `agents` undefined = no orchestrator block, so nothing to enforce.
 */
export declare function allowedRunners<T>(runners: Partial<Record<AgentName, T>>, agents?: AgentName[]): Partial<Record<AgentName, T>>;
/**
 * Learn from one finished run. It never throws: the outcome lands in state.learned and the event log.
 * budgetMs is one deadline for every agent call it makes (the retrospective, its retry, the skill draft).
 */
export declare function learnFromRun(root: string, runId: string, learning: LearningConfig, runners: Partial<Record<AgentName, {
    read: Runner;
    write: Runner;
}>>, budgetMs: number, now?: () => number): Promise<"done" | "skipped" | "failed">;
