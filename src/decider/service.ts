import { spawn } from "node:child_process";
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

const binary = (home: string) => path.join(deciderDir(home), "jev", process.platform === "win32" ? "jev.exe" : "jev");
const pidFile = (home: string) => path.join(deciderDir(home), "jev.pid");
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
  const port = new URL(url).port || "8017";
  const pid = (o.spawnFn ?? realSpawn)(binary(home), ["serve", "--host", "127.0.0.1", "--port", port], { ...process.env, JEV_API_KEY: key }, path.dirname(binary(home)), path.join(deciderDir(home), "jev.log"));
  writeFileSync(pidFile(home), `${pid}\n`);
  const health = o.health ?? realHealth;
  for (const until = Date.now() + (o.waitMs ?? 60_000); Date.now() < until; await new Promise((r) => setTimeout(r, o.pollMs ?? 500))) {
    if (await health(url)) return pid;
  }
  throw new Error(`jevos (pid ${pid}) is not ready after ${Math.round((o.waitMs ?? 60_000) / 1000)} s — see ${path.join(deciderDir(home), "jev.log")}`);
}

/** stops jevos only when its /health answers: a stale pid file is removed, a bare pid is never killed */
export async function stopDecider(o: { home?: string; url?: string; health?: Health; kill?: (pid: number) => void }): Promise<"stopped" | "not-running"> {
  const home = o.home ?? agentosHome();
  const pid = readPid(home);
  const alive = await (o.health ?? realHealth)(o.url ?? DEFAULT_URL);
  if (alive && pid) (o.kill ?? ((p) => process.kill(p)))(pid);
  rmSync(pidFile(home), { force: true });
  rmSync(path.join(deciderDir(home), "key"), { force: true });
  return alive && pid ? "stopped" : "not-running";
}

export async function deciderStatus(o: { home?: string; url?: string; health?: Health }): Promise<{ installed: boolean; running: boolean; pid?: number }> {
  const home = o.home ?? agentosHome();
  const installed = isInstalled(home);
  const running = installed && (await (o.health ?? realHealth)(o.url ?? DEFAULT_URL));
  const pid = running ? readPid(home) : undefined;
  return { installed, running, ...(pid ? { pid } : {}) };
}
