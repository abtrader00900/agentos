export interface ScheduleEntry {
    cron: string;
    task: string;
    quick: boolean;
}
export interface DueSchedule extends ScheduleEntry {
    key: string;
    firedFor: Date;
}
/** why a cron expression is unusable, or undefined when it is fine */
export declare function cronError(expr: string): string | undefined;
/** a schedule's identity: editing its cron or task makes it a new schedule */
export declare const scheduleKey: (projectId: string, s: {
    cron: string;
    task: string;
}) => string;
/**
 * Schedules whose next fire time after `lastFired` has passed. A schedule seen for the first
 * time only starts counting (no retroactive run), and one that missed several fire times while
 * the daemon was off fires once. `seen` holds the lastFired entries to store.
 */
export declare function dueSchedules(projectId: string, schedules: ScheduleEntry[], lastFired: Record<string, string>, now: Date): {
    due: DueSchedule[];
    seen: Record<string, string>;
    errors: string[];
};
