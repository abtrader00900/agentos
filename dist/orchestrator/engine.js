import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync, openSync, writeSync, closeSync, rmSync, mkdirSync } from "node:fs";
import { MemoryStore } from "../mcp/memory/store.js";
import { lessonsFor } from "../learning/inject.js";
import { allowedRunners, learnFromRun } from "../learning/learn-run.js";
import { fileQuota, resetFrom } from "./quota.js";
import { agentosHome } from "../ui/projects.js";
import { TERMINAL, newRunId, runDir, saveRun, loadRun, setStatus, logEvent, requestCancel, cancelRequested, } from "./run.js";
import { DEFAULT_RISK, REPORT_INSTRUCTIONS, REVIEW_GATES, parseNumstat, parseReport, riskFlags, tamperFindings } from "./gates.js";
import { makePlan } from "./planner.js";
import { runScheduled } from "./scheduler.js";
import { runVerify, parseFindings, blocking, reviewPrompt, reReviewPrompt, excerpt } from "./verify.js";
import { scanDiff, redact } from "./safety.js";
import { finalText, killTree } from "./runners.js";
import { git, tryGit, head, defaultBranch, statusOf, ensureExcluded, addWorktree, linkDeps, commitAll, mergeBranch, mergeInProgress, abortMerge, removeWorktree, } from "./workspace.js";
import { prBody, prTitle } from "./report.js";
import { usageFromLine } from "../ui/usage.js";
import { AUTO_QUICK, CONTENT_RISK } from "../decider/questions.js";
const minutes = (m) => m * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const memoryFile = (root) => path.join(root, ".agentos", "memory.json");
/** A run starts from a clean base. Its own files (run state, the memory fact it stores) are ignored locally. */
export function assertCleanCheckout(root) {
    ensureExcluded(root, "/.agentos/runs/");
    ensureExcluded(root, "/.agentos/memory.json*");
    if (statusOf(root))
        throw new Error("Your checkout has uncommitted changes — commit or stash them first (a run starts from a clean base).");
}
/** the only branches --onto may push to: ones agentos itself opened a PR from */
export const ONTO_BRANCH = /^agentos\/run-[0-9A-Za-z-]{1,40}$/;
/** Preflight, create the run record, and drive it until it ends or pauses. */
export async function startRun(root, task, cfg, deps, id = newRunId(), opts = {}) {
    if (existsSync(path.join(runDir(root, id), "state.json")))
        throw new Error(`run ${id} already exists — pick another id, or resume it`);
    if (opts.onto !== undefined && !ONTO_BRANCH.test(opts.onto)) {
        throw new Error(`--onto only takes a branch agentos opened a PR from (agentos/run-…), not "${opts.onto}"`);
    }
    assertCleanCheckout(root);
    deps.gh(root, ["auth", "status"]);
    const baseBranch = opts.onto ?? defaultBranch(root);
    if (opts.onto && !tryGit(root, ["fetch", "-q", "origin", opts.onto]).ok)
        throw new Error(`could not fetch origin/${opts.onto}`);
    const base = git(root, ["rev-parse", opts.onto ? `origin/${opts.onto}` : baseBranch]);
    // the decider may choose --quick; an explicit --quick/--plan, or a CI fix (--onto), is never second-guessed
    const dc = deps.deciderConfig;
    const askQuick = !!deps.decide && !!dc?.autoQuick && !opts.quick && !opts.plan && !opts.onto;
    const answer = askQuick ? await deps.decide(task, AUTO_QUICK) : null;
    const quick = !!opts.quick || (!!answer && answer.small >= dc.quickAbove);
    const now = new Date().toISOString();
    const s = {
        id, task, status: "queued", baseBranch, base,
        branch: `agentos/run-${id}`, runWorktree: path.join(runDir(root, id), "wt", "run"),
        createdAt: now, updatedAt: now, subtasks: [], fixRound: 0, findings: [],
        ...(quick ? { quick: true } : {}), ...(answer && quick && !opts.quick ? { autoQuick: { p: answer.small } } : {}),
        ...(opts.onto ? { onto: opts.onto } : {}),
    };
    saveRun(root, s);
    logEvent(root, id, { type: "start", task });
    if (askQuick)
        logEvent(root, id, answer ? { type: "decider", use: "auto-quick", p: answer.small, quick } : { type: "decider", use: "auto-quick", skipped: true });
    deps.onStatus?.(s);
    return executeRun(root, s, cfg, deps);
}
/** Continue a paused run, or one whose engine died mid-step. */
export async function resumeRun(root, id, cfg, deps) {
    const s = loadRun(root, id);
    if (TERMINAL.includes(s.status))
        throw new Error(`run ${id} is ${s.status}; there is nothing to resume`);
    const unlock = lockRun(root, id); // before touching the state: another engine may still own it
    try {
        if (s.status === "paused") {
            s.status = s.resumeFrom ?? "planning";
            s.resumeFrom = undefined;
            s.resumeAt = undefined;
            saveRun(root, s);
            logEvent(root, id, { type: "resume", status: s.status });
        }
        return await drive(root, s, cfg, deps);
    }
    finally {
        unlock();
    }
}
const alive = (pid) => {
    if (!pid)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e) {
        return e.code === "EPERM";
    }
};
/** One engine per run: an exclusive lock file holding the engine's PID. A dead engine's lock is taken over. */
function lockRun(root, id) {
    const file = path.join(runDir(root, id), "lock");
    mkdirSync(path.dirname(file), { recursive: true });
    for (let attempt = 0;; attempt++) {
        let fd;
        try {
            fd = openSync(file, "wx");
        }
        catch (e) {
            if (e.code !== "EEXIST" || attempt > 0)
                throw e;
            const pid = lockPid(file);
            if (alive(pid))
                throw new Error(`run ${id} is already being driven by agentos process ${pid} — wait for it, or cancel the run`);
            logEvent(root, id, { type: "stale-lock", pid });
            rmSync(file, { force: true });
            continue;
        }
        try {
            writeSync(fd, String(process.pid));
            closeSync(fd);
        }
        catch (e) {
            // never leave a lock without a pid behind
            try {
                closeSync(fd);
            }
            catch { /* already closed */ }
            rmSync(file, { force: true });
            throw e;
        }
        return () => rmSync(file, { force: true });
    }
}
/** Whether an engine holds the run's lock: "live" (its PID is running), "stale" (a dead engine's) or "free". */
export function runLockState(root, id) {
    const file = path.join(runDir(root, id), "lock");
    if (!existsSync(file))
        return { state: "free", pid: 0 };
    const pid = lockPid(file);
    return { state: alive(pid) ? "live" : "stale", pid };
}
/** the PID a lock file holds; 0 (stale) when it is empty, malformed or gone */
function lockPid(file) {
    try {
        const pid = Number(readFileSync(file, "utf8").trim());
        return Number.isInteger(pid) && pid > 0 ? pid : 0;
    }
    catch {
        return 0;
    }
}
/** Ask a running engine to stop (it kills its own agents); a paused or dead run is marked at once. */
export async function cancelRun(root, id, waitMs = 15_000) {
    let s = loadRun(root, id);
    if (TERMINAL.includes(s.status))
        throw new Error(`run ${id} is already ${s.status}`);
    requestCancel(root, id);
    if (s.status !== "paused") {
        for (const until = Date.now() + waitMs; Date.now() < until;) {
            await sleep(250);
            s = loadRun(root, id);
            if (TERMINAL.includes(s.status))
                return s;
        }
    }
    setStatus(root, s, "cancelled", s.status === "paused" ? "cancelled by the owner" : "cancelled by the owner (no engine was running it)");
    return s;
}
export async function executeRun(root, s, cfg, deps) {
    const unlock = lockRun(root, s.id);
    try {
        return await drive(root, s, cfg, deps);
    }
    finally {
        unlock();
    }
}
async function drive(root, s, cfg, deps) {
    const c = { root, s, cfg, deps, quota: deps.quota ?? fileQuota(agentosHome()), live: new Set() };
    s.enginePid = process.pid;
    for (const t of s.subtasks)
        if (t.status === "running")
            t.status = "pending";
    // an engine that died while a fixer resolved conflicts left the merge half done: start that merge over
    if (existsSync(s.runWorktree) && mergeInProgress(s.runWorktree)) {
        abortMerge(s.runWorktree);
        logEvent(root, s.id, { type: "abort-stale-merge" });
    }
    saveRun(root, s);
    const watcher = setInterval(() => {
        if (cancelRequested(root, s.id))
            for (const pid of c.live)
                killTree(pid);
    }, 1000);
    const deadline = Date.now() + minutes(cfg.maxMinutes);
    // a function, not an inline test: step() changes s.status behind TypeScript's narrowing
    const stopped = () => TERMINAL.includes(s.status) || s.status === "paused";
    try {
        while (!stopped()) {
            if (cancelRequested(root, s.id)) {
                move(c, "cancelled", "cancelled by the owner");
                break;
            }
            if (Date.now() > deadline) {
                move(c, "needs_human", `the run took longer than maxMinutes (${cfg.maxMinutes})`);
                break;
            }
            try {
                await step(c);
                if (!stopped())
                    guardOutside(c);
            }
            catch (e) {
                if (!TERMINAL.includes(s.status))
                    move(c, "failed", redact(e.message));
            }
        }
    }
    finally {
        clearInterval(watcher);
    }
    // learning reads only the run's events and state: the worktrees go first, not after minutes of retro
    if (s.status === "pr_open")
        cleanup(c);
    if (deps.learning && ["pr_open", "needs_human", "failed"].includes(s.status)) {
        // best effort: learning reads the run's record and never changes its status. One subtaskMinutes for all of it.
        // Only agents cfg.agents allows see the run's evidence, like every other call in the run.
        deps.onLearning?.();
        const learned = await learnFromRun(root, s.id, deps.learning, allowedRunners(deps.runners, cfg.agents), minutes(cfg.subtaskMinutes));
        try {
            const saved = loadRun(root, s.id);
            Object.assign(s, { learned: saved.learned, kind: saved.kind, draft: saved.draft });
        }
        catch { /* keep s as it is: learning never makes drive() throw */ }
        deps.onLearning?.(learned);
    }
    return s;
}
async function step(c) {
    switch (c.s.status) {
        case "queued":
            addWorktree(c.root, c.s.runWorktree, c.s.branch, c.s.base);
            linkDeps(c.root, c.s.runWorktree, c.cfg.link);
            return move(c, "planning");
        case "planning": return plan(c);
        case "working": return work(c);
        case "verifying": return verify(c);
        case "fixing": return fix(c);
        default: throw new Error(`cannot continue a run in status ${c.s.status}`);
    }
}
function move(c, status, reason) {
    // a PR that exists is recorded as open, even when a cancel arrived while gh created it
    if (status !== "cancelled" && status !== "pr_open" && cancelRequested(c.root, c.s.id)) {
        status = "cancelled";
        reason = "cancelled by the owner";
    }
    setStatus(c.root, c.s, status, reason);
    c.deps.onStatus?.(c.s);
}
/** usable right now: it has a runner (an agent without one counts as limited) and no live quota mark */
const available = (c, a) => !!c.deps.runners[a] && !c.quota.until(a, new Date());
/** when the first allowed agent has quota again; nothing while one of them is free */
function earliestUntil(c) {
    const now = new Date();
    // only agents that have a runner: a mark on one without a runner promises nothing
    return c.cfg.agents
        .filter((a) => !!c.deps.runners[a])
        .map((a) => c.quota.until(a, now))
        .filter((d) => !!d)
        .sort((x, y) => x.getTime() - y.getTime())[0];
}
/**
 * Pauses the run — but only while every allowed agent is limited right now (spec §2). A mark can expire
 * between the call that hit the limit and here: the reviewer may exhaust both agents while the verify
 * commands keep running for minutes, and a parallel worker's limit waits for every other worker. So
 * availability is re-read at this boundary; with an agent free again the status stays as it is and the
 * drive loop runs that step once more, retrying the pending subtask, review, fix or merge.
 */
function pause(c, from) {
    if (c.cfg.agents.some((a) => available(c, a))) {
        logEvent(c.root, c.s.id, { type: "quota-freed", from });
        return;
    }
    c.s.resumeFrom = from;
    // the daemon waits for this before resuming; unset while any allowed agent still has quota
    c.s.resumeAt = earliestUntil(c)?.toISOString();
    move(c, "paused", `rate limit or quota reached — continue later with: agentos run --resume ${c.s.id}`);
}
/** tracked files with uncommitted changes in a worktree (empty when git cannot tell) */
const changedTracked = (cwd) => {
    const r = tryGit(cwd, ["diff", "--name-only", "HEAD"]);
    return r.ok ? r.out.split("\n").filter(Boolean) : [];
};
/** disposable read worktrees are numbered, so two calls never pick the same directory */
let readGuards = 0;
/**
 * The read-mode guard (spec §3). A planner or reviewer call runs in a throwaway detached worktree at
 * HEAD instead of the run worktree, where the verify commands run at the same time — so a before/after
 * diff could not tell a reviewer's edit from a test artifact, and an edit would reach the run branch.
 * Anything the call wrote dies with the worktree, and the call is turned into a failure so the loop's
 * ordinary error fallback hands it to another agent.
 */
async function guardRead(c, a, req, run) {
    const dir = path.join(runDir(c.root, c.s.id), `read-${++readGuards}`);
    if (existsSync(dir)) {
        // a crashed run left this one behind (the counter restarts with the process): unregister it, then
        // free the path, or `worktree add` would fail here and leave the resumed review with no reviewer
        removeWorktree(req.cwd, dir, []);
        try {
            rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
        }
        catch { /* `worktree add` reports it below */ }
    }
    const added = tryGit(req.cwd, ["worktree", "add", "--detach", dir, "HEAD"]);
    // no fallback to req.cwd: running unguarded would void the guarantee this guard exists for
    if (!added.ok)
        return { ok: false, rateLimited: false, timedOut: false, agent: a, output: `read-guard: could not create a disposable worktree: ${added.out}` };
    const before = tryGit(dir, ["rev-parse", "HEAD"]).out;
    // a reader could also reach the real worktree by its absolute path: tracked files changed there during
    // the call are put back too. The verify commands run there at the same time, but they must not change
    // tracked files (commands that do belong in orchestrator.build), so a change here is never legitimate
    // output: whoever made it, it is undone and surfaced. ponytail: untracked new files there are not
    // checked, because verify creates test artifacts in that worktree; the CLIs' own read-only modes cover it
    const homeBefore = new Set(changedTracked(req.cwd));
    try {
        const res = await run({ ...req, cwd: dir });
        const homeEdits = changedTracked(req.cwd).filter((f) => !homeBefore.has(f));
        if (homeEdits.length) {
            tryGit(req.cwd, ["checkout", "HEAD", "--", ...homeEdits]);
            logEvent(c.root, c.s.id, { type: "read-guard", agent: a, files: homeEdits.slice(0, 20) });
            return { ...res, ok: false, output: `${res.output}\nread-guard: tracked files in the run worktree changed during this read call (by the reader, or by a verify command that should be an orchestrator.build step): ${homeEdits.slice(0, 20).join(", ")}` };
        }
        const st = tryGit(dir, ["status", "--porcelain"]);
        // an unreadable status counts as changed: the guard may not assume what it cannot check
        const dirty = !st.ok || st.out !== "";
        // tryGit trims, so the first porcelain line can lose the leading space of a " M a" code: strip the
        // code itself rather than a fixed three characters, and never let the names decide whether it is dirty
        const files = (st.ok ? st.out.split("\n").map((l) => l.trim().replace(/^\S{1,2}\s+/, "")).filter(Boolean) : ["(status unreadable)"]).slice(0, 20);
        const moved = tryGit(dir, ["rev-parse", "HEAD"]).out !== before;
        if (!dirty && !moved)
            return res;
        const what = files.length ? files : ["(a commit)"];
        logEvent(c.root, c.s.id, { type: "read-guard", agent: a, files: what });
        // rateLimited stays as it was, so this reads as an ordinary error to the fallback loop
        return { ...res, ok: false, output: `${res.output}\nread-guard: the call changed files: ${what.join(", ")}` };
    }
    finally {
        // the worktree holds no junctions, so --force deletes only its own files; cleanup never fails a run
        try {
            removeWorktree(req.cwd, dir, []);
        }
        catch { /* a leftover directory is harmless: the next call numbers a new one */ }
    }
}
/** the last non-empty line of an agent's output: what a fallback event reports as the reason */
const lastLine = (text) => text.trim().split("\n").filter(Boolean).pop()?.trim().slice(0, 200) ?? "";
/**
 * Runs one agent call: its PID is tracked for cancel, output lines are logged, and a failure
 * walks the allowlist — every quota limit moves on, an error or timeout costs one extra attempt.
 * It reports a quota limit, which pauses the run, only while every allowed agent is at a limit
 * when the chain gives up: an agent that merely errored, or whose limit expired meanwhile, means
 * waiting for a cooldown would help nothing, so the call fails instead.
 *
 * `rejectOk` lets the caller veto a result the agent itself called a success — work() uses it for a
 * call that committed nothing. A vetoed result walks the same chain on the same budget as an error,
 * so a veto can never restart an allowlist this call already exhausted; its return value is what
 * the fallback event reports.
 */
function agentRunner(c, agent, mode, rejectOk) {
    const runAgent = async (a, req) => {
        let pid = 0;
        try {
            const res = await c.deps.runners[a][mode]({
                ...req,
                onSpawn: (p) => { pid = p; c.live.add(p); },
                onLine: (line) => {
                    const u = usageFromLine(line);
                    if (u)
                        logEvent(c.root, c.s.id, { type: "usage", agent: a, ...u });
                    logEvent(c.root, c.s.id, { type: "agent", agent: a, line: redact(line).slice(0, 4000) });
                },
            });
            return { ...res, agent: a };
        }
        finally {
            c.live.delete(pid);
        }
    };
    const call = async (a, req) => mode === "read" ? guardRead(c, a, req, (r) => runAgent(a, r)) : runAgent(a, req);
    return async (req) => {
        // the asked-for agent first (when the allowlist has it), then the rest of the allowlist in order
        const order = [...(c.cfg.agents.includes(agent) ? [agent] : []), ...c.cfg.agents.filter((a) => a !== agent)];
        /** the agents this chain already called; a limit it skipped instead may be gone by the next failure */
        const tried = new Set();
        /** Takes the next untried agent that has quota, re-read from the shared store: a parallel worker
         *  or another run may have limited it — or let it free again — while the last call was running. */
        const nextFree = () => {
            const a = order.find((x) => !tried.has(x) && available(c, x));
            if (a)
                tried.add(a);
            return a;
        };
        const first = nextFree();
        if (!first) {
            const until = earliestUntil(c);
            // no mark at all means no allowed agent has a runner: waiting would never help, so it fails instead
            if (!until)
                return { ok: false, rateLimited: false, timedOut: false, output: "no allowed agent has a runner" };
            return { ok: false, rateLimited: true, timedOut: false, output: `every allowed agent is limited until ${until.toISOString()}` };
        }
        let a = first;
        let errorFallbackUsed = false;
        let res = await call(a, req);
        for (;;) {
            const vetoed = res.ok ? rejectOk?.(res) : undefined;
            if ((res.ok && !vetoed) || cancelRequested(c.root, c.s.id))
                return res;
            // this result is thrown away, but whatever it already wrote stays in the worktree and is committed
            // with the next agent's work: that makes this agent an author too, so a later review by it counts
            // as a self-review. (read calls edit only their disposable worktree, which guardRead throws away.)
            if (mode === "write" && statusOf(req.cwd))
                addEditor(c.s, a);
            let until;
            if (res.rateLimited) {
                until = resetFrom(res.output, new Date(), c.cfg.quotaCooldownMinutes);
                c.quota.mark(a, until);
            }
            else {
                // an error, timeout or veto buys one more attempt; a second one would just burn the quota twice
                if (errorFallbackUsed)
                    return res;
                errorFallbackUsed = true;
            }
            const next = nextFree();
            // Nothing left to try. Only "every allowed agent is at a limit right now" may pause the run
            // (spec §2), and that is re-read here: an agent that only errored, or one whose limit expired
            // while this chain ran, means a cooldown wait would help nothing, so the failure stands.
            if (!next)
                return { ...res, rateLimited: res.rateLimited && c.cfg.agents.every((x) => !available(c, x)) };
            logEvent(c.root, c.s.id, {
                type: "fallback", from: a, to: next,
                ...(until ? { why: "quota", until: until.toISOString() } : (vetoed ?? { why: res.timedOut ? "timeout" : "error", error: lastLine(redact(res.output)) })),
            });
            a = next;
            res = await call(a, req);
        }
    };
}
function recall(root, task) {
    if (!existsSync(memoryFile(root)))
        return [];
    try {
        // lessons reach prompts only through notes(), under the fixed header and only when auto/approved
        return new MemoryStore(memoryFile(root)).recall({ text: task, limit: Number.MAX_SAFE_INTEGER })
            .filter((f) => f.topic !== "lessons").slice(0, 10).map((f) => `[${f.topic}/${f.key}] ${f.value}`);
    }
    catch {
        return [];
    }
}
/** lessons for one role's prompt ("" when learning is off or nothing applies); records which were used */
function notes(c, role) {
    const L = c.deps.learning;
    if (!L)
        return "";
    try {
        const r = lessonsFor(c.root, role, c.s.task, L.maxLessonsInPrompt);
        if (r.keys.length)
            c.s.lessonsUsed = [...new Set([...(c.s.lessonsUsed ?? []), ...r.keys])];
        return r.block;
    }
    catch {
        return ""; // lessons are advice; a broken memory file must not stop a run
    }
}
const reportLine = (r) => r ? `CHANGED: ${r.changed.join("; ") || "none"}\nNOT DONE: ${r.notDone.join("; ") || "none"}\nASSUMED: ${r.assumed.join("; ") || "none"}\nNOT VERIFIED: ${r.notVerified.join("; ") || "none"}` : "(no report)";
/** the claims the reviewer must check against the diff; also the review's cache key, so a new claim is never left unchecked */
const reportsBlock = (s) => [
    ...s.subtasks.map((t) => `${t.id} (${t.doneBy ?? t.agent}):\n${reportLine(t.report)}`),
    ...(s.fixReport ? [`last fix round:\n${reportLine(s.fixReport)}`] : []),
].join("\n\n");
/** the reviewer's extra instructions: weakened tests, and the workers' claims to check against the diff */
function reviewNotes(c) {
    return [notes(c, "reviewer"), REVIEW_GATES, `Workers' reports:\n${reportsBlock(c.s)}`].filter(Boolean).join("\n\n");
}
/** --quick: the whole task as one subtask for the first worker, with no planner call */
function quickPlan(task, agent) {
    const title = task.split("\n")[0].slice(0, 80);
    return { summary: title, subtasks: [{ id: "task", title, prompt: task, files: [], dependsOn: [], agent }] };
}
async function plan(c) {
    const { s, cfg, root } = c;
    if (s.quick)
        return planned(c, quickPlan(s.task, cfg.workers[0]));
    const files = git(s.runWorktree, ["ls-files"]).split("\n").filter(Boolean).slice(0, 300);
    const r = await makePlan(agentRunner(c, cfg.planner, "read"), { task: s.task, facts: recall(root, s.task), files, workers: cfg.workers, notes: notes(c, "planner") }, s.runWorktree, minutes(cfg.subtaskMinutes));
    if (r.rateLimited)
        return pause(c, "planning");
    if (!r.plan)
        return move(c, "needs_human", `planner: ${r.error}`);
    if (r.rejected)
        logEvent(root, s.id, { type: "planner-retry", error: redact(r.rejected).slice(0, 300) });
    return planned(c, r.plan);
}
function planned(c, p) {
    const { s, root } = c;
    s.plan = p;
    s.subtasks = p.subtasks.map((t) => ({
        id: t.id, agent: t.agent, status: "pending", branch: `${s.branch}-${t.id}`,
        worktree: path.join(runDir(root, s.id), "wt", `sub-${t.id}`),
    }));
    logEvent(root, s.id, { type: "plan", plan: p });
    return move(c, "working");
}
/**
 * Every write call gets this: a real worker tried a shell command first, this environment denied it,
 * and the worker quit without editing a single file.
 */
const SHELL_RULE = "Shell commands may be refused in this environment. When one is denied, read, search and edit files with your own file tools instead; a denied command is never a reason to stop or give up, and agentos runs the tests itself.";
function workerPrompt(s, sub, note = "") {
    return [
        `You are one worker in a team. Overall goal: ${s.task}`,
        `Team plan: ${s.plan.summary}`,
        `Your subtask (${sub.id}): ${sub.title}\n${sub.prompt}`,
        sub.files.length ? `Files you are expected to change: ${sub.files.join(", ")}` : "",
        "Rules: work only inside the current directory. Do not commit, push, deploy, run migrations against real databases, or delete anything outside this directory. agentos commits your changes and runs the tests.",
        SHELL_RULE,
        note,
        REPORT_INSTRUCTIONS,
    ]
        .filter(Boolean)
        .join("\n\n");
}
async function work(c) {
    const { s, root, cfg } = c;
    let paused = false;
    let merges = Promise.resolve(); // merges into the run worktree go one at a time
    const done = new Set(s.subtasks.filter((t) => t.status === "done").map((t) => t.id));
    const freeMb = c.deps.freeMemMb ?? (() => os.freemem() / 1048576);
    const { failed } = await runScheduled(s.plan, done, async (sub) => {
        const t = s.subtasks.find((x) => x.id === sub.id);
        t.status = "running";
        saveRun(root, s);
        addWorktree(root, t.worktree, t.branch, head(s.runWorktree));
        linkDeps(root, t.worktree, cfg.link);
        const req = { prompt: workerPrompt(s, sub, notes(c, "worker")), cwd: t.worktree, timeoutMs: minutes(cfg.subtaskMinutes) };
        const gained = () => Number(git(root, ["rev-list", "--count", `${s.branch}..${t.branch}`])) > 0;
        // A call that claims success but leaves nothing to commit is as useless as an error, so it is vetoed
        // and walks the same fallback on the same budget. The check lives here because only work() can see
        // the subtask worktree; the next agent gets it untouched, since the first one left nothing behind.
        const committedNothing = (r) => {
            commitAll(t.worktree, `agentos: ${sub.title}`);
            return gained() ? undefined : { why: "no-change", error: lastLine(redact(finalText(r.output))) };
        };
        const res = await agentRunner(c, sub.agent, "write", committedNothing)(req);
        if (res.rateLimited) {
            paused = true;
            t.status = "pending";
            saveRun(root, s);
            return false;
        }
        commitAll(t.worktree, `agentos: ${sub.title}`); // a failed call's partial work is committed too
        t.doneBy = res.agent; // a fallback may have handed the subtask to another agent
        t.summary = redact(finalText(res.output)).slice(0, 1500);
        t.report = parseReport(redact(finalText(res.output)));
        const changed = gained();
        let ok = res.ok && changed;
        if (ok) {
            const next = merges.then(() => integrate(c, t, sub));
            merges = next.catch(() => undefined);
            const merged = await next;
            if (merged === "paused") {
                // the worker's commits stay on its branch; the merge is retried on resume
                paused = true;
                t.status = "pending";
                saveRun(root, s);
                return false;
            }
            ok = merged === "ok";
        }
        if (!ok)
            t.summary = `${t.summary}\n${!res.ok ? "the agent failed" : !changed ? "the agent changed nothing" : "merging its work failed"}`.trim();
        t.status = ok ? "done" : "failed";
        saveRun(root, s);
        return ok;
    }, { maxWorkers: cfg.maxWorkers, canStart: () => freeMb() >= cfg.minFreeMemoryMb });
    if (paused) {
        // a quota limit wins over the failed list: those subtasks are pending again, not failed. pause()
        // may decide not to pause (an agent has quota again), and then the drive loop retries them here.
        pause(c, "working");
        return;
    }
    if (failed.length)
        return move(c, "needs_human", `subtask(s) failed: ${failed.join(", ")}; worktrees kept in ${path.join(runDir(root, s.id), "wt")}`);
    return move(c, "verifying");
}
async function integrate(c, t, sub) {
    const m = mergeBranch(c.s.runWorktree, t.branch, `agentos: merge ${t.id}`);
    return m.ok ? "ok" : resolveConflicts(c, m.conflicts, sub.agent);
}
function conflictPrompt(s, files) {
    return [
        `Goal: ${s.task}`,
        `A git merge in this directory stopped with conflicts in: ${files.join(", ")}.`,
        "Resolve every conflict so both sides' intent is kept, and remove all conflict markers. Edit files only; do not commit or abort the merge.",
        SHELL_RULE,
    ].join("\n\n");
}
async function resolveConflicts(c, files, agent) {
    const cwd = c.s.runWorktree;
    // a merge that failed without stopping on conflicts (or a stale one) is not the fixer's to commit
    if (!files.length || !mergeInProgress(cwd)) {
        abortMerge(cwd);
        return "failed";
    }
    const res = await agentRunner(c, agent, "write")({ prompt: conflictPrompt(c.s, files), cwd, timeoutMs: minutes(c.cfg.subtaskMinutes) });
    if (res.rateLimited) {
        abortMerge(cwd);
        return "paused";
    }
    const markers = files.some((f) => {
        try {
            return /^(<{7}|>{7}|={7})(\s|$)/m.test(readFileSync(path.join(cwd, f), "utf8"));
        }
        catch {
            return false;
        }
    });
    if (!res.ok || markers) {
        abortMerge(cwd);
        return "failed";
    }
    addEditor(c.s, res.agent);
    git(cwd, ["add", "-A"]);
    if (!tryGit(cwd, ["commit", "-q", "--no-edit"]).ok || mergeInProgress(cwd)) {
        abortMerge(cwd);
        return "failed";
    }
    logEvent(c.root, c.s.id, { type: "conflict-resolved", files });
    return "ok";
}
/**
 * Who reviews (spec §2): the configured reviewer unless it wrote part of the change, else the first
 * allowed agent that wrote none, else the first that is not the main author, else the reviewer itself
 * (a single-agent project). The quota chain then applies to that choice like to any other call.
 */
/** every agent that wrote part of the change: subtask workers, then fixers and conflict resolvers */
const authorsOf = (s) => [...s.subtasks.map((t) => t.doneBy ?? t.agent), ...(s.editors ?? [])];
function addEditor(s, a) {
    if (a && !(s.editors ?? []).includes(a))
        s.editors = [...(s.editors ?? []), a];
}
function pickReviewer(s, cfg) {
    const wrote = authorsOf(s);
    const authors = new Set(wrote);
    if (!authors.has(cfg.reviewer))
        return cfg.reviewer;
    const innocent = cfg.agents.find((a) => !authors.has(a));
    if (innocent)
        return innocent;
    const count = (a) => wrote.filter((x) => x === a).length;
    const main = [...cfg.agents].sort((x, y) => count(y) - count(x))[0]; // a stable sort keeps cfg.agents order on ties
    return cfg.agents.find((a) => a !== main) ?? cfg.reviewer;
}
/** The cross-model review. After a fix round it sees only the fix, checked against its earlier findings. */
async function review(c) {
    const { s, cfg } = c;
    const authors = new Set(authorsOf(s));
    const reviewer = pickReviewer(s, cfg);
    const head = git(s.runWorktree, ["rev-parse", "HEAD"]);
    const last = s.reviewed;
    const reports = reportsBlock(s);
    // same commit and the same claims to check since the last review: its findings still stand, deterministically
    if (last?.head === head && last.reports === reports)
        return { ran: true, findings: last.findings, head, reports, kind: "unchanged" };
    const scoped = !!last && tryGit(s.runWorktree, ["merge-base", "--is-ancestor", last.head, "HEAD"]).ok;
    const prompt = scoped
        ? reReviewPrompt(s.task, blocking(last.findings), git(s.runWorktree, ["diff", `${last.head}..HEAD`]), s.base, git(s.runWorktree, ["diff", "--name-only", `${s.base}..HEAD`]).split("\n").filter(Boolean), reviewNotes(c))
        : reviewPrompt(s.task, git(s.runWorktree, ["diff", `${s.base}..HEAD`]), reviewNotes(c));
    const res = await agentRunner(c, reviewer, "read")({ prompt, cwd: s.runWorktree, timeoutMs: minutes(cfg.subtaskMinutes) });
    if (res.rateLimited)
        return { ran: false, rateLimited: true, error: `the reviewer (${reviewer}) hit a rate limit` };
    if (!res.ok)
        return { ran: false, rateLimited: false, error: `the reviewer (${reviewer}) failed${res.timedOut ? " (timeout)" : ""}: ${redact(res.output.trim().slice(-300))}` };
    // a review by an author is allowed (a stall helps nobody) but flagged in the PR body; sticky,
    // because it did happen. A single-agent project always lands here, and its owner must know too.
    if (authors.has(res.agent ?? reviewer))
        s.selfReview = true;
    const findings = parseFindings(finalText(res.output)) ?? [{ severity: "low", file: "", line: 0, issue: `the reviewer (${reviewer}) gave no parseable findings` }];
    return { ran: true, findings, head, reports, kind: scoped ? "fix" : "full" };
}
async function verify(c) {
    const { s, cfg } = c;
    const before = git(s.runWorktree, ["rev-parse", "HEAD"]);
    // tests and review at the same time: failing tests and review findings reach the fixer in one round
    const [v, r] = await Promise.all([runVerify(s.runWorktree, cfg.verify, minutes(cfg.subtaskMinutes), c.live), review(c)]);
    const tamper = tamperFindings(git(s.runWorktree, ["diff", `${s.base}..HEAD`]), s.task);
    s.verifyOk = v.ok;
    s.verifyOutput = redact(v.output);
    // the review saw `before`; a commit made meanwhile would reach the PR unreviewed
    if (git(s.runWorktree, ["rev-parse", "HEAD"]) !== before) {
        return move(c, "needs_human", "a verify command committed to the run branch while the review ran; put commands that change files in orchestrator.build");
    }
    if (!r.ran) {
        // with passing tests a review must run: pause for a limit, and no PR on a failed reviewer's say-so.
        // Failing tests go to the fixer anyway; the next review starts from the last one that ran.
        if (v.ok)
            return r.rateLimited ? pause(c, "verifying") : move(c, "needs_human", r.error);
        s.findings = [...tamper, { severity: "low", file: "", line: 0, issue: `the review did not run: ${r.error}` }];
    }
    else {
        s.findings = [...r.findings, ...tamper];
        // reviewer findings only: tampering is recomputed on every verify
        s.reviewed = { head: r.head, reports: r.reports, findings: r.findings };
    }
    saveRun(c.root, s);
    logEvent(c.root, s.id, {
        type: "verify", ok: v.ok, findings: s.findings, review: r.ran ? r.kind : "failed",
        ...(v.ok ? {} : { command: /^\$ (.+?)\s+✗ FAILED/m.exec(s.verifyOutput)?.[1] ?? "", output: excerpt(s.verifyOutput, 600) }),
    });
    if (v.ok && blocking(s.findings).length === 0)
        return gate(c);
    if (s.fixRound >= cfg.maxFixRounds) {
        return move(c, "needs_human", `still failing after ${s.fixRound} fix round(s): ${v.ok ? `${blocking(s.findings).length} blocking review finding(s)` : "verify commands fail"}`);
    }
    return move(c, "fixing");
}
function fixPrompt(s, note = "") {
    const found = blocking(s.findings);
    return [
        `Goal: ${s.task}`,
        "The change in this directory does not pass yet. Fix it. Edit files only; do not commit.",
        s.verifyOk === false ? `Failing checks:\n${s.verifyOutput}` : "",
        found.length ? `Review findings to fix:\n${found.map((f) => `- [${f.severity}] ${f.file}:${f.line} ${f.issue}`).join("\n")}` : "",
        SHELL_RULE,
        note,
        REPORT_INSTRUCTIONS,
    ]
        .filter(Boolean)
        .join("\n\n");
}
async function fix(c) {
    const { s } = c;
    s.fixRound++;
    saveRun(c.root, s);
    const author = s.subtasks[0]?.doneBy ?? s.subtasks[0]?.agent ?? c.cfg.workers[0];
    const res = await agentRunner(c, author, "write")({ prompt: fixPrompt(s, notes(c, "fixer")), cwd: s.runWorktree, timeoutMs: minutes(c.cfg.subtaskMinutes) });
    if (res.rateLimited) {
        s.fixRound--;
        return pause(c, "fixing");
    }
    addEditor(s, res.agent);
    s.fixReport = parseReport(redact(finalText(res.output)));
    const committed = commitAll(s.runWorktree, `agentos: fix round ${s.fixRound}`);
    const diff = committed ? tryGit(s.runWorktree, ["diff", "--name-only", "HEAD~1", "HEAD"]) : undefined; // logging must never fail the run
    const files = diff?.ok ? diff.out.split("\n").filter(Boolean) : [];
    logEvent(c.root, s.id, { type: "fix", round: s.fixRound, files });
    return move(c, "verifying");
}
function guardOutside(c) {
    const changed = statusOf(c.root);
    if (changed) {
        throw new Error(`an agent wrote outside its worktree (or the checkout was edited during the run) — stopped. Changed in ${c.root}:\n${changed}`);
    }
}
async function gate(c) {
    const { s, root } = c;
    const cancelled = () => cancelRequested(root, s.id);
    if (cancelled())
        return move(c, "cancelled", "cancelled by the owner");
    guardOutside(c);
    const fetched = tryGit(root, ["fetch", "-q", "origin", s.baseBranch]).ok;
    const latest = git(root, ["rev-parse", fetched ? `origin/${s.baseBranch}` : s.baseBranch]);
    if (!tryGit(s.runWorktree, ["merge-base", "--is-ancestor", latest, "HEAD"]).ok) {
        // saved before the merge: an engine that dies after it must not resume into a review of "the fix" that is really the base
        s.reviewed = undefined;
        saveRun(root, s);
        const m = mergeBranch(s.runWorktree, latest, `agentos: merge ${s.baseBranch}`);
        const merged = m.ok ? "ok" : await resolveConflicts(c, m.conflicts, s.subtasks[0]?.doneBy ?? s.subtasks[0]?.agent ?? c.cfg.workers[0]);
        if (merged === "paused")
            return pause(c, "verifying");
        if (merged === "failed")
            return move(c, "needs_human", `${s.baseBranch} moved during the run and merging it conflicted`);
        s.base = latest;
        return move(c, "verifying"); // the tests must pass on the new base too
    }
    // built output goes in before the scan, so it is scanned too, and before the push, so it reaches the branch
    if (c.cfg.build.length) {
        const b = await runVerify(s.runWorktree, c.cfg.build, minutes(c.cfg.subtaskMinutes), c.live);
        logEvent(root, s.id, { type: "build", ok: b.ok, output: excerpt(redact(b.output), 600) });
        if (!b.ok)
            return move(c, "needs_human", `build command failed: ${excerpt(redact(b.output), 600)}`);
        commitAll(s.runWorktree, "agentos: build");
    }
    // every commit is pushed, so scan each one: a key a fixer removed later is still in the history.
    // --cc adds each merge commit's own lines (what a conflict resolution wrote) without re-listing
    // the lines it took from the base branch, which are already public
    const history = git(s.runWorktree, ["log", "-p", "--cc", "--format=", `${s.base}..HEAD`]);
    const hits = [...new Set([...scanDiff(history), ...scanDiff(git(s.runWorktree, ["diff", `${s.base}..HEAD`]))])];
    if (hits.length)
        return move(c, "needs_human", `secret scan blocked the PR: ${hits.join("; ")}`);
    const numstat = tryGit(s.runWorktree, ["diff", "--numstat", "--no-renames", `${s.base}..HEAD`]);
    if (numstat.ok) {
        const flags = riskFlags(parseNumstat(numstat.out), c.cfg.risk ?? DEFAULT_RISK);
        const blocked = flags.filter((f) => f.action === "block");
        if (blocked.length) {
            return move(c, "needs_human", blocked.map((f) => `risk rule "${f.rule}" blocks the PR: ${f.files.slice(0, 5).join(", ")}`).join("; "));
        }
        s.risk = flags;
        if (c.deps.decide && c.deps.deciderConfig?.contentRisk) {
            const added = git(s.runWorktree, ["diff", `${s.base}..HEAD`]).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n").slice(0, 20_000);
            const a = added ? await c.deps.decide(added, CONTENT_RISK) : null;
            if (a) {
                for (const [k, p] of Object.entries(a))
                    if (p >= c.deps.deciderConfig.riskAbove)
                        s.risk.push({ rule: `jevos:${k}`, action: "flag", files: [], p });
                logEvent(root, s.id, { type: "decider", use: "content-risk", answers: a });
            }
            else if (added)
                logEvent(root, s.id, { type: "decider", use: "content-risk", skipped: true });
        }
    }
    else {
        s.findings = [...s.findings, { severity: "low", file: "", line: 0, issue: "the risk check could not read the diff (git diff --numstat failed)" }];
    }
    saveRun(root, s);
    if (cancelled())
        return move(c, "cancelled", "cancelled by the owner");
    // remote work runs from the checkout: a relative remote URL (../origin.git) resolves against the cwd
    if (s.onto) {
        // a CI fix lands on the PR it fixes: no --force, so git itself refuses anything but a fast-forward
        const pushed = tryGit(root, ["push", "-q", "origin", `${s.branch}:refs/heads/${s.onto}`]);
        if (!pushed.ok)
            return move(c, "needs_human", `pushing the fix to ${s.onto} failed: ${redact(pushed.out).slice(0, 300)}`);
        s.prUrl = c.deps.gh(root, ["pr", "view", s.onto, "--json", "url", "--jq", ".url"]).trim().split("\n").pop() || undefined;
    }
    else {
        git(root, ["push", "-q", "-u", "origin", s.branch]);
        if (cancelled())
            return move(c, "cancelled", `cancelled by the owner after ${s.branch} was pushed (no PR opened; delete the remote branch if unwanted)`);
        const out = c.deps.gh(root, ["pr", "create", "--base", s.baseBranch, "--head", s.branch, "--title", prTitle(s.task), "--body", prBody(s)]);
        s.prUrl = out.trim().split("\n").pop();
    }
    move(c, "pr_open", s.prUrl);
    remember(c);
}
function remember(c) {
    try {
        new MemoryStore(memoryFile(c.root)).store({ topic: "runs", key: c.s.id, value: `${c.s.task} → ${c.s.prUrl} (${c.s.fixRound} fix round(s))`, source: "agentos run" });
    }
    catch {
        /* memory is best effort */
    }
}
function cleanup(c) {
    for (const t of c.s.subtasks) {
        removeWorktree(c.root, t.worktree, c.cfg.link);
        tryGit(c.root, ["branch", "-D", t.branch]);
    }
    removeWorktree(c.root, c.s.runWorktree, c.cfg.link);
}
//# sourceMappingURL=engine.js.map