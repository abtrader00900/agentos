import type { AgentName, Runner } from "./types.js";
export declare const RATE_LIMIT_RE: RegExp;
/** kill a process and its children, by PID only */
export declare function killTree(pid: number): void;
/**
 * A runner for one agent CLI. argv is fixed and the prompt goes through stdin,
 * so the Windows shell (needed to start npm's .cmd shims) never sees user text.
 */
export declare function spawnRunner(command: string, args: string[]): Runner;
/** The agent's final message from Claude stream-json or Codex --json output, else the output's tail. */
export declare function finalText(output: string): string;
/**
 * write: may edit files in its cwd. read: planner and reviewer, which must not edit.
 * Claude in -p mode denies tools that are not allowed, so a writer edits files but
 * runs no shell commands; agentos commits and runs the tests itself.
 */
export declare const CLI_RUNNERS: Record<AgentName, {
    write: Runner;
    read: Runner;
}>;
