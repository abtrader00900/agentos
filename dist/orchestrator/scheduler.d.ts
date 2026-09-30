import type { Plan, Subtask } from "./types.js";
export interface ScheduleOptions {
    maxWorkers: number;
    /** checked before each extra worker (free memory); one worker always runs */
    canStart?: () => boolean;
    /** how often to re-check canStart while waiting */
    waitMs?: number;
}
/**
 * Run subtasks whose dependencies are done, at most maxWorkers at a time.
 * After the first failure nothing new starts; running subtasks finish.
 */
export declare function runScheduled(plan: Plan, done: Set<string>, exec: (s: Subtask) => Promise<boolean>, opts: ScheduleOptions): Promise<{
    failed: string[];
}>;
