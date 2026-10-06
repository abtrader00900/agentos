import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/loader.js";
import { deciderSchema, learningSchema, type LearningConfig, type OrchestratorConfig } from "../core/schema.js";
import { decider } from "../decider/client.js";
import { git } from "../orchestrator/workspace.js";
import { startRun, resumeRun, cancelRun, assertCleanCheckout, type EngineDeps } from "../orchestrator/engine.js";
import { listRuns, loadRun, runDir, saveRun, logEvent } from "../orchestrator/run.js";
import { cliRunners } from "../orchestrator/runners.js";
import { runLine } from "../orchestrator/report.js";
import { registerProject } from "../ui/projects.js";
import { resolveAgentCli } from "./doctor.js";

/** the executable each agent runs: gemini is Google's agy CLI */
const AGENT_BIN = { claude: "claude", codex: "codex", gemini: "agy" } as const;

export const ORCHESTRATOR_SNIPPET = `orchestrator:
  verify: [npm test]          # commands that must pass before a PR opens
  workers: [claude, codex]    # agent CLIs that write code (your subscriptions)
  reviewer: codex             # reviews every diff
  maxWorkers: 2`;

const repoRoot = (cwd = process.cwd()) => git(cwd, ["rev-parse", "--show-toplevel"]);

const gh = (cwd: string, args: string[]) =>
  execFileSync("gh", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

/** Everything a run needs before it starts; throws the reason. The MCP server runs it before launching a background run. */
export function preflight(root: string, ghCli = gh): OrchestratorConfig {
  const cfg = loadConfig(root).config.orchestrator;
  if (!cfg) throw new Error(`agent.config.yaml has no orchestrator block. Add one, for example:\n\n${ORCHESTRATOR_SNIPPET}`);
  const missing = [...new Set([cfg.planner, cfg.reviewer, ...cfg.workers])].filter((a) => !resolveAgentCli(AGENT_BIN[a]));
  if (missing.length) throw new Error(`not on PATH: ${missing.map((a) => (AGENT_BIN[a] === a ? a : `${a} (${AGENT_BIN[a]})`)).join(", ")} — install it, or remove it from orchestrator planner/reviewer/workers`);
  assertCleanCheckout(root);
  ghCli(root, ["auth", "status"]);
  return cfg;
}

/** run requires an orchestrator block, so the learning defaults apply whenever a run starts */
const learningOf = (root: string): LearningConfig => loadConfig(root).config.learning ?? learningSchema.parse({});

/** A background run (started with --id) that fails before its first save still leaves a record run_status can show. */
function recordFailedStart(root: string, id: string, task: string, e: Error): void {
  try {
    if (existsSync(path.join(runDir(root, id), "state.json"))) return; // never overwrite a real run
  } catch {
    return; // invalid id: nothing to record under it
  }
  const now = new Date().toISOString();
  saveRun(root, {
    id, task, status: "failed", reason: `could not start: ${e.message}`, baseBranch: "", base: "", branch: `agentos/run-${id}`,
    runWorktree: "", createdAt: now, updatedAt: now, subtasks: [], fixRound: 0, findings: [],
  });
  logEvent(root, id, { type: "status", status: "failed", reason: e.message });
}

/** the decider's settings (defaults when the block is absent); a missing server just answers null */
function deciderDeps(root: string): Pick<EngineDeps, "decide" | "deciderConfig"> {
  try {
    const deciderConfig = deciderSchema.parse(loadConfig(root).config.decider ?? {});
    return { decide: decider(deciderConfig), deciderConfig };
  } catch {
    return {};
  }
}

/** agentos run: start, resume, cancel or inspect a run. Returns the exit code. */
export async function run(task: string, opts: { resume?: string; cancel?: string; status?: string; id?: string; quick?: boolean; plan?: boolean; onto?: string; cwd?: string }): Promise<number> {
  const root = repoRoot(opts.cwd);
  try { registerProject(root); } catch { /* a registry problem never blocks a run */ }
  if (opts.status) {
    console.log(JSON.stringify(loadRun(root, opts.status), null, 2));
    return 0;
  }
  if (opts.cancel) {
    console.log(runLine(await cancelRun(root, opts.cancel)));
    return 0;
  }
  const deps = (cfg: OrchestratorConfig): EngineDeps => ({
    runners: cliRunners(cfg.models),
    gh,
    learning: learningOf(root),
    onStatus: (s) => console.log(`→ ${s.status}${s.reason ? `: ${s.reason.split("\n")[0]}` : ""}`),
    onLearning: (r) => console.log(r ? `learned: ${r}` : "→ learning…"),
    ...deciderDeps(root),
  });
  let s;
  if (opts.resume) {
    const cfg = preflight(root);
    s = await resumeRun(root, opts.resume, cfg, deps(cfg));
  } else {
    try {
      const cfg = preflight(root);
      s = await startRun(root, task, cfg, deps(cfg), opts.id, { quick: opts.quick, onto: opts.onto, plan: opts.plan });
    } catch (e) {
      if (opts.id) recordFailedStart(root, opts.id, task, e as Error);
      throw e;
    }
  }
  console.log(runLine(s));
  if (s.draft) console.log(`skill draft ready: ${s.draft} — agentos skill drafts`);
  return s.status === "pr_open" ? 0 : 1;
}

/** agentos runs */
export function runs(opts: { json?: boolean; cwd?: string; limit?: number }): void {
  if (opts.limit !== undefined && !(Number.isInteger(opts.limit) && opts.limit >= 1)) throw new Error("--limit must be a whole number of 1 or more");
  const all = listRuns(repoRoot(opts.cwd)).slice(0, opts.limit);
  if (opts.json) {
    console.log(JSON.stringify(all.map(({ id, status, task, prUrl, reason, createdAt }) => ({ id, status, task, prUrl, reason, createdAt })), null, 2));
    return;
  }
  if (!all.length) {
    console.log('No runs yet. Start one: agentos run "<task>"');
    return;
  }
  for (const s of all) console.log(runLine(s));
}
