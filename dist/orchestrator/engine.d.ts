import type { OrchestratorConfig } from "../core/schema.js";
import type { AgentName, Runner } from "./types.js";
import { type RunState } from "./run.js";
export interface EngineDeps {
    runners: Record<AgentName, {
        read: Runner;
        write: Runner;
    }>;
    /** the GitHub CLI: returns stdout, throws on failure */
    gh: (cwd: string, args: string[]) => string;
    freeMemMb?: () => number;
    onStatus?: (s: RunState) => void;
}
/** Preflight, create the run record, and drive it until it ends or pauses. */
export declare function startRun(root: string, task: string, cfg: OrchestratorConfig, deps: EngineDeps, id?: string): Promise<RunState>;
/** Continue a paused run, or one whose engine died mid-step. */
export declare function resumeRun(root: string, id: string, cfg: OrchestratorConfig, deps: EngineDeps): Promise<RunState>;
/** Ask a running engine to stop (it kills its own agents); a paused or dead run is marked at once. */
export declare function cancelRun(root: string, id: string, waitMs?: number): Promise<RunState>;
export declare function executeRun(root: string, s: RunState, cfg: OrchestratorConfig, deps: EngineDeps): Promise<RunState>;
