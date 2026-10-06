import { loadConfig } from "../core/loader.js";
import { learningSchema } from "../core/schema.js";
import { git } from "../orchestrator/workspace.js";
import { listRuns, loadRun, TERMINAL } from "../orchestrator/run.js";
import { runLockState } from "../orchestrator/engine.js";
import { cliRunners } from "../orchestrator/runners.js";
import { listLessons, approveLesson, forgetLesson, promoteLesson, ROLES } from "../learning/lessons.js";
import { allowedRunners, learnFromRun } from "../learning/learn-run.js";
import { listDrafts, readDraft, approveDraft, rejectDraft } from "../learning/skilldraft.js";
const repoRoot = (cwd = process.cwd()) => git(cwd, ["rev-parse", "--show-toplevel"]);
/** agentos lessons [approve|forget|promote <key>] */
export function lessonsCommand(action, key, opts) {
    const root = repoRoot(opts.cwd);
    if (action) {
        if (!key)
            throw new Error(`Usage: agentos lessons ${action} <key>`);
        if (action === "approve") {
            const l = approveLesson(root, key);
            console.log(`✓ approved ${l.key}: ${l.text}`);
            return;
        }
        if (action === "forget") {
            if (!forgetLesson(root, key))
                throw new Error(`No lesson "${key}"`);
            console.log(`✓ forgot ${key}`);
            return;
        }
        if (action === "promote") {
            const n = promoteLesson(root, key);
            console.log(n ? `✓ ${key} appended to agent.config.local.yaml as a rule — review it, move it to agent.config.yaml, then agentos sync` : `${key} is already a rule`);
            return;
        }
        throw new Error(`Unknown action "${action}" — use approve, forget or promote`);
    }
    if (opts.role && !ROLES.includes(opts.role))
        throw new Error(`Unknown role "${opts.role}" — ${ROLES.join(", ")}`);
    const all = listLessons(root, opts.pending ? { status: ["pending"] } : {}).filter((l) => !opts.role || l.meta.roles.includes(opts.role));
    if (opts.json) {
        console.log(JSON.stringify(all.map((l) => ({ key: l.key, text: l.text, ...l.meta })), null, 2));
        return;
    }
    if (!all.length) {
        console.log(opts.pending ? "No pending lessons." : "No lessons yet — they are learned after each agentos run.");
        return;
    }
    for (const l of all) {
        console.log(`${l.key}  ${l.meta.status.padEnd(8)}  seen ${l.meta.seen} · used ${l.meta.uses} · ${l.meta.roles.join(",")}${l.meta.kind ? ` · ${l.meta.kind}` : ""}\n    ${l.text}${l.meta.evidence.map((e) => `\n      · ${e}`).join("")}`);
    }
}
/** agentos learn --run <id> | --pending-runs */
export async function learnRuns(opts, 
// Partial: a caller (or a test) may hand over the agents it has, like EngineDeps.runners
runners) {
    const root = repoRoot(opts.cwd);
    const { config } = loadConfig(root);
    const learning = config.learning ?? learningSchema.parse({});
    const timeoutMs = (config.orchestrator?.subtaskMinutes ?? 20) * 60_000;
    // the allowlist binds this command too: a codex-only project never hands its runs to claude
    const use = allowedRunners(runners ?? cliRunners(config.orchestrator?.models ?? {}), config.orchestrator?.agents);
    if (opts.run) {
        const s = loadRun(root, opts.run); // throws `No run "<id>"`
        if (!TERMINAL.includes(s.status))
            throw new Error(`run ${s.id} is ${s.status}; learn it after it finishes`);
        const lock = runLockState(root, s.id);
        if (lock.state === "live")
            throw new Error(`run ${s.id} is still held by agentos process ${lock.pid} (it learns from the run itself) — try again after it exits`);
    }
    // a live lock: that engine is still finishing (and learning) the run. A dead engine's lock is taken over.
    const ids = opts.run
        ? [opts.run]
        : listRuns(root)
            .filter((r) => TERMINAL.includes(r.status) && r.status !== "cancelled" && (!r.learned || r.learned === "failed") && runLockState(root, r.id).state !== "live")
            .map((r) => r.id);
    if (!ids.length) {
        console.log("No runs to learn from.");
        return;
    }
    for (const id of ids) {
        console.log(`→ learning ${id}…`);
        console.log(`${id}: ${await learnFromRun(root, id, learning, use, timeoutMs)}`);
    }
}
export function skillDraftsCommand(cwd) {
    const drafts = listDrafts(repoRoot(cwd));
    if (!drafts.length) {
        console.log("No skill drafts. One is written after a kind of task succeeds a few times.");
        return;
    }
    for (const d of drafts)
        console.log(`${d.kind}\n    ${d.description}\n    approve: agentos skill approve ${d.kind}   reject: agentos skill reject ${d.kind}`);
}
export function skillApproveCommand(kind, cwd) {
    const root = repoRoot(cwd);
    console.log(readDraft(root, kind)); // the owner reads the full file before it is installed
    approveDraft(root, kind);
    console.log(`✓ installed .agentos/skills/${kind} — commit it, then: agentos sync`);
}
export function skillRejectCommand(kind, cwd) {
    if (!rejectDraft(repoRoot(cwd), kind))
        throw new Error(`No skill draft "${kind}" — see: agentos skill drafts`);
    console.log(`✓ rejected the ${kind} draft`);
}
//# sourceMappingURL=lessons.js.map