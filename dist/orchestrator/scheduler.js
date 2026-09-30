const sleep = (ms) => new Promise((r) => setTimeout(r, ms).unref?.());
/**
 * Run subtasks whose dependencies are done, at most maxWorkers at a time.
 * After the first failure nothing new starts; running subtasks finish.
 */
export async function runScheduled(plan, done, exec, opts) {
    const running = new Map();
    const failed = [];
    for (;;) {
        if (!failed.length) {
            for (const s of plan.subtasks) {
                if (running.size >= opts.maxWorkers)
                    break;
                if (done.has(s.id) || running.has(s.id) || !s.dependsOn.every((d) => done.has(d)))
                    continue;
                if (running.size > 0 && opts.canStart && !opts.canStart())
                    break;
                running.set(s.id, exec(s)
                    .then((ok) => { if (ok)
                    done.add(s.id);
                else
                    failed.push(s.id); }, () => { failed.push(s.id); })
                    .finally(() => running.delete(s.id)));
            }
        }
        if (running.size === 0)
            break;
        await Promise.race([...running.values(), ...(opts.canStart ? [sleep(opts.waitMs ?? 2000)] : [])]);
    }
    return { failed };
}
//# sourceMappingURL=scheduler.js.map