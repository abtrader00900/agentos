import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { answering, claimLock, controlTick, daemonStatus, lockFile, taskArgs, installTask, parseStandbyMinutes, startDaemon, stopDaemon } from "../../src/daemon/service.js";
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
    const launched: string[] = [];
    await startDaemon(home, "/x/cli.js", (cli) => { launched.push(cli); return 1; }, 300);
    expect(launched).toEqual(["/x/cli.js"]);
    expect(await stopDaemon(home, 300)).toBe(false); // nothing to stop, and nothing was killed
  });

  it("stops the daemon through a stop file holding its token, never by PID", async () => {
    lockAs("t2");
    const d = fakeDaemon("t2");
    const stopping = stopDaemon(home, 2000);
    await new Promise((r) => setTimeout(r, 600));
    expect(d.seen).toContain("stop");
    rmSync(lockFile(home)); // the daemon releases its lock as it exits
    expect(await stopping).toBe(true);
    d.stop();
  });

  it("claims the lock only if it still holds what was seen, and steps down when taken over", () => {
    lockAs("a");
    expect(claimLock(home, undefined, { pid: 1, token: "b" })).toBe(false); // someone holds it
    expect(claimLock(home, { pid: process.pid, token: "a" }, { pid: 1, token: "b" })).toBe(true); // "a" did not answer
    expect(controlTick(home, "a")).toBe("stop"); // the old daemon notices and steps down
    expect(controlTick(home, "b")).toBe("run");
  });

  it("builds a logon task that runs as the user, not elevated", () => {
    const a = taskArgs("C:\\node\\node.exe", "C:\\npm\\agent-os\\dist\\cli.js");
    expect(a).toEqual(["/Create", "/TN", "agentos daemon", "/SC", "ONLOGON", "/RL", "LIMITED", "/F", "/TR", '"C:\\node\\node.exe" "C:\\npm\\agent-os\\dist\\cli.js" daemon start']);
  });

  it("refuses to install from the npx cache, whose path is not stable", () => {
    const calls: string[][] = [];
    const exec = (_cmd: string, args: string[]) => { calls.push(args); return ""; };
    expect(() => installTask(path.join("C:", "Users", "u", "AppData", "Local", "npm-cache", "_npx", "abc", "node_modules", "@basit0090", "agent-os", "dist", "cli.js"), exec, "win32")).toThrow(/npm i -g/);
    expect(() => installTask("/usr/lib/node_modules/@basit0090/agent-os/dist/cli.js", exec, "linux")).toThrow(/Windows/);
    expect(calls).toEqual([]);
  });

  it("reads the AC sleep timeout from powercfg output", () => {
    const out = "    Current AC Power Setting Index: 0x00000708\n    Current DC Power Setting Index: 0x00000384\n";
    expect(parseStandbyMinutes(out)).toBe(30);
    expect(parseStandbyMinutes("    Current AC Power Setting Index: 0x00000000\n")).toBe(0);
    expect(parseStandbyMinutes("nothing")).toBeUndefined();
  });
});
