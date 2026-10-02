import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startDecider, stopDecider, deciderStatus, processPath } from "../../src/decider/service.js";
import { deciderDir } from "../../src/decider/client.js";

let home: string;
const install = () => {
  mkdirSync(path.join(deciderDir(home), "jev", "model"), { recursive: true });
  writeFileSync(path.join(deciderDir(home), "jev", process.platform === "win32" ? "jev.exe" : "jev"), "x");
  writeFileSync(path.join(deciderDir(home), "version"), "jevos-v2\n");
};
beforeEach(() => { home = realpathSync.native(mkdtempSync(path.join(tmpdir(), "agentos-svc2-"))); });

describe("decider service", () => {
  it("refuses to start when nothing is installed, or memory is short (unless forced)", async () => {
    await expect(startDecider({ home, freeMb: () => 5000, spawnFn: () => 1, health: async () => true })).rejects.toThrow(/agentos decider install/);
    install();
    await expect(startDecider({ home, freeMb: () => 700, spawnFn: () => 1, health: async () => true })).rejects.toThrow(/700 MB free.*1200/);
    expect(await startDecider({ home, freeMb: () => 700, force: true, spawnFn: () => 4321, health: async () => true })).toBe(4321);
  });

  it("starts jev serve on loopback with a fresh key, and waits for /health", async () => {
    install();
    const calls: { args: string[]; env: Record<string, string | undefined> }[] = [];
    let ready = 0;
    const pid = await startDecider({
      home, url: "http://127.0.0.1:8123", freeMb: () => 5000,
      spawnFn: (_bin, args, env) => { calls.push({ args, env }); return 777; },
      health: async () => ++ready >= 3, pollMs: 5,
    });
    expect(pid).toBe(777);
    expect(calls[0].args).toEqual(["serve", "--host", "127.0.0.1", "--port", "8123"]);
    const key = readFileSync(path.join(deciderDir(home), "key"), "utf8").trim();
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(calls[0].env.JEV_API_KEY).toBe(key);
    expect(readFileSync(path.join(deciderDir(home), "jev.pid"), "utf8").trim()).toBe("777");
  });

  it("gives up when /health never says ready", async () => {
    install();
    await expect(startDecider({ home, freeMb: () => 5000, spawnFn: () => 1, health: async () => false, waitMs: 50, pollMs: 5 })).rejects.toThrow(/not ready/);
  });

  it("stops only a server that answers /health, and never kills a bare pid", async () => {
    install();
    writeFileSync(path.join(deciderDir(home), "jev.pid"), "999999");
    writeFileSync(path.join(deciderDir(home), "key"), "k");
    const killed: number[] = [];
    expect(await stopDecider({ home, health: async () => false, kill: (p) => killed.push(p) })).toBe("not-running");
    expect(killed).toEqual([]);
    expect(existsSync(path.join(deciderDir(home), "jev.pid"))).toBe(false);
    const ourBinary = path.join(deciderDir(home), "jev", process.platform === "win32" ? "jev.exe" : "jev");
    writeFileSync(path.join(deciderDir(home), "jev.pid"), "4242");
    expect(await stopDecider({ home, health: async () => true, kill: (p) => killed.push(p), processPath: () => ourBinary })).toBe("stopped");
    expect(killed).toEqual([4242]);
    expect(existsSync(path.join(deciderDir(home), "key"))).toBe(false);
  });

  it("never kills a reused pid, even while some jevos answers /health", async () => {
    install();
    writeFileSync(path.join(deciderDir(home), "jev.pid"), "5151");
    const killed: number[] = [];
    // the pid now runs another program (or another jev install): not ours
    for (const other of ["C:\\Windows\\notepad.exe", path.join(home, "elsewhere", "jev", "jev.exe"), undefined]) {
      writeFileSync(path.join(deciderDir(home), "jev.pid"), "5151");
      expect(await stopDecider({ home, health: async () => true, kill: (p) => killed.push(p), processPath: () => other })).toBe("not-running");
    }
    expect(killed).toEqual([]);
  });

  it("reads a real process's executable path on this system", () => {
    const p = processPath(process.pid);
    expect(p && path.basename(p).toLowerCase()).toMatch(/^node(\.exe)?$/);
    expect(processPath(2 ** 31 - 2)).toBeUndefined();
  });

  it("reports status", async () => {
    expect(await deciderStatus({ home, health: async () => false })).toEqual({ installed: false, running: false });
    install();
    writeFileSync(path.join(deciderDir(home), "jev.pid"), "55");
    expect(await deciderStatus({ home, health: async () => true })).toEqual({ installed: true, running: true, pid: 55 });
  });
});
