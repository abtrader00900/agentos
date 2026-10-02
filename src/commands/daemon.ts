import { loadConfig } from "../core/loader.js";
import { git } from "../orchestrator/workspace.js";
import { addJob, listJobs, removeJob } from "../daemon/queue.js";
import { answering, daemonStatus, hasLog, installTask, logFile, runDaemon, startDaemon, stopDaemon, uninstallTask } from "../daemon/service.js";
import { getProject, registerProject } from "../ui/projects.js";

export async function daemonCommand(action: string): Promise<void> {
  switch (action) {
    case "start": console.log(`agentos daemon started (pid ${await startDaemon()}) — log: ${logFile()}`); return;
    case "stop": {
      const r = await stopDaemon();
      console.log({
        stopped: "agentos daemon stopped (a run in flight keeps going; the next start adopts it)",
        asked: "asked the daemon to stop; it stops when its current tick ends",
        replaced: "that daemon is gone, but another one holds the lock now — run: agentos daemon status",
        "not-running": "the daemon is not running",
      }[r]);
      return;
    }
    case "run": return runDaemon();
    case "install": console.log(`installed: ${installTask()} starts the daemon at logon (no admin rights needed); undo with: agentos daemon uninstall`); return;
    case "uninstall": console.log(uninstallTask() ? "removed the logon script; the daemon no longer starts at logon" : "nothing to remove: the daemon was not set to start at logon"); return;
    case "status": {
      const s = daemonStatus();
      const lock = await answering(undefined, 3000);
      console.log(lock ? `running (pid ${lock.pid}), last tick ${s.lastTick ?? "—"}` : "stopped — start it with: agentos daemon start");
      console.log(`runs today: ${s.today} / ${s.maxRunsPerDay}${s.pauseUntil && Date.parse(s.pauseUntil) > Date.now() ? ` · paused for a rate limit until ${s.pauseUntil}` : ""}`);
      if (hasLog()) console.log(`log: ${logFile()}`);
      return;
    }
    default: throw new Error(`unknown daemon action "${action}" — use start, stop, status, install, uninstall or run`);
  }
}

export function queueCommand(action: string, words: string[], opts: { project?: string; quick?: boolean; json?: boolean; cwd?: string }): void {
  if (action === "add") {
    const root = git(opts.project ?? opts.cwd ?? process.cwd(), ["rev-parse", "--show-toplevel"]);
    if (!loadConfig(root).config.daemon?.enabled) throw new Error(`the daemon is off for ${root}. Turn it on in agent.config.yaml: daemon: { enabled: true }`);
    const p = registerProject(root)!;
    const task = words.join(" ").trim();
    if (task.length < 3 || task.length > 2000) throw new Error("the task must be 3-2000 characters");
    const job = addJob({ projectId: p.id, task, quick: !!opts.quick, source: "manual" })!;
    console.log(`queued ${job.id} for ${p.name}${opts.quick ? " (quick)" : ""}`);
    return;
  }
  if (action === "remove") {
    const r = removeJob(words[0] ?? "");
    if (r !== "removed") throw new Error(r === "not-found" ? `no job ${words[0]}` : `job ${words[0]} is not queued any more`);
    console.log(`removed ${words[0]}`);
    return;
  }
  if (action === "list") {
    const jobs = listJobs().slice(-50).reverse();
    if (opts.json) { console.log(JSON.stringify(jobs, null, 2)); return; }
    if (!jobs.length) { console.log('The queue is empty. Add a task: agentos queue add "<task>"'); return; }
    for (const j of jobs) console.log(`${j.id}  ${j.status.padEnd(7)}  ${j.source.padEnd(8)}  ${getProject(j.projectId)?.name ?? j.projectId}  ${j.task.split("\n")[0].slice(0, 60)}${j.result ? `  → ${j.result}` : ""}`);
    return;
  }
  throw new Error(`unknown queue action "${action}" — use add, list or remove`);
}
