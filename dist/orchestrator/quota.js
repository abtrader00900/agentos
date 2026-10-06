import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { retrying, withLock } from "../core/jsonstore.js";
const quotaFile = (home) => path.join(home, ".agentos", "quota.json");
/** No entry, an unreadable date, or one already past all mean "has quota". */
function parseUntil(iso, now) {
    if (!iso)
        return undefined;
    const until = new Date(iso);
    return Number.isNaN(until.getTime()) || until <= now ? undefined : until;
}
/** Missing or corrupt reads as empty (the next write replaces it); an I/O error surfaces. */
function read(file) {
    let text;
    try {
        text = retrying(() => readFileSync(file, "utf8"));
    }
    catch (e) {
        if (e.code !== "ENOENT")
            throw e;
        return {};
    }
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
/** Read-modify-write under the cross-process lock; the rename is atomic. */
function write(file, fn) {
    mkdirSync(path.dirname(file), { recursive: true });
    withLock(file, () => {
        const next = fn(read(file));
        const tmp = `${file}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify(next, null, 2));
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
    });
}
/** Every call re-reads the file, so a run never works from a copy the daemon has moved on from. */
export function fileQuota(home) {
    const file = quotaFile(home);
    return {
        until: (agent, now) => parseUntil(read(file)[agent], now),
        mark: (agent, until) => write(file, (m) => {
            m[agent] = until.toISOString();
            return m;
        }),
        clear: (agent) => write(file, (m) => {
            if (!agent)
                return {};
            delete m[agent];
            return m;
        }),
    };
}
/** Same semantics with no I/O, for tests. */
export function memoryQuota() {
    const marks = new Map();
    return {
        until: (agent, now) => parseUntil(marks.get(agent), now),
        mark: (agent, until) => { marks.set(agent, until.toISOString()); },
        clear: (agent) => { if (agent)
            marks.delete(agent);
        else
            marks.clear(); },
    };
}
/** "Try again in 45 minutes", "resets in 2 hours" — the CLI's own wait beats any guess of ours. */
const WAIT_RE = /\bin (\d+) ?(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/i;
const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000 };
/** When an agent may be tried again: the wait its message states, else the configured cooldown. */
export function resetFrom(output, now, cooldownMin) {
    const m = WAIT_RE.exec(output);
    const ms = m ? Number(m[1]) * UNIT_MS[m[2][0].toLowerCase()] : cooldownMin * 60_000;
    return new Date(now.getTime() + ms);
}
//# sourceMappingURL=quota.js.map