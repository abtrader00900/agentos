import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentosHome } from "../ui/projects.js";
import { deciderDir } from "./client.js";
import { isInstalled } from "./install.js";

const MIN_FREE_MB = 1200;
const DEFAULT_URL = "http://127.0.0.1:8017";
type Spawn = (bin: string, args: string[], env: Record<string, string | undefined>, cwd: string, log: string) => number;
type Health = (url: string) => Promise<boolean>;
/** false means nothing was killed; anything else counts as killed */
type Kill = (pid: number, url: string) => unknown;

const realHealth: Health = async (url) => {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok && ((await res.json()) as { status?: string }).status === "ready";
  } catch {
    return false;
  }
};

const realSpawn: Spawn = (bin, args, env, cwd, log) => {
  const out = openSync(log, "a");
  const child = spawn(bin, args, { cwd, env, detached: true, stdio: ["ignore", out, out], windowsHide: true });
  closeSync(out);
  child.unref();
  return child.pid ?? 0;
};

const binName = process.platform === "win32" ? "jev.exe" : "jev";
const binary = (home: string) => path.join(deciderDir(home), "jev", binName);
const pidFile = (home: string) => path.join(deciderDir(home), "jev.pid");

const portOf = (url: string) => new URL(url).port || "8017";

/** the pids holding a tcp socket on this local port, or undefined when no tool on this box could say */
const portOwners = (port: string): Set<number> | undefined => {
  const run = (bin: string, args: string[]) => execFileSync(bin, args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  const pids = new Set<number>();
  const add = (n: number) => { if (Number.isInteger(n) && n > 0) pids.add(n); };
  const localIsPort = (cols: string[], at: number) => (cols[at] ?? "").endsWith(`:${port}`);
  try {
    if (process.platform === "win32") {
      // "TCP  127.0.0.1:8017  0.0.0.0:0  LISTENING  1234": the state word is localized, "TCP" and the columns are not
      for (const line of run("netstat", ["-ano", "-p", "tcp"]).split("\n")) {
        const cols = line.trim().split(/\s+/);
        if (cols[0] === "TCP" && cols.length >= 5 && localIsPort(cols, 1)) add(Number(cols[cols.length - 1]));
      }
    } else {
      for (const line of run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).split("\n")) add(Number(line.trim()));
    }
    return pids;
  } catch {
    // no netstat, or no lsof (it also exits non-zero when nobody listens): on Linux ss is the other answer
  }
  try {
    // "LISTEN 0 4096 127.0.0.1:8017 0.0.0.0:* users:((\"jev\",pid=1234,fd=7))"
    for (const line of run("ss", ["-ltnpH"]).split("\n")) {
      if (localIsPort(line.trim().split(/\s+/), 3)) for (const m of line.matchAll(/pid=(\d+)/g)) add(Number(m[1]));
    }
    return pids;
  } catch {
    return undefined; // nothing here can name the owner of the port, so nothing may be killed
  }
};

/**
 * The real kill: only the process that holds the port of the url whose /health just answered.
 * A stale pid, a reused pid and a pid belonging to some other jevos all own no socket there, so none of them is killed.
 */
const killOwner: Kill = (pid, url) => {
  if (pid <= 0 || !portOwners(portOf(url))?.has(pid)) return false;
  try {
    process.kill(pid);
    return true;
  } catch {
    return false;
  }
};
const readPid = (home: string) => {
  try { const p = Number(readFileSync(pidFile(home), "utf8").trim()); return Number.isInteger(p) && p > 0 ? p : undefined; } catch { return undefined; }
};

export async function startDecider(o: {
  home?: string; url?: string; force?: boolean; freeMb?: () => number;
  spawnFn?: Spawn; health?: Health; waitMs?: number; pollMs?: number;
}): Promise<number> {
  const home = o.home ?? agentosHome();
  const url = o.url ?? DEFAULT_URL;
  if (!isInstalled(home) || !existsSync(binary(home))) throw new Error("the decider is not installed — run: agentos decider install");
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
    if (await health(url)) return pid;
  }
  killOwner(pid, url); // a jev that took the port but never got ready is not left behind: stop cannot end it while /health stays silent
  rmSync(pidFile(home), { force: true });
  rmSync(keyPath, { force: true });
  throw new Error(`jevos (pid ${pid}) is not ready after ${Math.round((o.waitMs ?? 60_000) / 1000)} s — see ${path.join(deciderDir(home), "jev.log")}`);
}

/** stops jevos only when its /health answers and the recorded pid is the process holding that url's port: a stale or reused pid is never killed, only its files are removed */
export async function stopDecider(o: { home?: string; url?: string; health?: Health; kill?: Kill }): Promise<"stopped" | "not-running"> {
  const home = o.home ?? agentosHome();
  const url = o.url ?? DEFAULT_URL;
  const pid = readPid(home);
  const alive = await (o.health ?? realHealth)(url);
  const stopped = alive && pid !== undefined && (o.kill ?? killOwner)(pid, url) !== false;
  rmSync(pidFile(home), { force: true });
  rmSync(path.join(deciderDir(home), "key"), { force: true });
  return stopped ? "stopped" : "not-running";
}

export async function deciderStatus(o: { home?: string; url?: string; health?: Health }): Promise<{ installed: boolean; running: boolean; pid?: number }> {
  const home = o.home ?? agentosHome();
  const installed = isInstalled(home);
  const running = installed && (await (o.health ?? realHealth)(o.url ?? DEFAULT_URL));
  const pid = running ? readPid(home) : undefined;
  return { installed, running, ...(pid ? { pid } : {}) };
}
