import type { LearningConfig } from "../core/schema.js";
import type { AgentName, Runner } from "../orchestrator/types.js";
/** Learn from one finished run. It never throws: the outcome lands in state.learned and the event log. */
export declare function learnFromRun(root: string, runId: string, learning: LearningConfig, runners: Record<AgentName, {
    read: Runner;
    write: Runner;
}>, timeoutMs: number): Promise<"done" | "skipped" | "failed">;
