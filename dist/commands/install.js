import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/loader.js";
import { bundledSkillsRoot, installSkill } from "../core/skills.js";
import { installSkillsFromDir, installSkillsFromGit } from "../core/registry.js";
import { sync } from "./sync.js";
const log = (msg, quiet) => { if (!quiet)
    console.log(msg); };
const GITIGNORE_ADDITIONS = [
    "",
    "# AgentOS",
    ".agentos/memory.json*",
    ".agentos/graph.json*",
    "agent.config.local.yaml",
    "",
];
/**
 * FR-2.1: setup project — configs via sync, .agentos/ dirs, .gitignore, skills.
 */
export function install(options = {}) {
    const cwd = options.cwd ?? process.cwd();
    const { config } = loadConfig(cwd);
    // 1. .agentos directory structure
    const dirs = [".agentos/skills", ".agentos/memory", ".agentos/handoffs"];
    for (const d of dirs)
        mkdirSync(path.join(cwd, d), { recursive: true });
    log("  ✓ .agentos/ directory structure", options.quiet);
    // 2. .gitignore additions
    const giPath = path.join(cwd, ".gitignore");
    const gi = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
    if (!gi.includes(".agentos/memory.json")) {
        writeFileSync(giPath, gi.replace(/\n*$/, "\n") + GITIGNORE_ADDITIONS.join("\n"));
        log("  ✓ .gitignore updated", options.quiet);
    }
    // 3. skills: bundled by name, or from `source` (local path, git URL, owner/repo[#dir])
    for (const s of config.skills) {
        try {
            if (s.source) {
                const local = path.resolve(cwd, s.source);
                const names = existsSync(local)
                    ? installSkillsFromDir(local, cwd, s.source)
                    : installSkillsFromGit(s.source, cwd);
                for (const n of names)
                    log(`  ✓ skill installed: ${n} (${s.source})`, options.quiet);
            }
            else if (existsSync(path.join(bundledSkillsRoot(), s.name))) {
                installSkill(bundledSkillsRoot(), cwd, s.name);
                log(`  ✓ skill installed: ${s.name}`, options.quiet);
            }
            else {
                log(`  ⚠ skill not found: ${s.name} (not bundled — add a "source", or run: agentos skill search ${s.name})`, options.quiet);
            }
        }
        catch (e) {
            // a failing skill (offline clone, bad SKILL.md) must not block config generation
            log(`  ⚠ skill ${s.name}: ${e.message.split("\n")[0]}`, options.quiet);
        }
    }
    // 4. generate configs for all harnesses
    sync({ cwd, quiet: options.quiet, force: options.force });
    log(`\nDone. Open Claude Code / Codex / Antigravity / Cursor / Windsurf — configs + MCP are ready.`, options.quiet);
}
//# sourceMappingURL=install.js.map