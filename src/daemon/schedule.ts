import { createHash } from "node:crypto";
import { Cron } from "croner";

export interface ScheduleEntry { cron: string; task: string; quick: boolean }
export interface DueSchedule extends ScheduleEntry { key: string; firedFor: Date }

/** why a cron expression is unusable, or undefined when it is fine */
export function cronError(expr: string): string | undefined {
  try {
    new Cron(expr, { paused: true });
    return undefined;
  } catch (e) {
    return (e as Error).message;
  }
}

/** a schedule's identity: editing its cron or task makes it a new schedule */
export const scheduleKey = (projectId: string, s: { cron: string; task: string }): string =>
  `${projectId}:${createHash("sha1").update(`${s.cron}\n${s.task}`).digest("hex").slice(0, 12)}`;

/**
 * Schedules whose next fire time after `lastFired` has passed. A schedule seen for the first
 * time only starts counting (no retroactive run), and one that missed several fire times while
 * the daemon was off fires once. `seen` holds the lastFired entries to store.
 */
export function dueSchedules(projectId: string, schedules: ScheduleEntry[], lastFired: Record<string, string>, now: Date) {
  const due: DueSchedule[] = [];
  const seen: Record<string, string> = {};
  const errors: string[] = [];
  for (const s of schedules) {
    const err = cronError(s.cron);
    if (err) {
      errors.push(`schedule "${s.cron}": ${err}`);
      continue;
    }
    const key = scheduleKey(projectId, s);
    const last = lastFired[key];
    if (!last) {
      seen[key] = now.toISOString();
      continue;
    }
    const next = new Cron(s.cron, { paused: true }).nextRun(new Date(last));
    if (next && next.getTime() <= now.getTime()) {
      due.push({ ...s, key, firedFor: next });
      seen[key] = now.toISOString();
    }
  }
  return { due, seen, errors };
}
