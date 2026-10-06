import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { retrying } from "../core/jsonstore.js";
import type { AgentReport, RiskFlag } from "./gates.js";
import type { AgentName, Finding, Plan } from "./types.js";

export const RUN_STATUSES = ["queued", "planning", "working", "verifying", "fixing", "paused", "pr_open", "needs_human", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL: readonly RunStatus[] = ["pr_open", "needs_human", "failed", "cancelled"];

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
  autoQuick?: { p: number };
  /** --onto: a CI fix that lands on this agentos/run-* branch (its open PR) instead of opening a new PR */
  onto?: string;
  /** the last review that ran: the commit and the agents' reports it saw, and what it found; the next one checks only the fix since */
  reviewed?: { head: string; reports: string; findings: Finding[] };
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

export const runsDir = (root: string) => path.join(root, ".agentos", "runs");

export function runDir(root: string, id: string): string {
  if (!/^[0-9A-Za-z-]{1,40}$/.test(id)) throw new Error(`invalid run id "${id}"`);
  return path.join(runsDir(root), id);
}

/** sortable by time, unique enough for one machine: 20260930123456-a1b2 */
export function newRunId(now = new Date()): string {
  return `${now.toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(2).toString("hex")}`;
}

export function saveRun(root: string, state: RunState): void {
  const dir = runDir(root, state.id);
  mkdirSync(dir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  const file = path.join(dir, "state.json");
  writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
  retrying(() => renameSync(`${file}.tmp`, file));
}

export function loadRun(root: string, id: string): RunState {
  const file = path.join(runDir(root, id), "state.json");
  if (!existsSync(file)) throw new Error(`No run "${id}" in ${runsDir(root)}`);
  return JSON.parse(retrying(() => readFileSync(file, "utf8"))) as RunState;
}

export function listRuns(root: string): RunState[] {
  if (!existsSync(runsDir(root))) return [];
  return readdirSync(runsDir(root))
    .filter((id) => /^[0-9A-Za-z-]{1,40}$/.test(id) && existsSync(path.join(runsDir(root), id, "state.json")))
    .map((id) => loadRun(root, id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function logEvent(root: string, id: string, event: Record<string, unknown>): void {
  const dir = runDir(root, id);
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, "events.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n");
}

/** Move to a new status, persist it, log it. A finished run never changes again. */
export function setStatus(root: string, state: RunState, status: RunStatus, reason?: string): void {
  if (TERMINAL.includes(state.status)) throw new Error(`run ${state.id} is already ${state.status}`);
  state.status = status;
  state.reason = reason;
  saveRun(root, state);
  logEvent(root, state.id, { type: "status", status, reason });
}

/** the engine polls for this file and stops the run's agents */
export function requestCancel(root: string, id: string): void {
  mkdirSync(runDir(root, id), { recursive: true });
  writeFileSync(path.join(runDir(root, id), "cancel"), new Date().toISOString());
}

export const cancelRequested = (root: string, id: string) => existsSync(path.join(runDir(root, id), "cancel"));
