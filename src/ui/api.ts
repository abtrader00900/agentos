import { closeSync, existsSync, mkdtempSync, openSync, readSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { preflight as realPreflight } from "../commands/run.js";
import { listLessons, safetyCheck } from "../learning/lessons.js";
import { listDrafts, readDraft } from "../learning/skilldraft.js";
import { runLockState } from "../orchestrator/engine.js";
import { listRuns, loadRun, runDir, runsDir, TERMINAL, type RunState, type RunStatus } from "../orchestrator/run.js";
import { tryGit } from "../orchestrator/workspace.js";
import { getProject, listProjects } from "./projects.js";
import { runUsage } from "./usage.js";
import type { RouteHandler, UiOptions } from "./server.js";

/**
 * Everything the dashboard reads. Nothing here writes or starts anything.
 *
 * The table is exported rather than registered from here: server.ts imports it
 * and calls route() itself, so this module never imports server.ts at runtime.
 */

const RUNNING: readonly RunStatus[] = ["queued", "planning", "working", "verifying", "fixing"];
const NEEDS_YOU: readonly RunStatus[] = ["needs_human", "failed"];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** a diff past this is for reading in an editor, not in a browser tab */
const DIFF_CAP = 300_000;

/** a status the handler wants instead of 200 */
class Http extends Error {
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
function runOf(root: string, id: string): RunState {
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
  if (!r || typeof r !== "object" || Array.isArray(r) || r.id !== id || typeof r.status !== "string" || !Array.isArray(r.subtasks)) {
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
