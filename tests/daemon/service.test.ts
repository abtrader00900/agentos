import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { daemonStatus, pidFile, taskArgs, installTask, parseStandbyMinutes, startDaemon } from "../../src/daemon/service.js";

let home: string;
beforeEach(() => { home = realpathSync.native(mkdtempSync(path.join(tmpdir(), "agentos-svc-"))); });

describe("daemon service", () => {
  it("reports stopped with no pid file, and running when the pid file names a live process", () => {
    expect(daemonStatus(home)).toMatchObject({ running: false, today: 0, maxRunsPerDay: 6 });
    mkdirSync(path.dirname(pidFile(home)), { recursive: true });
    writeFileSync(pidFile(home), String(process.pid));
    expect(daemonStatus(home)).toMatchObject({ running: true, pid: process.pid });
  });

  it("refuses to start a second daemon", () => {
    mkdirSync(path.dirname(pidFile(home)), { recursive: true });
    writeFileSync(pidFile(home), String(process.pid));
    expect(() => startDaemon(home, "/x/cli.js")).toThrow(/already running/);
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
