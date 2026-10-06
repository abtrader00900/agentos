import type { AgentReport, RiskFlag } from "./gates.js";
import type { AgentName, Finding, Plan } from "./types.js";
export declare const RUN_STATUSES: readonly ["queued", "planning", "working", "verifying", "fixing", "paused", "pr_open", "needs_human", "failed", "cancelled"];
export type RunStatus = (typeof RUN_STATUSES)[number];
export declare const TERMINAL: readonly RunStatus[];
export interface SubtaskState {
    id: string;
    agent: AgentName;
    /** who really produced the work, when a fallback moved it off `agent` */
    doneBy?: AgentName;
    status: "pending" | "running" | "done" | "failed";
    branch: string;
    worktree: string;
    summary?: string;
    /** the worker's closing report (PRD 4.5); null when it gave none */
    report?: AgentReport | null;
}
export interface RunState {
    id: string;
    task: string;
    status: RunStatus;
    reason?: string;
    /** where a paused run continues */
    resumeFrom?: RunStatus;
    /** when the earliest allowed agent has quota again: a quota pause waits for this */
    resumeAt?: string;
    /** the review ran on an agent that wrote part of this change: no other allowed agent could */
    selfReview?: boolean;
    /** agents that edited the run branch after the subtasks: fixers and conflict resolvers */
    editors?: AgentName[];
    baseBranch: string;
    /** commit the run branch started from (moves when a newer base is merged in) */
    base: string;
    branch: string;
    runWorktree: string;
    createdAt: string;
    updatedAt: string;
    plan?: Plan;
    subtasks: SubtaskState[];
    fixRound: number;
    findings: Finding[];
    verifyOk?: boolean;
    verifyOutput?: string;
    /** --quick: no planner, the whole task is one subtask */
    quick?: boolean;
    /** the decider chose --quick (PRD 4.5b), with its P(yes) */
    autoQuick?: {
        p: number;
    };
    /** --onto: a CI fix that lands on this agentos/run-* branch (its open PR) instead of opening a new PR */
    onto?: string;
    /** the last review that ran: the commit and the agents' reports it saw, and what it found; the next one checks only the fix since */
    reviewed?: {
        head: string;
        reports: string;
        findings: Finding[];
    };
    prUrl?: string;
    enginePid?: number;
    /** lessons injected into this run's prompts (PRD 2) */
    lessonsUsed?: string[];
    /** task kind from the retrospective */
    kind?: string;
    learned?: "done" | "skipped" | "failed";
    /** a skill draft this run created */
    draft?: string;
    /** the last fix round's closing report */
    fixReport?: AgentReport | null;
    /** risk rules this run's change tripped (flag only; a block stops the run) */
    risk?: RiskFlag[];
}
export declare const runsDir: (root: string) => string;
export declare function runDir(root: string, id: string): string;
/** sortable by time, unique enough for one machine: 20260930123456-a1b2 */
export declare function newRunId(now?: Date): string;
export declare function saveRun(root: string, state: RunState): void;
export declare function loadRun(root: string, id: string): RunState;
export declare function listRuns(root: string): RunState[];
export declare function logEvent(root: string, id: string, event: Record<string, unknown>): void;
/** Move to a new status, persist it, log it. A finished run never changes again. */
export declare function setStatus(root: string, state: RunState, status: RunStatus, reason?: string): void;
/** the engine polls for this file and stops the run's agents */
export declare function requestCancel(root: string, id: string): void;
export declare const cancelRequested: (root: string, id: string) => boolean;
