import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/**
 * `agentos run --id <id> -- <task>` as a detached process: the run outlives the chat that asked for it.
 * No shell, so the task text is never parsed; "--" keeps a task that starts with a dash from being read as an option.
 */
export declare function spawnDetachedRun(root: string, id: string, task: string): void;
export declare function createOrchestratorServer(root?: string, launch?: typeof spawnDetachedRun): McpServer;
