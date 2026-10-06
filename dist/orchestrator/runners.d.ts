import type { AgentName, Runner } from "./types.js";
/** `quota reached` also covers agy's "individual quota reached", `usage limit` Kimi's "reached your <period> usage limit". */
export declare const RATE_LIMIT_RE: RegExp;
/** kill a process and its children, by PID only */
export declare function killTree(pid: number): void;
/**
 * A runner for one agent CLI. argv is fixed and the prompt goes through stdin,
 * so the Windows shell (needed to start npm's .cmd shims) never sees user text.
 * On Windows the command is resolved to an absolute path first: cmd.exe looks in the
 * current directory before PATH, so a claude.cmd an agent wrote into a worktree would run.
 */
export declare function spawnRunner(command: string, args: string[]): Runner;
/** The agent's final message from Claude stream-json or Codex --json output, else the output's tail. */
export declare function finalText(output: string): string;
/**
 * The command and fixed argv for one agent CLI.
 * write: may edit files in its cwd. read: planner and reviewer, which must not edit.
 * Claude in -p mode denies tools that are not allowed, so a writer edits files but
 * runs no shell commands; agentos commits and runs the tests itself.
 * model (schema-checked to a plain name) overrides the CLI's own default.
 */
export declare function cliArgs(agent: AgentName, mode: "read" | "write", model?: string): [string, string[]];
export declare function cliRunners(models?: Partial<Record<AgentName, string>>): Record<AgentName, {
    write: Runner;
    read: Runner;
}>;
