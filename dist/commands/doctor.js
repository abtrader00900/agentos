import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/loader.js";
import { detectDrift } from "../core/manifest.js";
import { HARNESS_MARKER } from "../generators/index.js";
import { testSkills, bundledSkillsRoot } from "../core/skills.js";
import { PKG } from "./init.js";
export function doctor(options = {}) {
    const cwd = options.cwd ?? process.cwd();
    const checks = [];
    const add = (c) => checks.push(c);
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
    }
    catch (e) {
        add({ name: "config", status: "fail", detail: e.message.split("\n")[0], fix: "Run: agentos init" });
        return report(checks, options);
    }
    // 2. harness configs present
    // sync() generates for every harness in generators/index.ts, so check them all.
    const harnessFiles = HARNESS_MARKER;
    for (const [h, f] of Object.entries(harnessFiles)) {
        if (existsSync(path.join(cwd, f))) {
            add({ name: `harness:${h}`, status: "pass", detail: f });
        }
        else {
            add({ name: `harness:${h}`, status: "warn", detail: `${f} missing`, fix: "Run: agentos sync" });
        }
    }
    // 3. drift
    const drift = detectDrift(cwd);
    if (drift.drifted.length) {
        add({ name: "drift", status: "warn", detail: `hand-edited: ${drift.drifted.join(", ")}`, fix: "Move edits into agent.config.yaml, then: agentos sync --force" });
    }
    else {
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
        }
        else if (missingScript) {
            add({ name: `mcp:${s.name}`, status: "fail", detail: `script not found: ${missingScript}`, fix: "Fix the path in agent.config.yaml mcpServers (relative paths resolve from the project root)" });
        }
        else if (known || isLocalScript || isCommandOnPath(cmd)) {
            add({ name: `mcp:${s.name}`, status: "pass", detail: `${cmd} ${s.args.join(" ")}` });
        }
        else {
            add({ name: `mcp:${s.name}`, status: "fail", detail: `command '${cmd}' not found on PATH`, fix: "Fix mcpServers in agent.config.yaml" });
        }
    }
    // 5. memory
    const memDb = path.join(cwd, ".agentos", "memory.json");
    if (existsSync(memDb)) {
        // read it directly: opening a MemoryStore would quarantine a corrupt file as a side effect
        try {
            const data = JSON.parse(readFileSync(memDb, "utf8"));
            const facts = Array.isArray(data?.facts) ? data.facts.length : 0;
            add({ name: "memory", status: "pass", detail: `${facts} facts, ${(statSync(memDb).size / 1024).toFixed(1)} KB` });
        }
        catch (e) {
            add({ name: "memory", status: "fail", detail: `unreadable: ${e.message.split("\n")[0]}`, fix: "Move .agentos/memory.json aside (keep it for recovery); memory starts fresh on next MCP use" });
        }
    }
    else {
        add({ name: "memory", status: "pass", detail: "not initialized yet (normal before first MCP use)" });
    }
    // 6. skills valid
    const skills = testSkills(bundledSkillsRoot());
    const badSkills = skills.filter((s) => !s.ok);
    if (badSkills.length) {
        add({ name: "skills", status: "fail", detail: badSkills.map((s) => `${s.skill}: ${s.issues.join("; ")}`).join(" | ") });
    }
    else {
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
        }
        else if (missing.length) {
            add({ name: "skills:installed", status: "warn", detail: `declared but not installed: ${missing.map((s) => s.name).join(", ")}`, fix: "Run: agentos install" });
        }
        else {
            add({ name: "skills:installed", status: "pass", detail: `${installed.length} installed, all valid` });
        }
    }
    // 7. handoff freshness
    const rootMd = path.join(cwd, "HANDOFF.md");
    if (existsSync(rootMd)) {
        const ageH = (Date.now() - statSync(rootMd).mtimeMs) / 3.6e6;
        if (ageH > 24) {
            add({ name: "handoff", status: "warn", detail: `HANDOFF.md is ${Math.floor(ageH)}h old`, fix: "Stale context — re-run: agentos handoff, or delete HANDOFF.md if consumed" });
        }
        else {
            add({ name: "handoff", status: "pass", detail: `${Math.floor(ageH)}h old` });
        }
    }
    return report(checks, options);
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
function isCommandOnPath(cmd) {
    if (cmd.includes("/") || cmd.includes("\\"))
        return existsSync(cmd);
    const exts = process.platform === "win32"
        ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
        : [""];
    for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
        for (const ext of exts) {
            if (existsSync(path.join(dir, cmd + ext)))
                return true;
        }
    }
    return false;
}
function report(checks, options) {
    const ok = !checks.some((c) => c.status === "fail");
    if (!options.quiet) {
        for (const c of checks) {
            const icon = c.status === "pass" ? "✓" : c.status === "warn" ? "⚠" : "✗";
            console.log(`${icon} ${c.name}: ${c.detail}`);
            if (c.fix)
                console.log(`    fix → ${c.fix}`);
        }
        const fails = checks.filter((c) => c.status === "fail").length;
        const warns = checks.filter((c) => c.status === "warn").length;
        console.log(`\n${checks.length - fails - warns} pass, ${warns} warn, ${fails} fail`);
    }
    return { checks, ok };
}
//# sourceMappingURL=doctor.js.map