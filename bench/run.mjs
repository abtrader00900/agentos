#!/usr/bin/env node
// Token benchmark: the same tasks on fresh copies of a target repo, two arms —
//   agentos:  `agentos sync` output (CLAUDE.md + .mcp.json) and a seeded .agentos/memory.json
//   baseline: the same code, no agentos files, no MCP servers
// Every number comes from `claude -p --output-format stream-json`; nothing is estimated.
//
//   node bench/run.mjs --label pilot                      # 1 rep per task per arm
//   node bench/run.mjs --label full --reps 3 --concurrency 2
//   BENCH_TARGET=/abs/my-target.mjs node bench/run.mjs    # local-only target (see targets/local.example.mjs)
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const benchDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(benchDir);

const { values: opt } = parseArgs({
  options: {
    target: { type: "string", default: process.env.BENCH_TARGET ?? path.join(benchDir, "targets", "agentos.mjs") },
    label: { type: "string", default: "pilot" },
    reps: { type: "string", default: "1" },
    tasks: { type: "string" },
    arms: { type: "string", default: "agentos,baseline" },
    model: { type: "string", default: "claude-sonnet-5" },
    concurrency: { type: "string", default: "1" },
    budget: { type: "string", default: "3" }, // USD cap per run (--max-budget-usd), a runaway guard only
  },
});

const target = (await import(pathToFileURL(path.resolve(opt.target)).href)).default;
const tasks = opt.tasks ? target.tasks.filter((t) => opt.tasks.split(",").includes(t.id)) : target.tasks;
const arms = opt.arms.split(",");
const reps = Number(opt.reps);
const RUN_TIMEOUT_MS = 20 * 60_000;

// A claude spawned from inside a Claude Code session inherits the host's CLAUDE*/ANTHROPIC* variables and
// then fails auth ("OAuth session expired"); without them it uses the CLI's own login.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC)/i.test(k)));

// Identical for both arms. They strip the user's global context so it can't swamp or skew the comparison:
//   --setting-sources project   no user settings → no user plugins, hooks, env, model/effort overrides
//                               (the copies have no .claude/settings.json, so nothing loads at all)
//   --disable-slash-commands    no skills
//   --strict-mcp-config         only the servers in --mcp-config (none for baseline) — no user/claude.ai MCP servers
// CLAUDE.md auto-discovery stays on: that is how the agentos arm gets its rules.
const FLAGS = [
  "--output-format", "stream-json", "--verbose",
  "--model", opt.model,
  "--setting-sources", "project",
  "--disable-slash-commands",
  "--strict-mcp-config",
  "--no-session-persistence",
  "--max-budget-usd", opt.budget,
  "--allowedTools", "Read", "Grep", "Glob", "Edit", "Write", "Bash", "PowerShell", "mcp__memory", "mcp__supersearch", "mcp__codegraph",
];

const outDir = target.private ? path.join(benchDir, "results", "local") : path.join(benchDir, "results");
const outFile = path.join(outDir, `${target.name}-${opt.label}.json`);
const transcripts = path.join(benchDir, "results", "transcripts", `${target.name}-${opt.label}`);
mkdirSync(transcripts, { recursive: true });

const tmp = mkdtempSync(path.join(os.tmpdir(), "agentos-bench-"));
const emptyMcp = path.join(tmp, "no-mcp.json");
writeFileSync(emptyMcp, JSON.stringify({ mcpServers: {} }));

// linked dirs (node_modules) are copied once per invocation: a model running `npm install` in a copy
// must not rewrite the developer's real node_modules through the junction
const shared = {};
for (const [name, src] of Object.entries(target.links ?? {})) {
  shared[name] = path.join(tmp, "shared", name);
  process.stdout.write(`copying ${name} once for all runs… `);
  cpSync(src, shared[name], { recursive: true });
  console.log("done");
}

function extract(dir, paths = []) {
  const { repo, ref } = target.source;
  const archive = spawnSync("git", ["archive", ref, ...paths], { cwd: repo, maxBuffer: 2 ** 31 - 1 });
  if (archive.status !== 0) throw new Error(`git archive: ${archive.stderr}`);
  const x = spawnSync("tar", ["-xf", "-"], { cwd: dir, input: archive.stdout, maxBuffer: 64 * 2 ** 20 });
  if (x.status !== 0) throw new Error(`tar: ${x.stderr}`);
}

const git = (dir, ...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });

function setupAgentos(dir) {
  writeFileSync(path.join(dir, "agent.config.yaml"), target.agentos.config);
  // the checked-out agentos generates the files, exactly as a user's `agentos sync` would
  execFileSync(process.execPath, [path.join(repoRoot, "dist", "cli.js"), "sync", "--only", "claude-code"], { cwd: dir, stdio: "pipe" });
  // what `agentos install` appends to .gitignore
  appendFileSync(path.join(dir, ".gitignore"), "\n# AgentOS\n.agentos/memory.json*\n.agentos/graph.json*\nagent.config.local.yaml\n");
  const at = "2026-09-27T12:00:00.000Z";
  const facts = target.agentos.memory.map((f, i) => ({
    id: i + 1, topic: f.topic, key: f.key, value: f.value, source: f.source ?? null, pinned: 0, created_at: at, updated_at: at,
  }));
  writeFileSync(path.join(dir, ".agentos", "memory.json"), JSON.stringify({ facts }));
}

/** a fresh copy: code at the pinned ref → task setup → arm files → links → one git commit */
function prepare(task, arm) {
  const dir = mkdtempSync(path.join(tmp, "w-"));
  extract(dir);
  task.setup?.(dir);
  if (arm === "agentos") setupAgentos(dir);
  git(dir, "init", "-q");
  const links = Object.keys(shared);
  if (links.length) appendFileSync(path.join(dir, ".git", "info", "exclude"), links.map((l) => `/${l}\n`).join(""));
  for (const name of links) symlinkSync(shared[name], path.join(dir, name), "junction");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=bench", "-c", "user.email=bench@localhost", "commit", "-qm", "initial import");
  return dir;
}

function claude(cwd, args, transcript) {
  return new Promise((resolve) => {
    const p = spawn("claude", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      // Windows: kill the tree, or the MCP servers outlive claude and hold the copy open
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"]);
      else p.kill("SIGKILL");
    }, RUN_TIMEOUT_MS);
    p.on("close", (code) => {
      clearTimeout(timer);
      writeFileSync(transcript, out);
      resolve({ code, out, err });
    });
  });
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

async function runOne({ task, arm, rep }) {
  const id = `${task.id}-${arm}-r${rep}`;
  const dir = prepare(task, arm);
  const mcp = arm === "agentos" ? path.join(dir, ".mcp.json") : emptyMcp;
  const started = Date.now();
  const { code, out, err } = await claude(dir, ["-p", task.prompt, ...FLAGS, "--mcp-config", mcp], path.join(transcripts, `${id}.jsonl`));
  const events = out.split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const result = events.findLast((e) => e.type === "result");

  const tools = {};
  for (const e of events) {
    if (e.type !== "assistant") continue;
    for (const c of e.message?.content ?? []) if (c.type === "tool_use") tools[c.name] = (tools[c.name] ?? 0) + 1;
  }
  // modelUsage covers every model the run used (subagents included); usage is the main loop only
  const mu = Object.values(result?.modelUsage ?? {});
  const tokens = {
    input: sum(mu.map((m) => m.inputTokens ?? 0)),
    cacheCreation: sum(mu.map((m) => m.cacheCreationInputTokens ?? 0)),
    cacheRead: sum(mu.map((m) => m.cacheReadInputTokens ?? 0)),
    output: sum(mu.map((m) => m.outputTokens ?? 0)),
  };
  tokens.total = tokens.input + tokens.cacheCreation + tokens.cacheRead + tokens.output;

  const mcpServers = (init?.mcp_servers ?? []).map((s) => `${s.name}:${s.status}`);
  let error = null;
  if (!result) error = `no result event (exit ${code}): ${err.slice(0, 300)}`;
  else if (arm === "agentos" && mcpServers.filter((s) => s.endsWith(":connected")).length !== 3) error = `MCP not connected: ${mcpServers}`;

  let check = { pass: false, detail: null };
  if (result) {
    try {
      check = await task.check({ answer: String(result.result ?? ""), dir, extract: (paths) => extract(dir, paths) });
    } catch (e) {
      check = { pass: false, detail: `check threw: ${e.message}` };
    }
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });

  return {
    task: task.id, arm, rep,
    pass: !error && check.pass, detail: check.detail, error,
    costUsd: result?.total_cost_usd ?? null,
    tokens,
    turns: result?.num_turns ?? null,
    durationMs: result?.duration_ms ?? Date.now() - started,
    stop: result?.subtype ?? null,
    models: Object.keys(result?.modelUsage ?? {}),
    subagents: result?.subagent_stats?.spawned ?? 0,
    tools, mcpServers,
    answer: result?.result ?? null,
  };
}

// interleave arms and flip their order per task and rep, so neither arm always runs on a warmer prompt cache
const jobs = [];
for (let rep = 1; rep <= reps; rep++) {
  tasks.forEach((task, i) => {
    const order = (rep + i) % 2 ? [...arms].reverse() : arms;
    for (const arm of order) jobs.push({ task, arm, rep });
  });
}

// one command string: npx is a .cmd shim on Windows and needs the shell (fixed args, nothing to escape)
const version = (cmd) => {
  const r = spawnSync(cmd, { env, encoding: "utf8", shell: true });
  return (r.stdout || r.stderr || "").trim().split("\n")[0];
};
const report = {
  meta: {
    date: new Date().toISOString(),
    label: opt.label,
    target: target.name,
    ref: target.source.ref,
    model: opt.model,
    reps,
    claude: version("claude --version"),
    agentosMcp: version("npx -y @basit0090/agent-os --version"),
    platform: `${process.platform} ${os.release()}, node ${process.version}`,
    flags: FLAGS,
  },
  runs: [],
};
mkdirSync(outDir, { recursive: true });
const save = () => writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n");

console.log(`${jobs.length} runs → ${path.relative(process.cwd(), outFile)} (claude ${report.meta.claude}, ${opt.model})`);
let next = 0, done = 0;
await Promise.all(Array.from({ length: Number(opt.concurrency) }, async () => {
  while (next < jobs.length) {
    const job = jobs[next++];
    let r;
    try {
      r = await runOne(job);
    } catch (e) {
      r = { task: job.task.id, arm: job.arm, rep: job.rep, pass: false, error: `runner: ${e.message}`, tokens: {}, tools: {} };
    }
    report.runs.push(r);
    save();
    const cost = r.costUsd == null ? "?" : `$${r.costUsd.toFixed(3)}`;
    console.log(`[${++done}/${jobs.length}] ${r.task} ${r.arm} r${r.rep}: ${r.pass ? "PASS" : "FAIL"} ` +
      `${(r.tokens.total ?? 0).toLocaleString("en-US")} tok ${cost} ${r.turns ?? "?"} turns${r.error ? `  ! ${r.error}` : ""}`);
  }
}));

const total = sum(report.runs.map((r) => r.costUsd ?? 0));
console.log(`total cost $${total.toFixed(2)} (API list price; on a subscription it counts against plan limits)`);

rmSync(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
// claude keys per-project state by the cwd; drop what the throwaway copies left behind
const projects = path.join(os.homedir(), ".claude", "projects");
const tag = path.basename(tmp);
if (existsSync(projects)) for (const d of readdirSync(projects)) if (d.includes(tag)) rmSync(path.join(projects, d), { recursive: true, force: true });
