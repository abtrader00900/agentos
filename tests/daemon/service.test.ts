import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { answering, claimLock, controlTick, daemonStatus, lockFile, installTask, isInstalled, startupDir, startupScript, uninstallTask, parseStandbyMinutes, startDaemon, stopDaemon } from "../../src/daemon/service.js";
import { writeState } from "../../src/daemon/daemon.js";

let home: string;
beforeEach(() => { home = realpathSync.native(mkdtempSync(path.join(tmpdir(), "agentos-svc-"))); });

describe("daemon service", () => {
  /** stands in for a running daemon: answers pings and reports a stop request, every 50 ms */
  const fakeDaemon = (token: string) => {
    const seen: string[] = [];
    const timer = setInterval(() => seen.push(controlTick(home, token)), 50);
    return { seen, stop: () => clearInterval(timer) };
  };
  const lockAs = (token: string, pid = process.pid) => {
    mkdirSync(path.dirname(lockFile(home)), { recursive: true });
    writeFileSync(lockFile(home), JSON.stringify({ pid, token }));
  };

  it("shows running only with a lock, a live pid and a recent tick", () => {
    expect(daemonStatus(home)).toMatchObject({ running: false, today: 0, maxRunsPerDay: 6 });
    lockAs("t1");
    expect(daemonStatus(home).running).toBe(false); // no tick yet
    writeState(home, { lastFired: {}, lastTick: new Date().toISOString() });
    expect(daemonStatus(home)).toMatchObject({ running: true, pid: process.pid });
  });

  it("refuses to start a second daemon when the first one answers", async () => {
    lockAs("t1");
    const d = fakeDaemon("t1");
    const launched: string[] = [];
    await expect(startDaemon(home, "/x/cli.js", (cli) => { launched.push(cli); return 1; }, 2000)).rejects.toThrow(/already running/);
    expect(launched).toEqual([]);
    d.stop();
  });

  it("treats a live pid that does not answer as stale, so a reused PID never blocks or gets signalled", async () => {
    lockAs("old"); // process.pid is alive, but nothing answers for token "old"
    expect(await answering(home, 300)).toBeUndefined();
    expect(await stopDaemon(home, 300)).toBe("not-running"); // nothing to stop, and nothing was killed
    const launched: string[] = [];
    // the new loop claims the lock as itself
    const pid = await startDaemon(home, "/x/cli.js", (cli) => { launched.push(cli); setTimeout(() => lockAs("new", 4242), 200); return 4242; }, 300, 3000);
    expect(pid).toBe(4242);
    expect(launched).toEqual(["/x/cli.js"]);
  });

  it("tells the loser of two simultaneous starts which daemon won", async () => {
    let d: ReturnType<typeof fakeDaemon> | undefined;
    // our child loses: another daemon claims the lock and answers
    const start = startDaemon(home, "/x/cli.js", () => { lockAs("winner"); d = fakeDaemon("winner"); return 4243; }, 300, 3000);
    await expect(start).rejects.toThrow(new RegExp(`already running \\(pid ${process.pid}\\)`));
    d?.stop();
  });

  it("reports a start whose loop never claims the lock", async () => {
    await expect(startDaemon(home, "/x/cli.js", () => 4244, 300, 500)).rejects.toThrow(/did not start/);
  });

  it("stops the daemon through a stop file holding its token, never by PID", async () => {
    lockAs("t2");
    const d = fakeDaemon("t2");
    const stopping = stopDaemon(home, 2000, 3000);
    await new Promise((r) => setTimeout(r, 600));
    expect(d.seen).toContain("stop");
    rmSync(lockFile(home)); // the daemon releases its lock as it exits
    expect(await stopping).toBe("stopped");
    d.stop();
  });

  it("says when the daemon has not let go yet, or was replaced", async () => {
    lockAs("t3");
    const d = fakeDaemon("t3");
    expect(await stopDaemon(home, 2000, 400)).toBe("asked"); // the fake reads the stop file but keeps its lock
    const replacing = stopDaemon(home, 2000, 3000);
    await new Promise((r) => setTimeout(r, 400));
    lockAs("t4"); // another daemon takes over
    expect(await replacing).toBe("replaced");
    d.stop();
  });

  it("claims the lock only if it still holds what was seen, and steps down when taken over", () => {
    lockAs("a");
    expect(claimLock(home, undefined, { pid: 1, token: "b" })).toBe(false); // someone holds it
    expect(claimLock(home, { pid: process.pid, token: "a" }, { pid: 1, token: "b" })).toBe(true); // "a" did not answer
    expect(controlTick(home, "a")).toBe("stop"); // the old daemon notices and steps down
    expect(controlTick(home, "b")).toBe("run");
  });

  it("installs a logon script in the user's Startup folder (no admin rights) and uninstall removes it", () => {
    const dir = path.join(home, "Startup");
    const cli = "C:\\npm\\agent-os\\dist\\cli.js";
    expect(isInstalled(dir)).toBe(false);
    const file = installTask(cli, dir, "win32");
    expect(path.basename(file)).toBe("agentos-daemon.cmd");
    expect(readFileSync(file, "utf8")).toBe(startupScript(process.execPath, cli));
    expect(startupScript("C:\\node\\node.exe", cli)).toContain('start "agentos daemon" /min "C:\\node\\node.exe" "C:\\npm\\agent-os\\dist\\cli.js" daemon start');
    expect(isInstalled(dir)).toBe(true);
    expect(uninstallTask(dir)).toBe(true);
    expect(isInstalled(dir)).toBe(false);
    expect(uninstallTask(dir)).toBe(false);
  });

  it("refuses to install from the npx cache, whose path is not stable, and off Windows", () => {
    const dir = path.join(home, "Startup");
    expect(() => installTask(path.join("C:", "Users", "u", "AppData", "Local", "npm-cache", "_npx", "abc", "node_modules", "@basit0090", "agent-os", "dist", "cli.js"), dir, "win32")).toThrow(/npm i -g/);
    expect(() => installTask("/usr/lib/node_modules/@basit0090/agent-os/dist/cli.js", dir, "linux")).toThrow(/Windows/);
    expect(isInstalled(dir)).toBe(false);
  });

  it("finds the Startup folder under APPDATA", () => {
    expect(startupDir({ APPDATA: "C:\\Users\\u\\AppData\\Roaming" })).toBe(path.join("C:\\Users\\u\\AppData\\Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup"));
  });

  it("reads the AC sleep timeout from powercfg output", () => {
    const out = "    Current AC Power Setting Index: 0x00000708\n    Current DC Power Setting Index: 0x00000384\n";
    expect(parseStandbyMinutes(out)).toBe(30);
    expect(parseStandbyMinutes("    Current AC Power Setting Index: 0x00000000\n")).toBe(0);
    expect(parseStandbyMinutes("nothing")).toBeUndefined();
  });
});
