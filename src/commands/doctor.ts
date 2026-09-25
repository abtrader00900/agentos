import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/loader.js";
import { detectDrift } from "../core/manifest.js";
import { testSkills, bundledSkillsRoot, listSkills } from "../core/skills.js";
import { MemoryStore } from "../mcp/memory/store.js";

/**
 * FR-2.4: doctor — health checks with actionable fixes.
 * Exits 1 if any BLOCKER found.
 */

interface Check {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fix?: string;
}

export function doctor(options: { cwd?: string; quiet?: boolean } = {}): { checks: Check[]; ok: boolean } {
  const cwd = options.cwd ?? process.cwd();
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  // 1. config
  let config;
  try {
    const loaded = loadConfig(cwd);
    config = loaded.config;
    add({ name: "config", status: "pass", detail: `${loaded.sources.length} source(s), ${config.rules.length} rules` });
  } catch (e) {
    add({ name: "config", status: "fail", detail: (e as Error).message.split("\n")[0], fix: "Run: agentos init" });
    return report(checks, options);
  }

  // 2. harness configs present
  const harnessFiles: Record<string, string> = {
    "claude-code": "CLAUDE.md",
    codex: "AGENTS.md",
    antigravity: ".antigravity/config.md",
  };
  for (const [h, f] of Object.entries(harnessFiles)) {
    if (existsSync(path.join(cwd, f))) {
      add({ name: `harness:${h}`, status: "pass", detail: f });
    } else {
      add({ name: `harness:${h}`, status: "warn", detail: `${f} missing`, fix: "Run: agentos sync" });
    }
  }

  // 3. drift
  const drift = detectDrift(cwd, new Map());
  if (drift.drifted.length) {
    add({ name: "drift", status: "warn", detail: `hand-edited: ${drift.drifted.join(", ")}`, fix: "Move edits into agent.config.yaml, then: agentos sync --force" });
  } else {
    add({ name: "drift", status: "pass", detail: "none" });
  }

  // 4. MCP servers configured + command resolvable
  for (const s of config.mcpServers) {
    const cmd = s.command;
    const isLocalScript = s.args.some((a) => a.endsWith(".ts") || a.endsWith(".js"));
    const onPath = isCommandOnPath(cmd);
    if (cmd === "npx" || cmd === "node" || cmd === "agentos" || onPath || isLocalScript) {
      add({ name: `mcp:${s.name}`, status: "pass", detail: `${cmd} ${s.args.join(" ")}` });
    } else {
      add({ name: `mcp:${s.name}`, status: "fail", detail: `command '${cmd}' not found on PATH`, fix: "Fix mcpServers in agent.config.yaml" });
    }
  }

  // 5. memory
  const memDb = path.join(cwd, ".agentos", "memory.json");
  if (existsSync(memDb)) {
    try {
      const store = new MemoryStore(memDb);
      const s = store.stats();
      store.close();
      add({ name: "memory", status: "pass", detail: `${s.facts} facts, ${(statSync(memDb).size / 1024).toFixed(1)} KB` });
    } catch (e) {
      add({ name: "memory", status: "fail", detail: `corrupt: ${(e as Error).message}`, fix: "Delete .agentos/memory.json (memory regenerates)" });
    }
  } else {
    add({ name: "memory", status: "pass", detail: "not initialized yet (normal before first MCP use)" });
  }

  // 6. skills valid
  const skills = testSkills(bundledSkillsRoot());
  const badSkills = skills.filter((s) => !s.ok);
  if (badSkills.length) {
    add({ name: "skills", status: "fail", detail: badSkills.map((s) => `${s.skill}: ${s.issues.join("; ")}`).join(" | ") });
  } else {
    add({ name: "skills", status: "pass", detail: `${skills.length} skills valid` });
  }
  const installedRoot = path.join(cwd, ".agentos", "skills");
  if (existsSync(installedRoot)) {
    const missing = config.skills.filter((s) => !listSkills(installedRoot).some((i) => i.name === s.name));
    if (missing.length) {
      add({ name: "skills:installed", status: "warn", detail: `declared but not installed: ${missing.map((s) => s.name).join(", ")}`, fix: "Run: agentos install" });
    } else {
      add({ name: "skills:installed", status: "pass", detail: `${config.skills.length} installed` });
    }
  }

  // 7. handoff freshness
  const rootMd = path.join(cwd, "HANDOFF.md");
  if (existsSync(rootMd)) {
    const ageH = (Date.now() - statSync(rootMd).mtimeMs) / 3.6e6;
    if (ageH > 24) {
      add({ name: "handoff", status: "warn", detail: `HANDOFF.md is ${Math.floor(ageH)}h old`, fix: "Stale context — re-run: agentos handoff, or delete HANDOFF.md if consumed" });
    } else {
      add({ name: "handoff", status: "pass", detail: `${Math.floor(ageH)}h old` });
    }
  }

  return report(checks, options);
}

function isCommandOnPath(cmd: string): boolean {
  if (spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0) return true;
  return spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;
}

function report(checks: Check[], options: { quiet?: boolean }): { checks: Check[]; ok: boolean } {
  const ok = !checks.some((c) => c.status === "fail");
  if (!options.quiet) {
    for (const c of checks) {
      const icon = c.status === "pass" ? "✓" : c.status === "warn" ? "⚠" : "✗";
      console.log(`${icon} ${c.name}: ${c.detail}`);
      if (c.fix) console.log(`    fix → ${c.fix}`);
    }
    const fails = checks.filter((c) => c.status === "fail").length;
    const warns = checks.filter((c) => c.status === "warn").length;
    console.log(`\n${checks.length - fails - warns} pass, ${warns} warn, ${fails} fail`);
  }
  return { checks, ok };
}
