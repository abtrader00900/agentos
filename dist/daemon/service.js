import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withLock } from "../core/jsonstore.js";
import { agentosHome } from "../ui/projects.js";
import { Daemon, readState, writeState } from "./daemon.js";
import { listJobs, startedOn } from "./queue.js";
import { loadSettings } from "./settings.js";
const TASK_NAME = "agentos daemon";
const LOG_MAX = 1024 * 1024;
const dir = (home) => path.join(home, ".agentos");
export const lockFile = (home = agentosHome()) => path.join(dir(home), "daemon.lock");
export const logFile = (home = agentosHome()) => path.join(dir(home), "daemon.log");
const stopFile = (home) => path.join(dir(home), "daemon.stop");
export const cliPath = () => fileURLToPath(new URL("../cli.js", import.meta.url));
const alive = (pid) => {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e) {
        return e.code === "EPERM";
    }
};
export function readLock(home = agentosHome()) {
    try {
        const l = JSON.parse(readFileSync(lockFile(home), "utf8"));
        return Number.isInteger(l.pid) && typeof l.token === "string" ? l : undefined;
    }
    catch {
        return undefined;
    }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** the lock of a daemon that answers a ping within waitMs, else undefined (none, dead, or a reused PID) */
export async function answering(home = agentosHome(), waitMs = 5000) {
    const lock = readLock(home);
    if (!lock || !alive(lock.pid))
        return undefined; // dead for certain; alive is only a hint
    const nonce = randomBytes(6).toString("hex");
    const ping = path.join(dir(home), `daemon.ping.${nonce}`);
    const pong = path.join(dir(home), `daemon.pong.${nonce}`);
    writeFileSync(ping, "");
    try {
        for (const until = Date.now() + waitMs; Date.now() < until; await sleep(100)) {
            try {
                if (readFileSync(pong, "utf8") === lock.token)
                    return lock;
            }
            catch { /* not answered yet */ }
        }
        return undefined;
    }
    finally {
        rmSync(ping, { force: true });
        rmSync(pong, { force: true });
    }
}
/**
 * The daemon's side, run every half second: answer pings with its token, obey a stop request
 * addressed to it, and step down when its lock was taken over (after a long sleep, say).
 */
export function controlTick(home, token) {
    for (const f of readdirSync(dir(home))) {
        const m = /^daemon\.ping\.([0-9a-f]{12})$/.exec(f);
        if (m) {
            try {
                writeFileSync(path.join(dir(home), `daemon.pong.${m[1]}`), token);
            }
            catch { /* the pinger gave up */ }
        }
    }
    try {
        if (readFileSync(stopFile(home), "utf8").trim() === token) {
            rmSync(stopFile(home), { force: true });
            return "stop";
        }
    }
    catch { /* no stop request */ }
    return readLock(home)?.token === token ? "run" : "stop";
}
/** Take the lock only if it still holds what we saw (nothing, or a lock whose holder did not answer). */
export function claimLock(home, seen, mine) {
    mkdirSync(dir(home), { recursive: true });
    return withLock(lockFile(home), () => {
        const now = readLock(home);
        if (now && now.token !== seen?.token)
            return false;
        writeFileSync(lockFile(home), JSON.stringify(mine));
        return true;
    });
}
function releaseLock(home, token) {
    withLock(lockFile(home), () => {
        if (readLock(home)?.token === token)
            rmSync(lockFile(home), { force: true });
    });
}
/** for display only (dashboard, status line): a lock, a live PID and a recent tick; nothing is decided on it */
export function daemonStatus(home = agentosHome()) {
    const lock = readLock(home);
    const s = readState(home);
    const settings = loadSettings(home);
    const fresh = !!s.lastTick && Date.now() - Date.parse(s.lastTick) < (settings.tickSeconds * 3 + 60) * 1000;
    const running = !!lock && alive(lock.pid) && fresh;
    return { running, pid: running ? lock.pid : undefined, lastTick: s.lastTick, pauseUntil: s.pauseUntil, today: startedOn(listJobs(home), new Date()), maxRunsPerDay: settings.maxRunsPerDay };
}
const spawnLoop = (cli) => {
    const child = spawn(process.execPath, [cli, "daemon", "run"], { detached: true, stdio: "ignore", windowsHide: true, env: process.env });
    child.unref();
    return child.pid ?? 0;
};
/**
 * `daemon start`: refuse if a daemon answers, else spawn the loop detached and hidden; the loop
 * claims the lock itself, so wait until it holds it. Of two starts at once, the loser says who won.
 */
export async function startDaemon(home = agentosHome(), cli = cliPath(), launch = spawnLoop, waitMs = 5000, claimMs = 10_000) {
    const running = await answering(home, waitMs);
    if (running)
        throw new Error(`the daemon is already running (pid ${running.pid})`);
    rmSync(stopFile(home), { force: true }); // a stop request nobody picked up must not stop the new daemon
    const pid = launch(cli);
    for (const until = Date.now() + claimMs; Date.now() < until; await sleep(100)) {
        const lock = readLock(home);
        if (lock?.pid === pid)
            return pid;
        if (lock && lock.pid !== pid && (await answering(home, 1000)))
            throw new Error(`the daemon is already running (pid ${lock.pid})`);
    }
    throw new Error(`the daemon (pid ${pid}) did not start within ${Math.round(claimMs / 1000)} s — see ${logFile(home)}`);
}
/**
 * Asks the daemon to stop after its current tick (a run in flight keeps going; the next daemon
 * adopts it). "asked": it has not let go of its lock yet; "replaced": another daemon holds it now.
 */
export async function stopDaemon(home = agentosHome(), waitMs = 5000, graceMs = 15_000) {
    const lock = await answering(home, waitMs);
    if (!lock)
        return "not-running";
    writeFileSync(stopFile(home), lock.token);
    for (const until = Date.now() + graceMs; Date.now() < until; await sleep(200)) {
        const now = readLock(home);
        if (!now)
            return "stopped";
        if (now.token !== lock.token) {
            rmSync(stopFile(home), { force: true }); // addressed to a daemon that is gone
            return "replaced";
        }
    }
    return "asked";
}
function log(home, line) {
    const file = logFile(home);
    try {
        if (statSync(file).size > LOG_MAX)
            renameSync(file, `${file}.1`);
    }
    catch { /* no log yet */ }
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
}
/** `daemon run`: the foreground loop (what `start` and the logon task run) */
export async function runDaemon(home = agentosHome()) {
    mkdirSync(dir(home), { recursive: true });
    const seen = readLock(home);
    if (seen && (await answering(home)))
        throw new Error(`the daemon is already running (pid ${seen.pid})`);
    const token = randomBytes(16).toString("hex");
    if (!claimLock(home, seen, { pid: process.pid, token }))
        throw new Error("another daemon claimed the lock first");
    writeState(home, { ...readState(home), pid: process.pid, startedAt: new Date().toISOString() });
    let stopping = false;
    const stop = () => { stopping = true; };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    // pings are answered even while a tick waits on a run; a tick's own sync work only delays the answer
    const control = setInterval(() => {
        try {
            if (controlTick(home, token) === "stop")
                stopping = true;
        }
        catch { /* next time */ }
    }, 500);
    const gh = (cwd, args) => execFileSync("gh", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const d = new Daemon({
        home, gh, now: () => new Date(), freeMemMb: () => os.freemem() / 1048576, log: (l) => log(home, l),
        owns: () => readLock(home)?.token === token,
        launch: (root, args) => new Promise((resolve) => {
            const out = openSync(logFile(home), "a");
            const child = spawn(process.execPath, [cliPath(), ...args], { cwd: root, stdio: ["ignore", out, out], windowsHide: true });
            child.on("error", () => resolve(-1));
            child.on("close", (code) => { closeSync(out); resolve(code ?? -1); });
        }),
    });
    log(home, `daemon started (pid ${process.pid})`);
    d.recover();
    try {
        while (!stopping) {
            try {
                await d.tick();
            }
            catch (e) {
                log(home, `tick failed: ${e.message}`);
            }
            const wait = loadSettings(home).tickSeconds * 1000;
            for (let t = 0; t < wait && !stopping; t += 500)
                await sleep(500);
        }
    }
    finally {
        clearInterval(control);
        releaseLock(home, token);
        log(home, "daemon stopped");
    }
}
export const taskArgs = (node, cli) => ["/Create", "/TN", TASK_NAME, "/SC", "ONLOGON", "/RL", "LIMITED", "/F", "/TR", `"${node}" "${cli}" daemon start`];
const realExec = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", windowsHide: true });
/** a Task Scheduler task that starts the daemon at logon, as this user, not elevated */
export function installTask(cli = cliPath(), exec = realExec, platform = process.platform) {
    if (platform !== "win32")
        throw new Error("daemon install uses Windows Task Scheduler; on Linux or macOS start it from your own service manager with: agentos daemon start");
    if (/[\\/]_npx[\\/]/.test(cli))
        throw new Error(`agentos runs from the npx cache (${cli}), which moves; install it first: npm i -g @basit0090/agent-os`);
    exec("schtasks", taskArgs(process.execPath, cli));
}
export function uninstallTask(exec = realExec) {
    exec("schtasks", ["/Delete", "/TN", TASK_NAME, "/F"]);
}
/** minutes before Windows sleeps on AC power (0 = never), from `powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE` */
export function parseStandbyMinutes(out) {
    const m = /Current AC Power Setting Index:\s*0x([0-9a-f]+)/i.exec(out);
    return m ? Math.round(parseInt(m[1], 16) / 60) : undefined;
}
export const isInstalled = (exec = realExec) => {
    try {
        exec("schtasks", ["/Query", "/TN", TASK_NAME]);
        return true;
    }
    catch {
        return false;
    }
};
/** whether the daemon has written a log yet (status prints its path) */
export const hasLog = (home = agentosHome()) => existsSync(logFile(home));
//# sourceMappingURL=service.js.map