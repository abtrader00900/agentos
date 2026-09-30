import type { Plan, Subtask } from "./types.js";

export interface ScheduleOptions {
  maxWorkers: number;
  /** checked before each extra worker (free memory); one worker always runs */
  canStart?: () => boolean;
  /** how often to re-check canStart while waiting */
  waitMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());

/**
 * Run subtasks whose dependencies are done, at most maxWorkers at a time.
 * After the first failure nothing new starts; running subtasks finish.
 */
export async function runScheduled(
  plan: Plan,
  done: Set<string>,
  exec: (s: Subtask) => Promise<boolean>,
  opts: ScheduleOptions,
): Promise<{ failed: string[] }> {
  const running = new Map<string, Promise<void>>();
  const failed: string[] = [];
  for (;;) {
    if (!failed.length) {
      for (const s of plan.subtasks) {
        if (running.size >= opts.maxWorkers) break;
        if (done.has(s.id) || running.has(s.id) || !s.dependsOn.every((d) => done.has(d))) continue;
        if (running.size > 0 && opts.canStart && !opts.canStart()) break;
        running.set(
          s.id,
          exec(s)
            .then((ok) => { if (ok) done.add(s.id); else failed.push(s.id); }, () => { failed.push(s.id); })
            .finally(() => running.delete(s.id)),
        );
      }
    }
    if (running.size === 0) break;
    await Promise.race([...running.values(), ...(opts.canStart ? [sleep(opts.waitMs ?? 2000)] : [])]);
  }
  return { failed };
}
