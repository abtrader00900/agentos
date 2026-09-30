import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { retrying } from "../core/jsonstore.js";
export const RUN_STATUSES = ["queued", "planning", "working", "verifying", "fixing", "paused", "pr_open", "needs_human", "failed", "cancelled"];
export const TERMINAL = ["pr_open", "needs_human", "failed", "cancelled"];
export const runsDir = (root) => path.join(root, ".agentos", "runs");
export function runDir(root, id) {
    if (!/^[0-9A-Za-z-]{1,40}$/.test(id))
        throw new Error(`invalid run id "${id}"`);
    return path.join(runsDir(root), id);
}
/** sortable by time, unique enough for one machine: 20260930123456-a1b2 */
export function newRunId(now = new Date()) {
    return `${now.toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(2).toString("hex")}`;
}
export function saveRun(root, state) {
    const dir = runDir(root, state.id);
    mkdirSync(dir, { recursive: true });
    state.updatedAt = new Date().toISOString();
    const file = path.join(dir, "state.json");
    writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
    retrying(() => renameSync(`${file}.tmp`, file));
}
export function loadRun(root, id) {
    const file = path.join(runDir(root, id), "state.json");
    if (!existsSync(file))
        throw new Error(`No run "${id}" in ${runsDir(root)}`);
    return JSON.parse(retrying(() => readFileSync(file, "utf8")));
}
export function listRuns(root) {
    if (!existsSync(runsDir(root)))
        return [];
    return readdirSync(runsDir(root))
        .filter((id) => /^[0-9A-Za-z-]{1,40}$/.test(id) && existsSync(path.join(runsDir(root), id, "state.json")))
        .map((id) => loadRun(root, id))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function logEvent(root, id, event) {
    const dir = runDir(root, id);
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, "events.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n");
}
/** Move to a new status, persist it, log it. A finished run never changes again. */
export function setStatus(root, state, status, reason) {
    if (TERMINAL.includes(state.status))
        throw new Error(`run ${state.id} is already ${state.status}`);
    state.status = status;
    state.reason = reason;
    saveRun(root, state);
    logEvent(root, state.id, { type: "status", status, reason });
}
/** the engine polls for this file and stops the run's agents */
export function requestCancel(root, id) {
    mkdirSync(runDir(root, id), { recursive: true });
    writeFileSync(path.join(runDir(root, id), "cancel"), new Date().toISOString());
}
export const cancelRequested = (root, id) => existsSync(path.join(runDir(root, id), "cancel"));
//# sourceMappingURL=run.js.map