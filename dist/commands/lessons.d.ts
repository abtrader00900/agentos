import type { AgentName, Runner } from "../orchestrator/types.js";
/** agentos lessons [approve|forget|promote <key>] */
export declare function lessonsCommand(action: string | undefined, key: string | undefined, opts: {
    pending?: boolean;
    role?: string;
    json?: boolean;
    cwd?: string;
}): void;
/** agentos learn --run <id> | --pending-runs */
export declare function learnRuns(opts: {
    run?: string;
    pendingRuns?: boolean;
    cwd?: string;
}, runners?: Partial<Record<AgentName, {
    read: Runner;
    write: Runner;
}>>): Promise<void>;
export declare function skillDraftsCommand(cwd?: string): void;
export declare function skillApproveCommand(kind: string, cwd?: string): void;
export declare function skillRejectCommand(kind: string, cwd?: string): void;
