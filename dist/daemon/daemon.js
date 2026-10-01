import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/loader.js";
import { runArgs } from "../mcp/orchestrator/server.js";
import { runLockState } from "../orchestrator/engine.js";
import { loadRun, newRunId, TERMINAL } from "../orchestrator/run.js";
import { agentosHome, getProject, listProjects } from "../ui/projects.js";
import { scanCi } from "./ci.js";
import { addJob, listJobs, nextJob, startedOn, updateJob } from "./queue.js";
import { dueSchedules } from "./schedule.js";
import { loadSettings } from "./settings.js";
/** a run that ended without a result this many times is given up */
const MAX_ATTEMPTS = 3;
export const stateFile = (home = agentosHome()) => path.join(home, ".agentos", "daemon-state.json");
export function readState(home = agentosHome()) {
    try {
        const s = JSON.parse(readFileSync(stateFile(home), "utf8"));
        return { ...s, lastFired: s.lastFired ?? {} };
    }
    catch {
        return { lastFired: {} };
    }
}
/** one writer (the daemon), so a plain atomic rename is enough */
export function writeState(home, s) {
    const file = stateFile(home);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 2));
    renameSync(`${file}.tmp`, file);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export class Daemon {
    d;
    current;
    /** the job last held back by the memory gate (so the reason is logged once) */
    waitingOn;
    constructor(d) {
        this.d = d;
    }
    get running() {
        return this.current?.job;
    }
    /** resolves when the job in flight (if any) has finished and been recorded */
    async idle() {
        while (this.current)
            await this.current.done;
    }
    /** At startup: adopt a run whose engine still lives, re-queue (as paused) one whose engine died. */
    recover() {
        for (const job of listJobs(this.d.home).filter((j) => j.status === "running")) {
            const root = getProject(job.projectId, this.d.home)?.path;
            if (!root || !job.runId) {
                updateJob(job.id, { status: job.runId ? "paused" : "queued" }, this.d.home);
                continue;
            }
            if (!this.current && runLockState(root, job.runId).state === "live") {
                const done = this.waitForEngine(root, job.runId).then(() => this.finish(job, root));
                this.track(job, done);
            }
            else {
                updateJob(job.id, { status: "paused" }, this.d.home);
            }
        }
    }
    async tick() {
        const { home } = this.d;
        const now = this.d.now();
        const settings = loadSettings(home);
        const state = readState(home);
        state.lastTick = now.toISOString();
        const projects = this.enabledProjects();
        for (const p of projects) {
            const r = dueSchedules(p.id, p.daemon.schedules, state.lastFired, now);
            for (const e of r.errors)
                this.d.log(`${p.name}: ${e}`);
            Object.assign(state.lastFired, r.seen);
            for (const s of r.due) {
                addJob({ projectId: p.id, task: s.task, quick: s.quick, source: "schedule", dedupeKey: `schedule:${s.key}:${s.firedFor.toISOString()}` }, home, now);
            }
        }
        if (!state.lastCiCheck || now.getTime() - Date.parse(state.lastCiCheck) >= settings.ciEverySeconds * 1000) {
            state.lastCiCheck = now.toISOString();
            for (const p of projects.filter((x) => x.daemon.ciFix)) {
                try {
                    for (const fix of scanCi({ projectId: p.id, root: p.path, gh: this.d.gh, jobs: listJobs(home), maxFixes: settings.maxCiFixesPerPr })) {
                        addJob({ projectId: p.id, task: fix.task, quick: true, source: "ci", onto: fix.onto, dedupeKey: fix.dedupeKey }, home, now);
                    }
                }
                catch (e) {
                    this.d.log(`${p.name}: CI check skipped: ${e.message.split("\n")[0]}`); // no gh login, no network: the queue goes on
                }
            }
        }
        writeState(home, state);
        if (this.current)
            return;
        if (state.pauseUntil && now.getTime() < Date.parse(state.pauseUntil))
            return;
        const jobs = listJobs(home);
        const job = nextJob(jobs);
        if (!job)
            return;
        if (job.status === "queued" && startedOn(jobs, now) >= settings.maxRunsPerDay)
            return;
        const project = getProject(job.projectId, home);
        if (!project || !existsSync(project.path))
            return this.fail(job, "the project folder is gone");
        let config;
        try {
            config = loadConfig(project.path).config;
        }
        catch (e) {
            return this.fail(job, `agent.config.yaml: ${e.message.split("\n")[0]}`);
        }
        if (!config.daemon?.enabled)
            return this.fail(job, "daemon.enabled is off in this project's agent.config.yaml");
        const needMb = config.orchestrator?.minFreeMemoryMb ?? 1500;
        const freeMb = Math.round(this.d.freeMemMb());
        if (freeMb < needMb) {
            // said once per job, not every tick: the owner must be able to see why nothing starts
            if (this.waitingOn !== job.id)
                this.d.log(`job ${job.id} waits for memory: ${freeMb} MB free, ${needMb} MB needed (orchestrator.minFreeMemoryMb)`);
            this.waitingOn = job.id;
            return; // try again next tick
        }
        this.waitingOn = undefined;
        this.start(job, project.path, now);
    }
    enabledProjects() {
        const out = [];
        for (const p of listProjects(this.d.home).filter((x) => !x.missing)) {
            try {
                const daemon = loadConfig(p.path).config.daemon;
                if (daemon?.enabled)
                    out.push({ id: p.id, name: p.name, path: p.path, daemon });
            }
            catch (e) {
                this.d.log(`${p.name}: agent.config.yaml: ${e.message.split("\n")[0]}`);
            }
        }
        return out;
    }
    start(job, root, now) {
        const resume = job.status === "paused" && !!job.runId;
        const runId = job.runId ?? newRunId(now);
        const args = resume ? ["run", "--resume", runId] : runArgs(runId, job.task, job.quick, job.onto);
        // compare-and-swap inside the queue lock: only while the job is still waiting, and only while we
        // still hold the daemon lock (a takeover during a long tick hands the decision to the new daemon).
        // ponytail: the two locks are separate files, so a takeover in the instant after this check can still
        // let one run start late; the engine's own per-run lock still refuses a second engine on the same run
        const owns = this.d.owns;
        const started = updateJob(job.id, { status: "running", runId, startedAt: job.startedAt ?? now.toISOString(), attempts: (job.attempts ?? 0) + 1 }, this.d.home, ["queued", "paused"], owns && (() => owns()));
        if (!started)
            return;
        this.d.log(`${resume ? "resume" : "start"} job ${job.id} (${job.source}) as run ${runId}`);
        const done = this.d.launch(root, args).catch(() => -1).then(() => this.finish(started, root));
        this.track(started, done);
    }
    track(job, done) {
        const settled = done.catch((e) => this.d.log(`job ${job.id}: ${e.message}`)).finally(() => { this.current = undefined; });
        this.current = { job, done: settled };
    }
    async waitForEngine(root, runId) {
        while (runLockState(root, runId).state === "live")
            await sleep(this.d.pollMs ?? 5000);
    }
    finish(job, root) {
        const now = this.d.now();
        let s;
        try {
            s = loadRun(root, job.runId);
        }
        catch {
            return this.fail(job, "the run left no record (it could not start)");
        }
        if (s.status === "pr_open") {
            updateJob(job.id, { status: "done", endedAt: now.toISOString(), result: s.prUrl ?? "pr_open" }, this.d.home);
        }
        else if (s.status === "paused") {
            updateJob(job.id, { status: "paused" }, this.d.home);
            const state = readState(this.d.home);
            state.pauseUntil = new Date(now.getTime() + loadSettings(this.d.home).pauseMinutesOnLimit * 60_000).toISOString();
            writeState(this.d.home, state);
            this.d.log(`job ${job.id}: rate limit; the queue waits until ${state.pauseUntil}`);
        }
        else if (TERMINAL.includes(s.status)) {
            this.fail(job, s.reason ?? s.status);
        }
        else if ((job.attempts ?? 1) >= MAX_ATTEMPTS) {
            this.fail(job, `the run stopped without finishing ${MAX_ATTEMPTS} times (last status ${s.status}); see agentos run --status ${job.runId}`);
        }
        else {
            updateJob(job.id, { status: "paused" }, this.d.home); // the engine died mid-run: resume it
        }
    }
    fail(job, why) {
        updateJob(job.id, { status: "failed", endedAt: this.d.now().toISOString(), result: why }, this.d.home);
        this.d.log(`job ${job.id} failed: ${why}`);
    }
}
//# sourceMappingURL=daemon.js.map