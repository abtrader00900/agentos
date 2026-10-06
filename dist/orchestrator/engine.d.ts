import type { OrchestratorConfig, LearningConfig } from "../core/schema.js";
import type { AgentName, Runner } from "./types.js";
import { type QuotaStore } from "./quota.js";
import { type RunState } from "./run.js";
import type { Decide, DeciderConfig } from "../decider/client.js";
export interface EngineDeps {
    /** an agent with no runner counts as unavailable, exactly like one at its quota limit */
    runners: Partial<Record<AgentName, {
        read: Runner;
        write: Runner;
    }>>;
    /** when each agent has quota again; the default is the shared file store (~/.agentos/quota.json) */
    quota?: QuotaStore;
    /** the GitHub CLI: returns stdout, throws on failure */
    gh: (cwd: string, args: string[]) => string;
    freeMemMb?: () => number;
    onStatus?: (s: RunState) => void;
    /** PRD 2: lessons in prompts and learning after the run; absent = off */
    learning?: LearningConfig;
    /** called with no argument when learning after the run starts, and with its outcome when it ends */
    onLearning?: (learned?: "done" | "skipped" | "failed") => void;
    /** the optional local decider (PRD 4.5b); absent or null answers = behave as without it */
    decide?: Decide;
    deciderConfig?: DeciderConfig;
}
/** A run starts from a clean base. Its own files (run state, the memory fact it stores) are ignored locally. */
export declare function assertCleanCheckout(root: string): void;
/** the only branches --onto may push to: ones agentos itself opened a PR from */
export declare const ONTO_BRANCH: RegExp;
/** Preflight, create the run record, and drive it until it ends or pauses. */
export declare function startRun(root: string, task: string, cfg: OrchestratorConfig, deps: EngineDeps, id?: string, opts?: {
    quick?: boolean;
    onto?: string;
    plan?: boolean;
}): Promise<RunState>;
/** Continue a paused run, or one whose engine died mid-step. */
export declare function resumeRun(root: string, id: string, cfg: OrchestratorConfig, deps: EngineDeps): Promise<RunState>;
/** Whether an engine holds the run's lock: "live" (its PID is running), "stale" (a dead engine's) or "free". */
export declare function runLockState(root: string, id: string): {
    state: "free" | "live" | "stale";
    pid: number;
};
/** Ask a running engine to stop (it kills its own agents); a paused or dead run is marked at once. */
export declare function cancelRun(root: string, id: string, waitMs?: number): Promise<RunState>;
export declare function executeRun(root: string, s: RunState, cfg: OrchestratorConfig, deps: EngineDeps): Promise<RunState>;
