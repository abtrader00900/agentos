import { type OrchestratorConfig } from "../core/schema.js";
export declare const ORCHESTRATOR_SNIPPET = "orchestrator:\n  verify: [npm test]          # commands that must pass before a PR opens\n  workers: [claude, codex]    # agent CLIs that write code (your subscriptions)\n  reviewer: codex             # reviews every diff\n  maxWorkers: 2";
/** Everything a run needs before it starts; throws the reason. The MCP server runs it before launching a background run. */
export declare function preflight(root: string, ghCli?: (cwd: string, args: string[]) => string): OrchestratorConfig;
/** agentos run: start, resume, cancel or inspect a run. Returns the exit code. */
export declare function run(task: string, opts: {
    resume?: string;
    cancel?: string;
    status?: string;
    id?: string;
    quick?: boolean;
    plan?: boolean;
    onto?: string;
    cwd?: string;
}): Promise<number>;
/** agentos runs */
export declare function runs(opts: {
    json?: boolean;
    cwd?: string;
    limit?: number;
}): void;
