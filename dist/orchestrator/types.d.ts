import type { AgentName } from "../core/schema.js";
export type { AgentName };
export interface Subtask {
    id: string;
    title: string;
    /** complete instructions: the worker sees only this and the plan summary */
    prompt: string;
    files: string[];
    dependsOn: string[];
    agent: AgentName;
}
export interface Plan {
    summary: string;
    subtasks: Subtask[];
}
export interface Finding {
    severity: "high" | "medium" | "low";
    file: string;
    line: number;
    issue: string;
}
export interface RunnerRequest {
    prompt: string;
    cwd: string;
    timeoutMs: number;
    onLine?: (line: string) => void;
    onSpawn?: (pid: number) => void;
}
export interface RunnerResult {
    ok: boolean;
    output: string;
    rateLimited: boolean;
    timedOut: boolean;
    /** which agent produced this result: a fallback can hand the call to another one */
    agent?: AgentName;
}
export type Runner = (req: RunnerRequest) => Promise<RunnerResult>;
