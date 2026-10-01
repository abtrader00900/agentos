import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { preflight as realPreflight } from "../commands/run.js";
import { approveLesson, forgetLesson, listLessons, promoteLesson, safetyCheck } from "../learning/lessons.js";
import { approveDraft, listDrafts, readDraft, rejectDraft } from "../learning/skilldraft.js";
import { spawnDetachedRun } from "../mcp/orchestrator/server.js";
import { cancelRun, runLockState } from "../orchestrator/engine.js";
import { listRuns, loadRun, newRunId, runDir, runsDir, RUN_STATUSES, TERMINAL, type RunState, type RunStatus } from "../orchestrator/run.js";
import { tryGit } from "../orchestrator/workspace.js";
import { getProject, listProjects, removeProject } from "./projects.js";
import { runUsage } from "./usage.js";
import type { RouteHandler, UiOptions } from "./server.js";

/**
 * What the dashboard reads (readRoutes) and what it does (actionRoutes).
 *
 * The tables are exported rather than registered from here: server.ts imports
 * them and calls route() itself, so this module never imports server.ts at
 * runtime.
 */

const RUNNING: readonly RunStatus[] = ["queued", "planning", "working", "verifying", "fixing"];
const NEEDS_YOU: readonly RunStatus[] = ["needs_human", "failed"];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** a diff past this is for reading in an editor, not in a browser tab */
const DIFF_CAP = 300_000;

/** a status the handler wants instead of 200 */
export class Http extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/**
 * Wrap a read so it can be a straight line: it gets the project's folder and
 * returns the JSON body, throwing Http for anything that is not a 200.
 */
const read = (fn: (root: string, m: RegExpMatchArray, opts: UiOptions) => unknown): RouteHandler =>
  async (m, _url, _body, opts) => {
    try {
      return { status: 200, json: fn(rootOf(m[1], opts), m, opts) };
    } catch (e) {
      if (e instanceof Http) return { status: e.status, json: { error: e.message } };
      throw e;
    }
  };

/** :p only ever resolves through the registry; a folder that is gone is as good as unknown. */
function rootOf(id: string, opts: UiOptions): string {
  const p = getProject(id, opts.home);
  if (!p || !existsSync(p.path)) throw new Http(404, `no such project: ${id}`);
  return p.path;
}

/** An id runDir rejects never reaches the filesystem; a run that is not there is a 404. */
export function runOf(root: string, id: string): RunState {
  try {
    runDir(root, id);
  } catch {
    throw new Http(400, `invalid run id: ${id}`);
  }
  let run: RunState;
  try {
    run = loadRun(root, id);
  } catch {
    throw new Http(404, `no such run: ${id}`);
  }
  // state.json parses but says nothing useful: hand-edited or half-written, and
  // the caller reads run.id/status/subtasks. That is the file's problem, not a
  // server bug, so it reads as an unreadable run rather than a 500.
  const r: Partial<RunState> | null = run;
  if (!r || typeof r !== "object" || Array.isArray(r) || r.id !== id || !RUN_STATUSES.includes(r.status as RunStatus) || !Array.isArray(r.subtasks)) {
    throw new Http(404, "unreadable run");
  }
  return run;
}

type ProjectRow = ReturnType<typeof listProjects>[number];

const noCounts = () => ({ running: 0, needsYou: 0, pendingLessons: 0, drafts: 0, week: { runs: 0, prs: 0, costUsd: 0 } });

/**
 * One row of the project list. A missing folder, a half-written state.json or a
 * broken memory.json costs this project its counts, never the whole list.
 */
function summarise(p: ProjectRow) {
  const row = { id: p.id, name: p.name, path: p.path, missing: p.missing };
  if (p.missing) return { ...row, ...noCounts() };
  try {
    const runs = listRuns(p.path);
    const since = Date.now() - WEEK_MS;
    const week = runs.filter((r) => Date.parse(r.createdAt) >= since);
    return {
      ...row,
      running: runs.filter((r) => RUNNING.includes(r.status)).length,
      needsYou: week.filter((r) => NEEDS_YOU.includes(r.status)).length,
      pendingLessons: listLessons(p.path, { status: ["pending"] }).length,
      drafts: listDrafts(p.path).length,
      week: {
        runs: week.length,
        prs: week.filter((r) => r.status === "pr_open").length,
        costUsd: week.reduce((sum, r) => sum + (runUsage(p.path, r.id).costUsd ?? 0), 0),
      },
    };
  } catch {
    return { ...row, ...noCounts() };
  }
}

interface RunRow {
  id: string;
  status: string;
  task?: string;
  fixRound?: number;
  createdAt?: string;
  prUrl?: string;
  reason?: string;
  costUsd?: number;
}

/** run folders, without loading them: one unreadable run must not cost the list. */
const runIds = (root: string): string[] =>
  existsSync(runsDir(root))
    ? readdirSync(runsDir(root)).filter((id) => existsSync(path.join(runsDir(root), id, "state.json")))
    : [];

function runList(root: string): RunRow[] {
  return runIds(root)
    .map((id): RunRow => {
      try {
        const r = loadRun(root, id);
        return { id, task: r.task, status: r.status, fixRound: r.fixRound, createdAt: r.createdAt, prUrl: r.prUrl, reason: r.reason, costUsd: runUsage(root, id).costUsd };
      } catch {
        return { id, status: "unreadable" };
      }
    })
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

function runDetail(root: string, id: string) {
  const run = runOf(root, id);
  const active = runLockState(root, run.id).state === "live";
  return { ...run, usage: runUsage(root, run.id), active, canResume: !TERMINAL.includes(run.status) && !active };
}

/** Pending lessons first; inside each group the store's order stands (sort is stable). */
const lessons = (root: string) =>
  listLessons(root)
    .map((l) => ({ key: l.key, text: l.text, meta: l.meta, safety: safetyCheck(l.text) }))
    .sort((a, b) => Number(b.meta.status === "pending") - Number(a.meta.status === "pending"));

const drafts = (root: string) =>
  listDrafts(root).map((d) => {
    let text = "";
    try { text = readDraft(root, d.kind); } catch { /* vanished or not a usable kind: the row still lists */ }
    return { kind: d.kind, description: d.description, text };
  });

/** The reason a run cannot start, as the user should read it. */
function preflightReport(root: string, opts: UiOptions): { ok: boolean; problems: string[] } {
  try {
    if (opts.preflight) opts.preflight(root);
    else realPreflight(root);
    return { ok: true, problems: [] };
  } catch (e) {
    return { ok: false, problems: [(e as Error).message] };
  }
}

/**
 * The run's diff, from the project root: the worktree is gone once a run ends,
 * but base..branch still answers from the repo itself.
 */
function runDiff(root: string, id: string): { diff: string; truncated: boolean } {
  const run = runOf(root, id);
  for (const ref of [run.base, run.branch]) {
    if (!tryGit(root, ["rev-parse", "--verify", "--quiet", ref]).ok) throw new Http(404, `no diff for ${id}: ${ref} is gone`);
  }
  const dir = mkdtempSync(path.join(tmpdir(), "agentos-diff-"));
  const file = path.join(dir, "diff");
  try {
    const out = tryGit(root, ["diff", `--output=${file}`, `${run.base}..${run.branch}`]);
    if (!out.ok) throw new Http(500, `git diff failed: ${out.out}`);
    const fd = openSync(file, "r");
    try {
      const decoder = new StringDecoder("utf8");
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let text = "";
      while (text.length <= DIFF_CAP) {
        const n = readSync(fd, buffer, 0, buffer.length, null);
        if (!n) { text += decoder.end(); break; }
        text += decoder.write(buffer.subarray(0, n));
      }
      return { diff: text.slice(0, DIFF_CAP), truncated: text.length > DIFF_CAP };
    } finally {
      closeSync(fd);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Anchored patterns: /runs/:id must not swallow /runs/:id/diff. */
export const readRoutes: Array<{ method: string; pattern: RegExp; handler: RouteHandler }> = [
  { method: "GET", pattern: /^\/api\/projects$/, handler: async (_m, _url, _body, opts) => ({ status: 200, json: listProjects(opts.home).map(summarise) }) },
  { method: "GET", pattern: /^\/api\/p\/([^/]+)\/runs$/, handler: read((root) => runList(root)) },
  { method: "GET", pattern: /^\/api\/p\/([^/]+)\/runs\/([^/]+)$/, handler: read((root, m) => runDetail(root, m[2])) },
  { method: "GET", pattern: /^\/api\/p\/([^/]+)\/runs\/([^/]+)\/diff$/, handler: read((root, m) => runDiff(root, m[2])) },
  { method: "GET", pattern: /^\/api\/p\/([^/]+)\/lessons$/, handler: read((root) => lessons(root)) },
  { method: "GET", pattern: /^\/api\/p\/([^/]+)\/drafts$/, handler: read((root) => drafts(root)) },
  { method: "GET", pattern: /^\/api\/p\/([^/]+)\/preflight$/, handler: read((root, _m, opts) => preflightReport(root, opts)) },
];

/** `agentos run --resume <id>` as a detached process, the way spawnDetachedRun starts a new run. */
export function spawnDetachedResume(root: string, id: string): void {
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  spawn(process.execPath, [cli, "run", "--resume", id], { cwd: root, detached: true, stdio: "ignore", windowsHide: true }).unref();
}

/**
 * The library errors an owner can act on, and the status each reads as. Anything
 * else is a bug in here and must keep bubbling to the server's 500, rather than
 * being reported as the owner's fault.
 */
const KNOWN: ReadonlyArray<[RegExp, number]> = [
  [/^No lesson "/, 404],
  [/^No skill draft "/, 404],
  [/^lesson .* is pending/, 409],
  [/^run .* is already /, 409],
  [/ is already installed/, 409],
];

/** The action sibling of read(): same project lookup, but the handler may write and is awaited. */
const act = (fn: (root: string, m: RegExpMatchArray, body: unknown, opts: UiOptions) => Promise<{ status: number; json: unknown }>): RouteHandler =>
  async (m, _url, body, opts) => {
    try {
      return await fn(rootOf(m[1], opts), m, body, opts);
    } catch (e) {
      if (e instanceof Http) return { status: e.status, json: { error: e.message } };
      const message = (e as Error)?.message ?? "";
      const known = KNOWN.find(([re]) => re.test(message));
      if (!known) throw e;
      return { status: known[1], json: { error: message } };
    }
  };

/** Anchored patterns: /runs/:id must not swallow /runs/:id/cancel. */
export const actionRoutes: Array<{ method: string; pattern: RegExp; handler: RouteHandler }> = [
  {
    method: "POST",
    pattern: /^\/api\/p\/([^/]+)\/runs$/,
    handler: act(async (root, _m, body, opts) => {
      const { task, quick } = (body ?? {}) as { task?: unknown; quick?: unknown };
      if (typeof task !== "string" || task.trim().length < 3 || task.length > 2000) throw new Http(400, "task must be 3-2000 characters");
      if (quick !== undefined && typeof quick !== "boolean") throw new Http(400, "quick must be a boolean");
      // the detached run has no one to tell why it could not start, so the reason is reported here
      try {
        (opts.preflight ?? realPreflight)(root);
      } catch (e) {
        throw new Http(409, (e as Error).message);
      }
      const id = newRunId();
      (opts.spawnRun ?? spawnDetachedRun)(root, id, task, quick);
      return { status: 201, json: { id } };
    }),
  },
  {
    method: "POST",
    pattern: /^\/api\/p\/([^/]+)\/runs\/([^/]+)\/cancel$/,
    handler: act(async (root, m) => {
      const run = runOf(root, m[2]);
      // short wait: a browser is holding the request open, and the engine marks the run itself
      const s = await cancelRun(root, run.id, 5000);
      return { status: 200, json: { status: s.status } };
    }),
  },
  {
    method: "POST",
    pattern: /^\/api\/p\/([^/]+)\/runs\/([^/]+)\/resume$/,
    handler: act(async (root, m, _body, opts) => {
      const run = runOf(root, m[2]);
      if (TERMINAL.includes(run.status)) throw new Http(409, `run ${run.id} is already ${run.status}`);
      if (runLockState(root, run.id).state === "live") throw new Http(409, `run ${run.id} is already running`);
      (opts.spawnResume ?? spawnDetachedResume)(root, run.id);
      return { status: 202, json: { ok: true } };
    }),
  },
  {
    method: "POST",
    pattern: /^\/api\/p\/([^/]+)\/lessons\/([^/]+)\/(approve|forget|promote)$/,
    handler: act(async (root, m) => {
      const key = m[2];
      if (m[3] === "approve") approveLesson(root, key);
      else if (m[3] === "promote") promoteLesson(root, key);
      else if (!forgetLesson(root, key)) throw new Http(404, `No lesson "${key}"`);
      return { status: 200, json: { ok: true } };
    }),
  },
  {
    method: "POST",
    pattern: /^\/api\/p\/([^/]+)\/drafts\/([^/]+)\/(approve|reject)$/,
    handler: act(async (root, m) => {
      if (m[3] === "approve") approveDraft(root, m[2]);
      else if (!rejectDraft(root, m[2])) throw new Http(404, `No skill draft "${m[2]}"`);
      return { status: 200, json: { ok: true } };
    }),
  },
  // registry only: the project's folder stays exactly as it is, and one that is
  // already gone must still be removable, so this never resolves a root.
  {
    method: "DELETE",
    pattern: /^\/api\/projects\/([^/]+)$/,
    handler: async (m, _url, _body, opts) =>
      removeProject(m[1], opts.home) ? { status: 200, json: { ok: true } } : { status: 404, json: { error: `no such project: ${m[1]}` } },
  },
];
