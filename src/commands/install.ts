import { existsSync, mkdirSync, writeFileSync, cpSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/loader.js";
import { sync } from "./sync.js";

export interface InstallOptions {
  cwd?: string;
  quiet?: boolean;
}

const log = (msg: string, quiet?: boolean) => { if (!quiet) console.log(msg); };

const GITIGNORE_ADDITIONS = [
  "",
  "# AgentOS",
  ".agentos/memory.json",
  ".agentos/memory.json-*",
  ".agentos/graph.json*",
  "agent.config.local.yaml",
  "",
];

/**
 * FR-2.1: setup project — configs via sync, .agentos/ dirs, .gitignore, core skills.
 */
export function install(options: InstallOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const { config } = loadConfig(cwd);

  // 1. .agentos directory structure
  const dirs = [".agentos/skills", ".agentos/memory", ".agentos/handoffs"];
  for (const d of dirs) mkdirSync(path.join(cwd, d), { recursive: true });
  log("  ✓ .agentos/ directory structure", options.quiet);

  // 2. .gitignore additions
  const giPath = path.join(cwd, ".gitignore");
  const gi = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
  if (!gi.includes(".agentos/memory.json")) {
    writeFileSync(giPath, gi.replace(/\n*$/, "\n") + GITIGNORE_ADDITIONS.join("\n"));
    log("  ✓ .gitignore updated", options.quiet);
  }

  // 3. copy bundled skills into .agentos/skills
  const bundledSkillsDir = path.resolve(import.meta.dirname, "../../skills");
  if (existsSync(bundledSkillsDir)) {
    for (const skillName of config.skills.map((s) => s.name)) {
      const src = path.join(bundledSkillsDir, skillName);
      if (existsSync(src)) {
        cpSync(src, path.join(cwd, ".agentos/skills", skillName), { recursive: true });
        log(`  ✓ skill installed: ${skillName}`, options.quiet);
      } else if (!config.skills.find((s) => s.name === skillName)?.source) {
        log(`  ⚠ bundled skill not found: ${skillName}`, options.quiet);
      }
    }
  }

  // 4. generate configs for all harnesses
  sync({ cwd, quiet: options.quiet });

  log(`\nDone. Open Claude Code / Codex / Antigravity — configs + MCP are ready.`, options.quiet);
}
