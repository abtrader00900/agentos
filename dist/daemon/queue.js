import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { retrying, withLock } from "../core/jsonstore.js";
import { agentosHome } from "../ui/projects.js";
export const OPEN_STATUSES = ["queued", "running", "paused"];
export const queueFile = (home = agentosHome()) => path.join(home, ".agentos", "queue.json");
const isJob = (j) => !!j && typeof j === "object" && typeof j.id === "string" && typeof j.status === "string";
/** Missing or corrupt reads as empty (the next write replaces it); an I/O error surfaces. */
function read(home) {
    let text;
    try {
        text = retrying(() => readFileSync(queueFile(home), "utf8"));
    }
    catch (e) {
        if (e.code !== "ENOENT")
            throw e;
        return [];
    }
    try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed.filter(isJob) : [];
    }
    catch {
        return [];
    }
}
/** Read-modify-write under the cross-process lock; the rename is atomic. */
function update(home, fn) {
    const file = queueFile(home);
    return withLock(file, () => {
        const jobs = read(home);
        const result = fn(jobs);
        const tmp = `${file}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify(jobs, null, 2));
        try {
            retrying(() => renameSync(tmp, file));
        }
        catch (e) {
            try {
                unlinkSync(tmp);
            }
            catch { /* already gone */ }
            throw e;
        }
        return result;
    });
}
// ponytail: finished jobs are never pruned; prune past ~1000 entries if the file ever gets slow
export const listJobs = (home = agentosHome()) => read(home);
export function addJob(input, home = agentosHome(), now = new Date()) {
    return update(home, (jobs) => {
        const id = randomBytes(4).toString("hex");
        const dedupeKey = input.dedupeKey ?? `manual:${id}`;
        if (jobs.some((j) => j.dedupeKey === dedupeKey && OPEN_STATUSES.includes(j.status)))
            return undefined;
        const job = {
            id, projectId: input.projectId, task: input.task, quick: input.quick ?? false, source: input.source,
            ...(input.onto ? { onto: input.onto } : {}), dedupeKey, status: "queued", addedAt: now.toISOString(),
        };
        jobs.push(job);
        return job;
    });
}
/** `onlyIf`: apply only while the job is in one of these statuses (compare-and-swap), else undefined */
export function updateJob(id, patch, home = agentosHome(), onlyIf) {
    return update(home, (jobs) => {
        const j = jobs.find((x) => x.id === id);
        if (!j || (onlyIf && !onlyIf.includes(j.status)))
            return undefined;
        Object.assign(j, patch);
        return j;
    });
}
export function removeJob(id, home = agentosHome()) {
    return update(home, (jobs) => {
        const j = jobs.find((x) => x.id === id);
        if (!j)
            return "not-found";
        if (j.status !== "queued")
            return "not-queued";
        j.status = "removed";
        j.endedAt = new Date().toISOString();
        return "removed";
    });
}
const oldest = (jobs) => [...jobs].sort((a, b) => a.addedAt.localeCompare(b.addedAt))[0];
/** A paused run (rate limit, crash) continues before anything new starts. */
export function nextJob(jobs) {
    return oldest(jobs.filter((j) => j.status === "paused")) ?? oldest(jobs.filter((j) => j.status === "queued"));
}
/** Jobs first started on `day`'s local calendar date; a resume does not count again. */
export function startedOn(jobs, day) {
    const same = (iso) => new Date(iso).toDateString() === day.toDateString();
    return jobs.filter((j) => j.startedAt && same(j.startedAt)).length;
}
//# sourceMappingURL=queue.js.map