import { execFileSync } from "node:child_process";
import { loadConfig } from "../core/loader.js";
import { git } from "../orchestrator/workspace.js";
import { startRun, resumeRun, cancelRun } from "../orchestrator/engine.js";
import { listRuns, loadRun } from "../orchestrator/run.js";
import { CLI_RUNNERS } from "../orchestrator/runners.js";
import { runLine } from "../orchestrator/report.js";
import { isCommandOnPath } from "./doctor.js";
export const ORCHESTRATOR_SNIPPET = `orchestrator:
  verify: [npm test]          # commands that must pass before a PR opens
  workers: [claude, codex]    # agent CLIs that write code (your subscriptions)
  reviewer: codex             # reviews every diff
  maxWorkers: 2`;
const repoRoot = (cwd = process.cwd()) => git(cwd, ["rev-parse", "--show-toplevel"]);
const gh = (cwd, args) => execFileSync("gh", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
/** agentos run: start, resume, cancel or inspect a run. Returns the exit code. */
export async function run(task, opts) {
    const root = repoRoot(opts.cwd);
    if (opts.status) {
        console.log(JSON.stringify(loadRun(root, opts.status), null, 2));
        return 0;
    }
    if (opts.cancel) {
        console.log(runLine(await cancelRun(root, opts.cancel)));
        return 0;
    }
    const cfg = loadConfig(root).config.orchestrator;
    if (!cfg)
        throw new Error(`agent.config.yaml has no orchestrator block. Add one, for example:\n\n${ORCHESTRATOR_SNIPPET}`);
    const missing = [...new Set([cfg.planner, cfg.reviewer, ...cfg.workers])].filter((a) => !isCommandOnPath(a));
    if (missing.length)
        throw new Error(`not on PATH: ${missing.join(", ")} — install it, or remove it from orchestrator planner/reviewer/workers`);
    const deps = {
        runners: CLI_RUNNERS,
        gh,
        onStatus: (s) => console.log(`→ ${s.status}${s.reason ? `: ${s.reason.split("\n")[0]}` : ""}`),
    };
    const s = opts.resume ? await resumeRun(root, opts.resume, cfg, deps) : await startRun(root, task, cfg, deps, opts.id);
    console.log(runLine(s));
    return s.status === "pr_open" ? 0 : 1;
}
/** agentos runs */
export function runs(opts) {
    const all = listRuns(repoRoot(opts.cwd));
    if (opts.json) {
        console.log(JSON.stringify(all.map(({ id, status, task, prUrl, reason, createdAt }) => ({ id, status, task, prUrl, reason, createdAt })), null, 2));
        return;
    }
    if (!all.length) {
        console.log('No runs yet. Start one: agentos run "<task>"');
        return;
    }
    for (const s of all)
        console.log(runLine(s));
}
//# sourceMappingURL=run.js.map