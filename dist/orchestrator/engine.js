import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync, openSync, writeSync, closeSync, rmSync, mkdirSync } from "node:fs";
import { MemoryStore } from "../mcp/memory/store.js";
import { lessonsFor } from "../learning/inject.js";
import { learnFromRun } from "../learning/learn-run.js";
import { TERMINAL, newRunId, runDir, saveRun, loadRun, setStatus, logEvent, requestCancel, cancelRequested, } from "./run.js";
import { makePlan } from "./planner.js";
import { runScheduled } from "./scheduler.js";
import { runVerify, parseFindings, blocking, reviewPrompt } from "./verify.js";
import { scanDiff, redact } from "./safety.js";
import { finalText, killTree } from "./runners.js";
import { git, tryGit, head, defaultBranch, statusOf, ensureExcluded, addWorktree, linkDeps, commitAll, mergeBranch, mergeInProgress, abortMerge, removeWorktree, } from "./workspace.js";
import { prBody, prTitle } from "./report.js";
const minutes = (m) => m * 60_000;
const other = (a) => (a === "claude" ? "codex" : "claude");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const memoryFile = (root) => path.join(root, ".agentos", "memory.json");
/** A run starts from a clean base. Its own files (run state, the memory fact it stores) are ignored locally. */
export function assertCleanCheckout(root) {
    ensureExcluded(root, "/.agentos/runs/");
    ensureExcluded(root, "/.agentos/memory.json*");
    if (statusOf(root))
        throw new Error("Your checkout has uncommitted changes — commit or stash them first (a run starts from a clean base).");
}
/** Preflight, create the run record, and drive it until it ends or pauses. */
export async function startRun(root, task, cfg, deps, id = newRunId()) {
    if (existsSync(path.join(runDir(root, id), "state.json")))
        throw new Error(`run ${id} already exists — pick another id, or resume it`);
    assertCleanCheckout(root);
    deps.gh(root, ["auth", "status"]);
    const baseBranch = defaultBranch(root);
    const now = new Date().toISOString();
    const s = {
        id, task, status: "queued", baseBranch, base: git(root, ["rev-parse", baseBranch]),
        branch: `agentos/run-${id}`, runWorktree: path.join(runDir(root, id), "wt", "run"),
        createdAt: now, updatedAt: now, subtasks: [], fixRound: 0, findings: [],
    };
    saveRun(root, s);
    logEvent(root, id, { type: "start", task });
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
    const c = { root, s, cfg, deps, live: new Set() };
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
    if (deps.learning && ["pr_open", "needs_human", "failed"].includes(s.status)) {
        // best effort: learning reads the run's record and never changes its status
        await learnFromRun(root, s.id, deps.learning, deps.runners, minutes(cfg.subtaskMinutes));
        try {
            const learned = loadRun(root, s.id);
            Object.assign(s, { learned: learned.learned, kind: learned.kind, draft: learned.draft });
        }
        catch { /* keep s as it is: learning never makes drive() throw */ }
    }
    if (s.status === "pr_open")
        cleanup(c);
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
function pause(c, from) {
    c.s.resumeFrom = from;
    move(c, "paused", `rate limit or quota reached — continue later with: agentos run --resume ${c.s.id}`);
}
/** Runs one agent call: its PID is tracked for cancel, output lines are logged, a failure falls back to the other CLI once. */
function agentRunner(c, agent, mode) {
    const call = async (a, req) => {
        let pid = 0;
        try {
            return await c.deps.runners[a][mode]({
                ...req,
                onSpawn: (p) => { pid = p; c.live.add(p); },
                onLine: (line) => logEvent(c.root, c.s.id, { type: "agent", agent: a, line: redact(line).slice(0, 4000) }),
            });
        }
        finally {
            c.live.delete(pid);
        }
    };
    return async (req) => {
        const res = await call(agent, req);
        if (res.ok || res.rateLimited || cancelRequested(c.root, c.s.id))
            return res;
        const alt = other(agent);
        if (!c.cfg.workers.includes(alt))
            return res;
        const lastLine = res.output.trim().split("\n").filter(Boolean).pop() ?? "";
        logEvent(c.root, c.s.id, { type: "fallback", from: agent, to: alt, why: res.timedOut ? "timeout" : "error", error: redact(lastLine).slice(0, 200) });
        return call(alt, req);
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
async function plan(c) {
    const { s, cfg, root } = c;
    const files = git(s.runWorktree, ["ls-files"]).split("\n").filter(Boolean).slice(0, 300);
    const r = await makePlan(agentRunner(c, cfg.planner, "read"), { task: s.task, facts: recall(root, s.task), files, workers: cfg.workers, notes: notes(c, "planner") }, s.runWorktree, minutes(cfg.subtaskMinutes));
    if (r.rateLimited)
        return pause(c, "planning");
    if (!r.plan)
        return move(c, "needs_human", `planner: ${r.error}`);
    if (r.rejected)
        logEvent(root, s.id, { type: "planner-retry", error: redact(r.rejected).slice(0, 300) });
    s.plan = r.plan;
    s.subtasks = r.plan.subtasks.map((t) => ({
        id: t.id, agent: t.agent, status: "pending", branch: `${s.branch}-${t.id}`,
        worktree: path.join(runDir(root, s.id), "wt", `sub-${t.id}`),
    }));
    logEvent(root, s.id, { type: "plan", plan: r.plan });
    return move(c, "working");
}
function workerPrompt(s, sub, note = "") {
    return [
        `You are one worker in a team. Overall goal: ${s.task}`,
        `Team plan: ${s.plan.summary}`,
        `Your subtask (${sub.id}): ${sub.title}\n${sub.prompt}`,
        sub.files.length ? `Files you are expected to change: ${sub.files.join(", ")}` : "",
        "Rules: work only inside the current directory. Do not commit, push, deploy, run migrations against real databases, or delete anything outside this directory. agentos commits your changes and runs the tests.",
        note,
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
        const res = await agentRunner(c, sub.agent, "write")({ prompt: workerPrompt(s, sub, notes(c, "worker")), cwd: t.worktree, timeoutMs: minutes(cfg.subtaskMinutes) });
        if (res.rateLimited) {
            paused = true;
            t.status = "pending";
            saveRun(root, s);
            return false;
        }
        commitAll(t.worktree, `agentos: ${sub.title}`);
        t.summary = redact(finalText(res.output)).slice(0, 1500);
        const changed = Number(git(root, ["rev-list", "--count", `${s.branch}..${t.branch}`])) > 0;
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
    if (paused)
        return pause(c, "working");
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
    git(cwd, ["add", "-A"]);
    if (!tryGit(cwd, ["commit", "-q", "--no-edit"]).ok || mergeInProgress(cwd)) {
        abortMerge(cwd);
        return "failed";
    }
    logEvent(c.root, c.s.id, { type: "conflict-resolved", files });
    return "ok";
}
async function verify(c) {
    const { s, cfg } = c;
    const v = runVerify(s.runWorktree, cfg.verify, minutes(cfg.subtaskMinutes));
    s.verifyOk = v.ok;
    s.verifyOutput = redact(v.output);
    s.findings = [];
    if (v.ok) {
        // tests first; the review only runs on a change that passes them
        const authors = new Set(s.subtasks.map((t) => t.agent));
        const reviewer = authors.size === 1 && authors.has(cfg.reviewer) ? other(cfg.reviewer) : cfg.reviewer;
        const diff = git(s.runWorktree, ["diff", `${s.base}..HEAD`]);
        const res = await agentRunner(c, reviewer, "read")({ prompt: reviewPrompt(s.task, diff, notes(c, "reviewer")), cwd: s.runWorktree, timeoutMs: minutes(cfg.subtaskMinutes) });
        if (res.rateLimited)
            return pause(c, "verifying");
        // a reviewer that crashed, timed out or was killed reviewed nothing: no PR on its say-so
        if (!res.ok)
            return move(c, "needs_human", `the reviewer (${reviewer}) failed${res.timedOut ? " (timeout)" : ""}: ${redact(res.output.trim().slice(-300))}`);
        s.findings = parseFindings(finalText(res.output)) ?? [{ severity: "low", file: "", line: 0, issue: `the reviewer (${reviewer}) gave no parseable findings` }];
    }
    saveRun(c.root, s);
    logEvent(c.root, s.id, {
        type: "verify", ok: v.ok, findings: s.findings,
        ...(v.ok ? {} : { command: /^\$ (.+?)\s+✗ FAILED/m.exec(s.verifyOutput)?.[1] ?? "", output: s.verifyOutput.slice(-600) }),
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
        note,
    ]
        .filter(Boolean)
        .join("\n\n");
}
async function fix(c) {
    const { s } = c;
    s.fixRound++;
    saveRun(c.root, s);
    const author = s.subtasks[0]?.agent ?? c.cfg.workers[0];
    const res = await agentRunner(c, author, "write")({ prompt: fixPrompt(s, notes(c, "fixer")), cwd: s.runWorktree, timeoutMs: minutes(c.cfg.subtaskMinutes) });
    if (res.rateLimited) {
        s.fixRound--;
        return pause(c, "fixing");
    }
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
        const m = mergeBranch(s.runWorktree, latest, `agentos: merge ${s.baseBranch}`);
        const merged = m.ok ? "ok" : await resolveConflicts(c, m.conflicts, s.subtasks[0]?.agent ?? c.cfg.workers[0]);
        if (merged === "paused")
            return pause(c, "verifying");
        if (merged === "failed")
            return move(c, "needs_human", `${s.baseBranch} moved during the run and merging it conflicted`);
        s.base = latest;
        return move(c, "verifying"); // the tests must pass on the new base too
    }
    // every commit is pushed, so scan each one: a key a fixer removed later is still in the history.
    // --cc adds each merge commit's own lines (what a conflict resolution wrote) without re-listing
    // the lines it took from the base branch, which are already public
    const history = git(s.runWorktree, ["log", "-p", "--cc", "--format=", `${s.base}..HEAD`]);
    const hits = [...new Set([...scanDiff(history), ...scanDiff(git(s.runWorktree, ["diff", `${s.base}..HEAD`]))])];
    if (hits.length)
        return move(c, "needs_human", `secret scan blocked the PR: ${hits.join("; ")}`);
    if (cancelled())
        return move(c, "cancelled", "cancelled by the owner");
    // remote work runs from the checkout: a relative remote URL (../origin.git) resolves against the cwd
    git(root, ["push", "-q", "-u", "origin", s.branch]);
    if (cancelled())
        return move(c, "cancelled", `cancelled by the owner after ${s.branch} was pushed (no PR opened; delete the remote branch if unwanted)`);
    const out = c.deps.gh(root, ["pr", "create", "--base", s.baseBranch, "--head", s.branch, "--title", prTitle(s.task), "--body", prBody(s)]);
    s.prUrl = out.trim().split("\n").pop();
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