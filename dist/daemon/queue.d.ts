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
export declare const OPEN_STATUSES: readonly JobStatus[];
export declare const queueFile: (home?: string) => string;
export declare const listJobs: (home?: string) => Job[];
export declare function addJob(input: {
    projectId: string;
    task: string;
    quick?: boolean;
    source: JobSource;
    onto?: string;
    dedupeKey?: string;
}, home?: string, now?: Date): Job | undefined;
export declare function updateJob(id: string, patch: Partial<Job>, home?: string): Job | undefined;
export declare function removeJob(id: string, home?: string): "removed" | "not-found" | "not-queued";
/** A paused run (rate limit, crash) continues before anything new starts. */
export declare function nextJob(jobs: Job[]): Job | undefined;
/** Jobs first started on `day`'s local calendar date; a resume does not count again. */
export declare function startedOn(jobs: Job[], day: Date): number;
