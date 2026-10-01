import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentosHome } from "../ui/projects.js";
import { Daemon, readState, writeState } from "./daemon.js";
import { listJobs, startedOn } from "./queue.js";
import { loadSettings } from "./settings.js";

const TASK_NAME = "agentos daemon";
const LOG_MAX = 1024 * 1024;
/** a pid file this many ticks behind the daemon's own heartbeat is a crash leftover, and its pid may have been reused since */
const STALE_TICKS = 4;

export const pidFile = (home = agentosHome()) => path.join(home, ".agentos", "daemon.pid");
export const logFile = (home = agentosHome()) => path.join(home, ".agentos", "daemon.log");
export const cliPath = () => fileURLToPath(new URL("../cli.js", import.meta.url));

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
};
function recordedPid(home: string): number | undefined {
  try {
    const pid = Number(readFileSync(pidFile(home), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch { return undefined; }
}

const at = (iso?: string) => (iso ? Date.parse(iso) : 0);

/** a live pid is not proof on its own (pids are reused): the daemon's heartbeat in daemon-state.json has to name it and still be warm */
function ours(home: string, pid: number): boolean {
  const s = readState(home);
  if (s.pid === undefined) return true; // no daemon has written state here, so the pid file is all there is to go on
  return s.pid === pid && Date.now() - Math.max(at(s.lastTick), at(s.startedAt)) < loadSettings(home).tickSeconds * STALE_TICKS * 1000;
}

function livePid(home: string): number | undefined {
  const pid = recordedPid(home);
  return pid !== undefined && alive(pid) && ours(home, pid) ? pid : undefined;
}

export function daemonStatus(home = agentosHome()) {
  const pid = livePid(home);
  const s = readState(home);
  return { running: !!pid, pid, lastTick: s.lastTick, pauseUntil: s.pauseUntil, today: startedOn(listJobs(home), new Date()), maxRunsPerDay: loadSettings(home).maxRunsPerDay };
}

/** `daemon start`: spawn the loop detached and hidden, then return its pid. The check here is only a friendly early no: the pid file itself is claimed in the child, by `runDaemon`. */
export function startDaemon(home = agentosHome(), cli = cliPath()): number {
  const running = livePid(home);
  if (running) throw new Error(`the daemon is already running (pid ${running})`);
  const child = spawn(process.execPath, [cli, "daemon", "run"], { detached: true, stdio: "ignore", windowsHide: true, env: process.env });
  child.unref();
  return child.pid ?? 0;
}

/** stops the loop only: a run in flight keeps going, and the next daemon adopts it */
export function stopDaemon(home = agentosHome()): boolean {
  const pid = livePid(home);
  if (!pid) return false;
  process.kill(pid);
  rmSync(pidFile(home), { force: true });
  return true;
}

function log(home: string, line: string): void {
  const file = logFile(home);
  try { if (statSync(file).size > LOG_MAX) renameSync(file, `${file}.1`); } catch { /* no log yet */ }
  appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
}

/** creates the pid file, or false if someone else already holds it (`wx` is atomic, so of two daemons starting at once exactly one wins) */
function claimPidFile(home: string): boolean {
  let fd: number;
  try { fd = openSync(pidFile(home), "wx"); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
  writeSync(fd, String(process.pid));
  closeSync(fd);
  return true;
}

/** `daemon run`: the foreground loop (what `start` and the logon task run) */
export async function runDaemon(home = agentosHome()): Promise<void> {
  mkdirSync(path.join(home, ".agentos"), { recursive: true });
  if (!claimPidFile(home)) {
    const running = livePid(home);
    if (running && running !== process.pid) throw new Error(`the daemon is already running (pid ${running})`);
    rmSync(pidFile(home), { force: true }); // a crashed daemon's file, or our own: take it over
    if (!claimPidFile(home)) throw new Error(`the daemon is already running (pid ${recordedPid(home) ?? "unknown"})`);
  }
  // before anything slow: the heartbeat is what makes this pid file ours, so a second daemon cannot mistake it for a leftover
  writeState(home, { ...readState(home), pid: process.pid, startedAt: new Date().toISOString() });
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const gh = (cwd: string, args: string[]) => execFileSync("gh", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const d = new Daemon({
    home, gh, now: () => new Date(), freeMemMb: () => os.freemem() / 1048576, log: (l) => log(home, l),
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
      try { await d.tick(); } catch (e) { log(home, `tick failed: ${(e as Error).message}`); }
      const wait = loadSettings(home).tickSeconds * 1000;
      for (let t = 0; t < wait && !stopping; t += 500) await new Promise((r) => setTimeout(r, 500));
    }
  } finally {
    log(home, "daemon stopped");
    if (recordedPid(home) === process.pid) rmSync(pidFile(home), { force: true });
  }
}

export const taskArgs = (node: string, cli: string): string[] =>
  ["/Create", "/TN", TASK_NAME, "/SC", "ONLOGON", "/RL", "LIMITED", "/F", "/TR", `"${node}" "${cli}" daemon start`];

type Exec = (cmd: string, args: string[]) => string;
const realExec: Exec = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", windowsHide: true });

/** a Task Scheduler task that starts the daemon at logon, as this user, not elevated */
export function installTask(cli = cliPath(), exec: Exec = realExec, platform = process.platform): void {
  if (platform !== "win32") throw new Error("daemon install uses Windows Task Scheduler; on Linux or macOS start it from your own service manager with: agentos daemon start");
  if (/[\\/]_npx[\\/]/.test(cli)) throw new Error(`agentos runs from the npx cache (${cli}), which moves; install it first: npm i -g @basit0090/agent-os`);
  exec("schtasks", taskArgs(process.execPath, cli));
}

export function uninstallTask(exec: Exec = realExec): void {
  exec("schtasks", ["/Delete", "/TN", TASK_NAME, "/F"]);
}

/** minutes before Windows sleeps on AC power (0 = never), from `powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE` */
export function parseStandbyMinutes(out: string): number | undefined {
  const m = /Current AC Power Setting Index:\s*0x([0-9a-f]+)/i.exec(out);
  return m ? Math.round(parseInt(m[1], 16) / 60) : undefined;
}

export const isInstalled = (exec: Exec = realExec): boolean => {
  try { exec("schtasks", ["/Query", "/TN", TASK_NAME]); return true; } catch { return false; }
};

/** whether the daemon has written a log yet (status prints its path) */
export const hasLog = (home = agentosHome()) => existsSync(logFile(home));
