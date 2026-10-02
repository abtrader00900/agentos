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
type Kill = (pid: number) => unknown;

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

/** is the process at pid still jevos? a pid file can be stale and the number reused by anything */
const isJev = (pid: number): boolean => {
  try {
    const out =
      process.platform === "win32"
        ? execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true })
        : execFileSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" });
    return out.toLowerCase().includes(binName);
  } catch {
    return false; // no such process, or no tasklist/ps to ask: there is nothing we may kill
  }
};

/** the real kill: a confirmed jevos only, false when it refused or the process was already gone */
const killJev: Kill = (pid) => {
  if (pid <= 0 || !isJev(pid)) return false;
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
  killJev(pid); // a jev that never got ready is not left behind: stop could not end it while /health stays silent
  rmSync(pidFile(home), { force: true });
  rmSync(keyPath, { force: true });
  throw new Error(`jevos (pid ${pid}) is not ready after ${Math.round((o.waitMs ?? 60_000) / 1000)} s — see ${path.join(deciderDir(home), "jev.log")}`);
}

/** stops jevos only when its /health answers and the recorded pid is still a jevos: a stale or reused pid is never killed, only its files are removed */
export async function stopDecider(o: { home?: string; url?: string; health?: Health; kill?: Kill }): Promise<"stopped" | "not-running"> {
  const home = o.home ?? agentosHome();
  const pid = readPid(home);
  const alive = await (o.health ?? realHealth)(o.url ?? DEFAULT_URL);
  const stopped = alive && pid !== undefined && (o.kill ?? killJev)(pid) !== false;
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
