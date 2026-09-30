import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnRunner, finalText } from "../../src/orchestrator/runners.js";

let tmp: string;
const script = (name: string, body: string) => {
  writeFileSync(path.join(tmp, name), body);
  return path.join(tmp, name);
};
beforeAll(() => { tmp = mkdtempSync(path.join(tmpdir(), "agentos-runner-")); });
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("spawnRunner", () => {
  it("sends the prompt on stdin and returns the output", async () => {
    const echo = script("echo.mjs", `let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.stringify({type:"result",result:s.toUpperCase()})));`);
    const pids: number[] = [];
    const lines: string[] = [];
    const r = await spawnRunner(process.execPath, [echo])({ prompt: "hi there", cwd: tmp, timeoutMs: 10_000, onSpawn: (p) => pids.push(p), onLine: (l) => lines.push(l) });
    expect(r.ok).toBe(true);
    expect(finalText(r.output)).toBe("HI THERE");
    expect(pids).toHaveLength(1);
    expect(lines).toHaveLength(1);
  });

  it("flags a rate-limit exit", async () => {
    const limit = script("limit.mjs", `console.error("Error: usage limit reached, try again later");process.exit(1)`);
    const r = await spawnRunner(process.execPath, [limit])({ prompt: "x", cwd: tmp, timeoutMs: 10_000 });
    expect(r).toMatchObject({ ok: false, rateLimited: true });
  });

  it("kills a runner that outlives its timeout", async () => {
    const sleep = script("sleep.mjs", `setTimeout(()=>{},60000)`);
    const t0 = Date.now();
    const r = await spawnRunner(process.execPath, [sleep])({ prompt: "", cwd: tmp, timeoutMs: 500 });
    expect(r).toMatchObject({ ok: false, timedOut: true });
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it.runIf(process.platform === "win32")("runs the CLI found on PATH, never a same-named .cmd planted in the working directory", async () => {
    const planted = path.join(tmp, "worktree");
    const bin = path.join(tmp, "bin");
    mkdirSync(planted);
    mkdirSync(bin);
    writeFileSync(path.join(planted, "agentos-fake-cli.cmd"), "@echo planted\r\n");
    writeFileSync(path.join(bin, "agentos-fake-cli.cmd"), "@echo from-path\r\n");
    const oldPath = process.env.PATH;
    // cmd.exe's default: the current directory before PATH (some hosts, e.g. agent sandboxes, turn that off with this variable)
    const noCwd = process.env.NoDefaultCurrentDirectoryInExePath;
    delete process.env.NoDefaultCurrentDirectoryInExePath;
    process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
    try {
      const r = await spawnRunner("agentos-fake-cli", [])({ prompt: "", cwd: planted, timeoutMs: 10_000 });
      expect(r.output).toContain("from-path");
      expect(r.output).not.toContain("planted");
    } finally {
      process.env.PATH = oldPath;
      if (noCwd !== undefined) process.env.NoDefaultCurrentDirectoryInExePath = noCwd;
    }
  });

  it("reports a missing command as a failed result", async () => {
    const r = await spawnRunner("agentos-no-such-cli", [])({ prompt: "x", cwd: tmp, timeoutMs: 10_000 });
    expect(r.ok).toBe(false);
  });
});

describe("finalText", () => {
  it("reads the last message of Claude stream-json and Codex --json output", () => {
    expect(finalText(`{"type":"system"}\n{"type":"result","result":"claude done"}\n`)).toBe("claude done");
    expect(finalText(`{"type":"item.completed","item":{"type":"agent_message","text":"codex done"}}\n{"type":"turn.completed"}\n`)).toBe("codex done");
    expect(finalText("plain output")).toBe("plain output");
  });
});
