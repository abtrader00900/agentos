import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { retrying, withLock } from "../core/jsonstore.js";
import { agentosHome } from "../ui/projects.js";

export type JobSource = "manual" | "schedule" | "ci";
export type JobStatus = "queued" | "running" | "paused" | "done" | "failed" | "removed";

export interface Job {
  id: string;
  projectId: string;
  task: string;
  quick: boolean;
  source: JobSource;
  /** ci: the agentos/run-* branch the fix lands on */
  onto?: string;
  /** no second open job with the same key */
  dedupeKey: string;
  status: JobStatus;
  runId?: string;
  /** how many times the daemon started or resumed it (a run that keeps crashing is given up) */
  attempts?: number;
  addedAt: string;
  startedAt?: string;
  endedAt?: string;
  /** the PR URL, or why it did not get there */
  result?: string;
}

export const OPEN_STATUSES: readonly JobStatus[] = ["queued", "running", "paused"];

export const queueFile = (home = agentosHome()): string => path.join(home, ".agentos", "queue.json");

const isJob = (j: unknown): j is Job =>
  !!j && typeof j === "object" && typeof (j as Job).id === "string" && typeof (j as Job).status === "string";

/** Missing or corrupt reads as empty (the next write replaces it); an I/O error surfaces. */
function read(home: string): Job[] {
  let text: string;
  try {
    text = retrying(() => readFileSync(queueFile(home), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter(isJob) : [];
  } catch {
    return [];
  }
}

/** Read-modify-write under the cross-process lock; the rename is atomic. */
function update<T>(home: string, fn: (jobs: Job[]) => T): T {
  const file = queueFile(home);
  return withLock(file, () => {
    const jobs = read(home);
    const result = fn(jobs);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(jobs, null, 2));
    try {
      retrying(() => renameSync(tmp, file));
    } catch (e) {
      try { unlinkSync(tmp); } catch { /* already gone */ }
      throw e;
    }
    return result;
  });
}
// ponytail: finished jobs are never pruned; prune past ~1000 entries if the file ever gets slow

export const listJobs = (home = agentosHome()): Job[] => read(home);

export function addJob(
  input: { projectId: string; task: string; quick?: boolean; source: JobSource; onto?: string; dedupeKey?: string },
  home = agentosHome(),
  now = new Date(),
): Job | undefined {
  return update(home, (jobs) => {
    const id = randomBytes(4).toString("hex");
    const dedupeKey = input.dedupeKey ?? `manual:${id}`;
    if (jobs.some((j) => j.dedupeKey === dedupeKey && OPEN_STATUSES.includes(j.status))) return undefined;
    const job: Job = {
      id, projectId: input.projectId, task: input.task, quick: input.quick ?? false, source: input.source,
      ...(input.onto ? { onto: input.onto } : {}), dedupeKey, status: "queued", addedAt: now.toISOString(),
    };
    jobs.push(job);
    return job;
  });
}

/** `onlyIf`: apply only while the job is in one of these statuses (compare-and-swap), else undefined */
export function updateJob(id: string, patch: Partial<Job>, home = agentosHome(), onlyIf?: readonly JobStatus[]): Job | undefined {
  return update(home, (jobs) => {
    const j = jobs.find((x) => x.id === id);
    if (!j || (onlyIf && !onlyIf.includes(j.status))) return undefined;
    Object.assign(j, patch);
    return j;
  });
}

export function removeJob(id: string, home = agentosHome()): "removed" | "not-found" | "not-queued" {
  return update(home, (jobs) => {
    const j = jobs.find((x) => x.id === id);
    if (!j) return "not-found";
    if (j.status !== "queued") return "not-queued";
    j.status = "removed";
    j.endedAt = new Date().toISOString();
    return "removed";
  });
}

const oldest = (jobs: Job[]) => [...jobs].sort((a, b) => a.addedAt.localeCompare(b.addedAt))[0];

/** A paused run (rate limit, crash) continues before anything new starts. */
export function nextJob(jobs: Job[]): Job | undefined {
  return oldest(jobs.filter((j) => j.status === "paused")) ?? oldest(jobs.filter((j) => j.status === "queued"));
}

/** Jobs first started on `day`'s local calendar date; a resume does not count again. */
export function startedOn(jobs: Job[], day: Date): number {
  const same = (iso: string) => new Date(iso).toDateString() === day.toDateString();
  return jobs.filter((j) => j.startedAt && same(j.startedAt)).length;
}
