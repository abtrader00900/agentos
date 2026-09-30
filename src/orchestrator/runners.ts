import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentName, Runner, RunnerResult } from "./types.js";

export const RATE_LIMIT_RE = /rate[ _-]?limit|usage limit|quota (?:exceeded|reached)|too many requests|\b429\b/i;
const MAX_OUTPUT = 400_000;
const WIN = process.platform === "win32";

/** kill a process and its children, by PID only */
export function killTree(pid: number): void {
  try {
    if (WIN) execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch {
    /* already exited */
  }
}

const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s);

/**
 * A runner for one agent CLI. argv is fixed and the prompt goes through stdin,
 * so the Windows shell (needed to start npm's .cmd shims) never sees user text.
 */
export function spawnRunner(command: string, args: string[]): Runner {
  return (req) =>
    new Promise<RunnerResult>((resolve) => {
      let output = "";
      let timedOut = false;
      let settled = false;
      const child = WIN
        ? spawn([command, ...args].map(quote).join(" "), { cwd: req.cwd, shell: true, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })
        : spawn(command, args, { cwd: req.cwd, detached: true, stdio: ["pipe", "pipe", "pipe"] });
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid) killTree(child.pid);
      }, req.timeoutMs);
      const finish = (r: RunnerResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      if (child.pid) req.onSpawn?.(child.pid);
      const add = (line: string) => {
        output += `${line}\n`;
        if (output.length > MAX_OUTPUT) output = output.slice(-MAX_OUTPUT / 2);
        req.onLine?.(line);
      };
      createInterface({ input: child.stdout! }).on("line", add);
      createInterface({ input: child.stderr! }).on("line", add);
      child.stdin!.on("error", () => { /* exited before reading its prompt */ });
      child.stdin!.end(req.prompt);
      child.on("error", (e) => finish({ ok: false, output: `${output}${e.message}\n`, rateLimited: false, timedOut }));
      child.on("close", (code) =>
        finish({ ok: code === 0 && !timedOut, output, timedOut, rateLimited: code !== 0 && RATE_LIMIT_RE.test(output) }));
    });
}

/** The agent's final message from Claude stream-json or Codex --json output, else the output's tail. */
export function finalText(output: string): string {
  const lines = output.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === "result" && typeof ev.result === "string") return ev.result;
      if (ev.item?.type === "agent_message" && typeof ev.item.text === "string") return ev.item.text;
      if (ev.msg?.type === "agent_message" && typeof ev.msg.message === "string") return ev.msg.message;
    } catch {
      /* not JSON */
    }
  }
  return output.trim().slice(-4000);
}

const CLAUDE = ["-p", "--output-format", "stream-json", "--verbose"];
const CODEX = ["exec", "--json", "--skip-git-repo-check"];

/**
 * write: may edit files in its cwd. read: planner and reviewer, which must not edit.
 * Claude in -p mode denies tools that are not allowed, so a writer edits files but
 * runs no shell commands; agentos commits and runs the tests itself.
 */
export const CLI_RUNNERS: Record<AgentName, { write: Runner; read: Runner }> = {
  claude: {
    write: spawnRunner("claude", [...CLAUDE, "--permission-mode", "acceptEdits"]),
    read: spawnRunner("claude", [...CLAUDE, "--disallowedTools", "Edit,Write,NotebookEdit,Bash"]),
  },
  codex: {
    write: spawnRunner("codex", [...CODEX, "-s", "workspace-write", "-"]),
    read: spawnRunner("codex", [...CODEX, "-s", "read-only", "-"]),
  },
};
