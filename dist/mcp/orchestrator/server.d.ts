import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/** Options go before "--"; everything after it is the task text. */
export declare function runArgs(id: string, task: string, quick?: boolean, onto?: string): string[];
/**
 * `agentos run --id <id> -- <task>` as a detached process: the run outlives the chat that asked for it.
 * No shell, so the task text is never parsed; "--" keeps a task that starts with a dash from being read as an option.
 */
export declare function spawnDetachedRun(root: string, id: string, task: string, quick?: boolean): void;
export declare function createOrchestratorServer(root?: string, launch?: typeof spawnDetachedRun, 
/** runs before launching: the detached process has no one to tell why it could not start */
check?: (root: string) => unknown): McpServer;
