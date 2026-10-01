import { createHash } from "node:crypto";

export interface ScheduleEntry { cron: string; task: string; quick: boolean }
export interface DueSchedule extends ScheduleEntry { key: string; firedFor: Date }

/** minute, hour, day of month, month, day of week (7 is Sunday too) */
const RANGES: ReadonlyArray<readonly [number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

/** one cron field: a star, a number, a range, any of those with a step, or a comma-separated mix */
function parseField(part: string, [min, max]: readonly [number, number]): Set<number> {
  const out = new Set<number>();
  for (const item of part.split(",")) {
    const [range, stepText = "1"] = item.split("/");
    const ends = range === "*" ? [String(min), String(max)] : range.split("-");
    if (!/^\d+$/.test(stepText) || ends.length > 2 || !ends.every((n) => /^\d+$/.test(n))) throw new Error(`bad field "${item}"`);
    const step = Number(stepText);
    const from = Number(ends[0]);
    const to = ends.length === 2 ? Number(ends[1]) : step > 1 ? max : from;
    if (step < 1 || from < min || to > max || to < from) throw new Error(`"${item}" is outside ${min}-${max}`);
    for (let n = from; n <= to; n += step) out.add(n);
  }
  return out;
}

/**
 * A 5-field cron expression, read in local time. Enough for the daemon's schedules:
 * no seconds, no names, no `L`/`#`. A wider syntax would mean a cron dependency.
 */
class Cron {
  private readonly fields: Set<number>[];
  private readonly everyDom: boolean;
  private readonly everyDow: boolean;

  constructor(expr: string) {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error(`expected 5 fields (minute hour day month weekday), got ${parts.length}`);
    this.fields = parts.map((p, i) => parseField(p, RANGES[i]));
    if (this.fields[4].delete(7)) this.fields[4].add(0);
    this.everyDom = parts[2] === "*";
    this.everyDow = parts[4] === "*";
  }

  /** POSIX: with both day fields restricted a date matches either one, not both */
  private dayMatches(d: Date): boolean {
    const dom = this.fields[2].has(d.getDate());
    const dow = this.fields[4].has(d.getDay());
    if (this.everyDom && this.everyDow) return true;
    if (this.everyDom) return dow;
    if (this.everyDow) return dom;
    return dom || dow;
  }

  /** the first fire time strictly after `from`, or undefined when there is none within 5 years */
  nextRun(from: Date): Date | undefined {
    const d = new Date(from.getTime());
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + 1);
    const limit = from.getTime() + 5 * 366 * 24 * 60 * 60 * 1000;
    while (d.getTime() <= limit) {
      const before = d.getTime();
      if (!this.fields[3].has(d.getMonth() + 1) || !this.dayMatches(d)) {
        d.setDate(d.getDate() + 1);
        d.setHours(0, 0, 0, 0);
      } else if (!this.fields[1].has(d.getHours())) {
        d.setHours(d.getHours() + 1, 0, 0, 0);
      } else if (this.fields[0].has(d.getMinutes())) {
        return d;
      } else {
        d.setMinutes(d.getMinutes() + 1, 0, 0);
      }
      if (d.getTime() <= before) return undefined; // a clock shift that does not move the search forward
    }
    return undefined;
  }
}

/** why a cron expression is unusable, or undefined when it is fine */
export function cronError(expr: string): string | undefined {
  try {
    new Cron(expr);
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
    const next = new Cron(s.cron).nextRun(new Date(last));
    if (next && next.getTime() <= now.getTime()) {
      due.push({ ...s, key, firedFor: next });
      seen[key] = now.toISOString();
    }
  }
  return { due, seen, errors };
}
