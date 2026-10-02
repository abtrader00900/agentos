import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentosHome } from "../ui/projects.js";
import { deciderDir } from "./client.js";
import { isInstalled } from "./install.js";
const MIN_FREE_MB = 1200;
const DEFAULT_URL = "http://127.0.0.1:8017";
const realHealth = async (url) => {
    try {
        const res = await fetch(`${url.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(2000) });
        return res.ok && (await res.json()).status === "ready";
    }
    catch {
        return false;
    }
};
const realSpawn = (bin, args, env, cwd, log) => {
    const out = openSync(log, "a");
    const child = spawn(bin, args, { cwd, env, detached: true, stdio: ["ignore", out, out], windowsHide: true });
    closeSync(out);
    child.unref();
    return child.pid ?? 0;
};
const binName = process.platform === "win32" ? "jev.exe" : "jev";
const binary = (home) => path.join(deciderDir(home), "jev", binName);
const pidFile = (home) => path.join(deciderDir(home), "jev.pid");
/** the executable a pid runs, or undefined when it is gone or this system cannot say */
export function processPath(pid) {
    const opts = { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] };
    try {
        if (process.platform === "win32") {
            return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`], opts).trim() || undefined;
        }
        if (process.platform === "linux")
            return readlinkSync(`/proc/${pid}/exe`);
        return execFileSync("ps", ["-o", "comm=", "-p", String(pid)], opts).trim() || undefined;
    }
    catch {
        return undefined;
    }
}
const canonical = (p) => {
    let out = p;
    try {
        out = realpathSync.native(p);
    }
    catch { /* keep as given */ }
    return process.platform === "win32" ? out.toLowerCase() : out;
};
/**
 * Ours means the pid runs exactly the jev binary agentos installed. A stale pid that Windows handed to another
 * program runs something else, so it is never killed. (A second copy of our own binary is ours to stop.)
 */
const owned = (home, pid, which) => {
    const p = which(pid);
    return !!p && canonical(p) === canonical(binary(home));
};
// ponytail: checking the executable and killing are two steps, so a pid that exits and is reused in between
// could still be hit; no OS offers an atomic check-and-kill here, and the window is microseconds
const realKill = (pid) => {
    try {
        process.kill(pid);
        return true;
    }
    catch {
        return false;
    }
};
const readPid = (home) => {
    try {
        const p = Number(readFileSync(pidFile(home), "utf8").trim());
        return Number.isInteger(p) && p > 0 ? p : undefined;
    }
    catch {
        return undefined;
    }
};
export async function startDecider(o) {
    const home = o.home ?? agentosHome();
    const url = o.url ?? DEFAULT_URL;
    if (!isInstalled(home) || !existsSync(binary(home)))
        throw new Error("the decider is not installed — run: agentos decider install");
    const free = Math.round((o.freeMb ?? (() => os.freemem() / 1048576))());
    if (free < MIN_FREE_MB && !o.force) {
        throw new Error(`only ${free} MB free; jevos needs about 1 GB (up to 1.4 GB), so start needs ${MIN_FREE_MB} MB. Close some apps, or: agentos decider start --force`);
    }
    const key = randomBytes(16).toString("hex");
    // owner-only: writeFileSync applies mode on creation only, so replace rather than overwrite
    const keyPath = path.join(deciderDir(home), "key");
    rmSync(keyPath, { force: true });
    writeFileSync(keyPath, `${key}\n`, { mode: 0o600 });
    // bind the host we then poll: a configured [::1] must not become a server listening on 127.0.0.1
    const { hostname, port } = new URL(url);
    const pid = (o.spawnFn ?? realSpawn)(binary(home), ["serve", "--host", hostname.replace(/^\[|\]$/g, ""), "--port", port || "8017"], { ...process.env, JEV_API_KEY: key }, path.dirname(binary(home)), path.join(deciderDir(home), "jev.log"));
    writeFileSync(pidFile(home), `${pid}\n`);
    const health = o.health ?? realHealth;
    for (const until = Date.now() + (o.waitMs ?? 60_000); Date.now() < until; await new Promise((r) => setTimeout(r, o.pollMs ?? 500))) {
        if (await health(url)) {
            // the answer must come from the jev we just started, not from something else already on that port
            if (owned(home, pid, o.processPath ?? processPath))
                return pid;
            rmSync(pidFile(home), { force: true });
            rmSync(keyPath, { force: true });
            throw new Error(`${url} answers /health, but not from the jev agentos started (pid ${pid}): another server holds that address — stop it or set decider.url to a free port`);
        }
    }
    if (pid > 0 && owned(home, pid, o.processPath ?? processPath))
        realKill(pid); // a jev that never got ready is not left behind
    rmSync(pidFile(home), { force: true });
    rmSync(keyPath, { force: true });
    throw new Error(`jevos (pid ${pid}) is not ready after ${Math.round((o.waitMs ?? 60_000) / 1000)} s — see ${path.join(deciderDir(home), "jev.log")}`);
}
/**
 * Stops jevos only when its /health answers and the recorded pid runs the jev binary agentos installed.
 * A stale or reused pid is never killed; its files are removed either way.
 */
export async function stopDecider(o) {
    const home = o.home ?? agentosHome();
    const url = o.url ?? DEFAULT_URL;
    const pid = readPid(home);
    const alive = await (o.health ?? realHealth)(url);
    const ours = alive && pid !== undefined && owned(home, pid, o.processPath ?? processPath);
    if (ours)
        (o.kill ?? realKill)(pid);
    rmSync(pidFile(home), { force: true });
    rmSync(path.join(deciderDir(home), "key"), { force: true });
    return ours ? "stopped" : "not-running";
}
export async function deciderStatus(o) {
    const home = o.home ?? agentosHome();
    const installed = isInstalled(home);
    const running = installed && (await (o.health ?? realHealth)(o.url ?? DEFAULT_URL));
    const pid = running ? readPid(home) : undefined;
    return { installed, running, ...(pid ? { pid } : {}) };
}
//# sourceMappingURL=service.js.map