import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnRunner, finalText, cliArgs, cliRunners, RATE_LIMIT_RE } from "../../src/orchestrator/runners.js";

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

  it.runIf(process.platform === "win32")("runs a CLI whose PATH folder has & and parentheses in its name", async () => {
    const bin = path.join(tmp, "tools&co(x86)");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "agentos-odd-cli.cmd"), "@echo odd-path-ok\r\n");
    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
    try {
      const r = await spawnRunner("agentos-odd-cli", [])({ prompt: "", cwd: tmp, timeoutMs: 10_000 });
      expect(r.output).toContain("odd-path-ok");
      expect(r.ok).toBe(true);
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("reports a missing command as a failed result", async () => {
    const r = await spawnRunner("agentos-no-such-cli", [])({ prompt: "x", cwd: tmp, timeoutMs: 10_000 });
    expect(r.ok).toBe(false);
  });
});

describe("RATE_LIMIT_RE", () => {
  it("matches every agent CLI's wording for a quota limit, and no ordinary crash", () => {
    for (const out of ["individual quota reached", "You have reached your weekly usage limit", "rate limit exceeded", "Error 429"]) {
      expect(RATE_LIMIT_RE.test(out)).toBe(true);
    }
    expect(RATE_LIMIT_RE.test("TypeError: cannot read properties of undefined")).toBe(false);
  });
});

describe("cliArgs", () => {
  it("passes a configured model to each CLI, and nothing when none is set", () => {
    expect(cliArgs("claude", "write", "claude-opus-5-5")[1]).toEqual(expect.arrayContaining(["--model", "claude-opus-5-5"]));
    const [cmd, args] = cliArgs("codex", "read", "gpt-5.6-sol");
    expect(cmd).toBe("codex");
    expect(args.slice(args.indexOf("-m"), args.indexOf("-m") + 2)).toEqual(["-m", "gpt-5.6-sol"]);
    expect(args.at(-1)).toBe("-"); // the prompt still comes from stdin
    expect(cliArgs("claude", "read")[1]).not.toContain("--model");
    expect(cliArgs("codex", "write")[1]).not.toContain("-m");
  });

  it("keeps each mode's permission flags and never a skip-permission flag", () => {
    expect(cliArgs("claude", "write")[1]).toEqual(expect.arrayContaining(["--permission-mode", "acceptEdits"]));
    expect(cliArgs("claude", "read")[1]).toEqual(expect.arrayContaining(["--disallowedTools", "Edit,Write,NotebookEdit,Bash"]));
    expect(cliArgs("codex", "write")[1]).toEqual(expect.arrayContaining(["-s", "workspace-write"]));
    expect(cliArgs("codex", "read")[1]).toEqual(expect.arrayContaining(["-s", "read-only"]));
    const all = (["claude", "codex"] as const).flatMap((a) => (["read", "write"] as const).flatMap((m) => cliArgs(a, m, "x")[1]));
    expect(all.join(" ")).not.toMatch(/dangerously|--yolo/);
  });

  it("builds read and write runners for both CLIs", () => {
    const r = cliRunners({ codex: "gpt-5.6-sol" });
    expect(typeof r.claude.read).toBe("function");
    expect(typeof r.codex.write).toBe("function");
  });
});

describe("finalText", () => {
  it("reads the last message of Claude stream-json and Codex --json output", () => {
    expect(finalText(`{"type":"system"}\n{"type":"result","result":"claude done"}\n`)).toBe("claude done");
    expect(finalText(`{"type":"item.completed","item":{"type":"agent_message","text":"codex done"}}\n{"type":"turn.completed"}\n`)).toBe("codex done");
    expect(finalText("plain output")).toBe("plain output");
  });
});
