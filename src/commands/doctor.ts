import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { loadConfig } from "../core/loader.js";
import { cronError } from "../daemon/schedule.js";
import { parseStandbyMinutes } from "../daemon/service.js";
import { detectDrift } from "../core/manifest.js";
import { gitCapture, handoffStaleness, HANDOFF_FIX } from "../core/handoff.js";
import { HARNESS_MARKER } from "../generators/index.js";
import { testSkills, bundledSkillsRoot } from "../core/skills.js";
import { PKG, VERSION } from "../version.js";
import { MAX_ACTIVE } from "../learning/lessons.js";

/** the generated files that start MCP servers */
const MCP_FILES = [".mcp.json", ".codex/config.toml", ".cursor/mcp.json", ".agents/mcp_config.json"];

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
    if (!loaded.hasProject) {
      add({ name: "config", status: "fail", detail: `no agent.config.yaml in ${cwd} (only the global defaults)`, fix: "Run: agentos init" });
      return report(checks, options);
    }
    add({ name: "config", status: "pass", detail: `${loaded.sources.length} source(s), ${config.rules.length} rules` });
  } catch (e) {
    add({ name: "config", status: "fail", detail: (e as Error).message.split("\n")[0], fix: "Run: agentos init" });
    return report(checks, options);
  }

  // 2. harness configs present
  // sync() generates for every harness in generators/index.ts, so check them all.
  const harnessFiles: Record<string, string> = HARNESS_MARKER;
  for (const [h, f] of Object.entries(harnessFiles)) {
    if (existsSync(path.join(cwd, f))) {
      add({ name: `harness:${h}`, status: "pass", detail: f });
    } else {
      add({ name: `harness:${h}`, status: "warn", detail: `${f} missing`, fix: "Run: agentos sync" });
    }
  }

  // 3. drift
  const drift = detectDrift(cwd);
  if (drift.drifted.length) {
    add({ name: "drift", status: "warn", detail: `hand-edited: ${drift.drifted.join(", ")}`, fix: "Move edits into agent.config.yaml, then: agentos sync --force" });
  } else {
    add({ name: "drift", status: "pass", detail: "none" });
  }

  // 4. MCP servers configured + command resolvable
  for (const s of config.mcpServers) {
    const cmd = s.command;
    const scripts = s.args.filter((a) => /\.(c|m)?[jt]s$/.test(a));
    const missingScript = scripts.find((a) => !existsSync(path.resolve(cwd, a)));
    const isLocalScript = scripts.length > 0;
    const known = cmd === "npx" || cmd === "node" || cmd === "agentos";
    // `npx agentos` runs a stranger's placeholder package — the published name is @basit0090/agent-os
    const npxPkg = cmd === "npx" ? s.args.find((a) => !a.startsWith("-")) : undefined;
    if (npxPkg && /^(agentos|agent-os)(@|$)/.test(npxPkg)) {
      add({ name: `mcp:${s.name}`, status: "fail", detail: `npx package '${npxPkg}' is not AgentOS`, fix: `In agent.config.yaml mcpServers, replace "${npxPkg}" with "${PKG}", then: agentos sync` });
    } else if (missingScript) {
      add({ name: `mcp:${s.name}`, status: "fail", detail: `script not found: ${missingScript}`, fix: "Fix the path in agent.config.yaml mcpServers (relative paths resolve from the project root)" });
    } else if (known || isLocalScript || isCommandOnPath(cmd)) {
      add({ name: `mcp:${s.name}`, status: "pass", detail: `${cmd} ${s.args.join(" ")}` });
    } else {
      add({ name: `mcp:${s.name}`, status: "fail", detail: `command '${cmd}' not found on PATH`, fix: "Fix mcpServers in agent.config.yaml" });
    }
  }

  // 4b. generated MCP files run the agentos version of this CLI (npx caches an unversioned spec forever)
  const specRe = new RegExp(`"${PKG.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?:@([^"]*))?"`, "g");
  const pins: string[] = [];
  const off: string[] = [];
  for (const f of MCP_FILES) {
    const abs = path.join(cwd, f);
    if (!existsSync(abs)) continue;
    for (const [, v] of readFileSync(abs, "utf8").matchAll(specRe)) {
      pins.push(f);
      if (v !== VERSION) off.push(`${f} runs ${v ?? "unpinned"}`);
    }
  }
  if (off.length) {
    const why = off.some((o) => o.endsWith("unpinned")) ? " (npx keeps running whichever version it cached first for an unpinned spec)" : "";
    add({
      name: "mcp:version", status: "warn",
      detail: `${[...new Set(off)].join(", ")} — this CLI is ${VERSION}${why}`,
      fix: "Run: agentos sync (it pins the version of the CLI you run; a version written in agent.config.yaml mcpServers stays as written)",
    });
  } else if (pins.length) {
    add({ name: "mcp:version", status: "pass", detail: `generated MCP configs run ${PKG}@${VERSION}` });
  }

  // 5. memory
  const memDb = path.join(cwd, ".agentos", "memory.json");
  if (existsSync(memDb)) {
    // read it directly: opening a MemoryStore would quarantine a corrupt file as a side effect
    try {
      const data = JSON.parse(readFileSync(memDb, "utf8")) as { facts?: unknown };
      const facts = (Array.isArray(data?.facts) ? data.facts : []) as { topic?: string; key?: string; pinned?: number; updated_at?: string; meta?: { status?: string } }[];
      add({ name: "memory", status: "pass", detail: `${facts.length} facts, ${(statSync(memDb).size / 1024).toFixed(1)} KB` });

      const active = facts.filter((f) => f?.topic === "lessons" && ["auto", "approved"].includes(f.meta?.status ?? "")).length;
      if (active > MAX_ACTIVE) {
        add({ name: "lessons:count", status: "warn", detail: `${active} active lessons (limit ${MAX_ACTIVE}) — prompts get only the top few`, fix: "Run: agentos lessons, then agentos lessons forget <key> for stale ones" });
      }

      // pinned facts ride along in every handoff snapshot — one reality moved past misleads every chat
      const days = config.staleAfter.pinnedFactDays;
      const pinned = facts.filter((f) => f?.pinned);
      const cutoff = Date.now() - days * 864e5;
      const stale = pinned.filter((f) => !(Date.parse(f.updated_at ?? "") >= cutoff));
      if (stale.length) {
        add({
          name: "memory:pinned", status: "warn",
          detail: `${stale.length} pinned fact(s) not updated in ${days}+ days: ` +
            stale.map((f) => `[${f.topic}/${f.key}] ${String(f.updated_at ?? "?").slice(0, 10)}`).join(", "),
          fix: "Still true? Re-store it with memory_store (that updates its date). Changed? Store the new value, or memory_forget it.",
        });
      } else if (pinned.length) {
        add({ name: "memory:pinned", status: "pass", detail: `${pinned.length} pinned, all updated within ${days} days` });
      }
    } catch (e) {
      add({ name: "memory", status: "fail", detail: `unreadable: ${(e as Error).message.split("\n")[0]}`, fix: "Move .agentos/memory.json aside (keep it for recovery); memory starts fresh on next MCP use" });
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
  // installed skills include community ones — validate them, not just the bundled set
  const installedRoot = path.join(cwd, ".agentos", "skills");
  if (existsSync(installedRoot)) {
    const installed = testSkills(installedRoot, { requireTest: false });
    const broken = installed.filter((s) => !s.ok);
    // a `source` entry may install skills under other names — only named, sourceless entries are checkable
    const missing = config.skills.filter((s) => !s.source && !installed.some((i) => i.skill === s.name));
    if (broken.length) {
      add({ name: "skills:installed", status: "fail", detail: broken.map((s) => `${s.skill}: ${s.issues.join("; ")}`).join(" | "), fix: "Re-install it: agentos skill install <name>, or delete .agentos/skills/<name>" });
    } else if (missing.length) {
      add({ name: "skills:installed", status: "warn", detail: `declared but not installed: ${missing.map((s) => s.name).join(", ")}`, fix: "Run: agentos install" });
    } else {
      add({ name: "skills:installed", status: "pass", detail: `${installed.length} installed, all valid` });
    }
  }

  // 7. handoff freshness — sync injects HANDOFF.md into every rule file
  const handoff = handoffStaleness(cwd, config.staleAfter);
  if (handoff) {
    add(handoff.stale
      ? { name: "handoff", status: "warn", detail: handoff.detail, fix: HANDOFF_FIX }
      : { name: "handoff", status: "pass", detail: handoff.detail });
  }

  // 8. Codex reads .codex/config.toml (the MCP servers) only in trusted projects. Trust is a
  // security setting that belongs to the user: report it, never write it.
  const codexHome = process.env.CODEX_HOME || path.join(homedir(), ".codex");
  const projectToml = path.join(cwd, ".codex", "config.toml");
  // no [mcp_servers.*] → nothing Codex would miss
  if (existsSync(projectToml) && /^\s*\[mcp_servers\./m.test(readFileSync(projectToml, "utf8")) && existsSync(codexHome)) {
    const globalToml = path.join(codexHome, "config.toml");
    const trusted = existsSync(globalToml) ? trustedCodexProjects(readFileSync(globalToml, "utf8")) : [];
    // Codex keys trust by the git repository root (the main checkout, for a worktree), else the folder
    const commonDir = gitCapture(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const roots = [commonDir && path.dirname(commonDir), gitCapture(cwd, ["rev-parse", "--show-toplevel"]), cwd].filter(Boolean);
    if (roots.some((r) => trusted.some((t) => sameCodexPath(t, r)))) {
      add({ name: "codex:trust", status: "pass", detail: "project is trusted — Codex loads .codex/config.toml" });
    } else {
      const root = path.resolve(roots[0]);
      const key = process.platform === "win32" ? root.toLowerCase() : root;
      add({
        name: "codex:trust", status: "warn",
        detail: "Codex ignores .codex/config.toml (the agentos MCP servers) until this project is trusted",
        fix: `Open ${root} in Codex and choose to trust it when asked (Codex app: add it as a project; CLI: run codex there). ` +
          `agentos does not change trust settings. By hand: add [projects.'${key}'] with trust_level = "trusted" to ${globalToml}`,
      });
    }
  }

  // 9. daemon — schedules that cannot fire, and a machine that sleeps through them
  if (config.daemon) {
    const bad = config.daemon.schedules.map((s) => [s.cron, cronError(s.cron)] as const).filter(([, e]) => e);
    add(bad.length
      ? { name: "daemon:schedules", status: "warn", detail: bad.map(([c, e]) => `"${c}": ${e}`).join("; "), fix: "Fix the cron in agent.config.yaml daemon.schedules (5 fields, e.g. \"0 2 * * *\")" }
      : { name: "daemon:schedules", status: "pass", detail: `${config.daemon.schedules.length} schedule(s)${config.daemon.enabled ? "" : " (daemon.enabled is off)"}` });
    if (config.daemon.enabled && process.platform === "win32") {
      try {
        const min = parseStandbyMinutes(execFileSync("powercfg", ["/query", "SCHEME_CURRENT", "SUB_SLEEP", "STANDBYIDLE"], { encoding: "utf8", windowsHide: true }));
        if (min) add({ name: "daemon:sleep", status: "warn", detail: `Windows sleeps after ${min} min on AC power — the daemon does nothing while asleep`, fix: "Settings → System → Power → Screen and sleep → When plugged in, put my device to sleep after: Never" });
      } catch { /* powercfg unavailable: nothing to report */ }
    }
  }

  return report(checks, options);
}

/** project paths with trust_level = "trusted" in Codex's config.toml ([projects.'<path>'] or [projects."<path>"] tables) */
export function trustedCodexProjects(toml: string): string[] {
  const out: string[] = [];
  let project: string | null = null;
  for (const line of toml.split(/\r?\n/)) {
    const header = /^\s*\[\s*projects\s*\.\s*(?:'([^']*)'|"((?:[^"\\]|\\.)*)")\s*\]\s*(#.*)?$/.exec(line);
    if (header) {
      try { project = header[1] ?? JSON.parse(`"${header[2]}"`); } catch { project = null; }
    } else if (/^\s*\[/.test(line)) {
      project = null;
    } else if (project !== null && /^\s*trust_level\s*=\s*["']trusted["']/.test(line)) {
      out.push(project);
    }
  }
  return out;
}

/** Codex lower-cases project keys on Windows (d:\madina electric yasir\…); elsewhere paths compare exactly */
export function sameCodexPath(a: string, b: string, platform: string = process.platform): boolean {
  const norm = platform === "win32"
    ? (p: string) => path.win32.resolve(p.replace(/^\\\\\?\\/, "")).replace(/\\+$/, "").toLowerCase()
    : (p: string) => path.posix.resolve(p).replace(/(.)\/+$/, "$1");
  return norm(a) === norm(b);
}

/**
 * Resolve a command on PATH *without running it*.
 *
 * doctor reads mcpServers straight out of agent.config.yaml, which is a
 * committed, shared file -- probing with `cmd --version` meant whoever wrote
 * that config got arbitrary code execution out of a health check. Scanning PATH
 * also fixes Windows, where the old `which` fallback does not exist and
 * executables are resolved through PATHEXT (.cmd shims for npx/npm).
 */
export function isCommandOnPath(cmd: string): boolean {
  return resolveOnPath(cmd) !== undefined;
}

/** The file a command resolves to on PATH (PATHEXT on Windows), or undefined. The current directory is never searched. */
export function resolveOnPath(cmd: string): string | undefined {
  if (cmd.includes("/") || cmd.includes("\\")) return existsSync(cmd) ? cmd : undefined;

  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];

  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      if (existsSync(path.join(dir, cmd + ext))) return path.join(dir, cmd + ext);
    }
  }
  return undefined;
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
