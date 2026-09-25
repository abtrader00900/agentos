#!/usr/bin/env node
import { Command } from "commander";
import { init } from "./commands/init.js";
import { install } from "./commands/install.js";
import { sync } from "./commands/sync.js";
import { status } from "./commands/status.js";
import { skillList, skillInstall, skillTest } from "./commands/skill.js";
import { handoff, handoffShow } from "./commands/handoff.js";
import { doctor } from "./commands/doctor.js";
import { learn } from "./commands/learn.js";
import { createMemoryServer } from "./mcp/memory/server.js";
import { createSupersearchServer } from "./mcp/supersearch/server.js";
import { createCodegraphServer } from "./mcp/codegraph/server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ALL_HARNESSES } from "./core/schema.js";
import type { HarnessName } from "./core/schema.js";

const program = new Command();

program
  .name("agentos")
  .description("Local-first, multi-harness agent operating system. Zero API dependency.")
  .version("0.1.0");

program
  .command("init")
  .description("Create agent.config.yaml in the current project")
  .option("--force", "overwrite existing config")
  .action((opts) => {
    try { init({ force: opts.force }); } catch (e) { fail(e); }
  });

program
  .command("install")
  .description("Set up project: configs, .agentos/ dirs, skills, .gitignore")
  .action(() => {
    try { install(); } catch (e) { fail(e); }
  });

program
  .command("sync")
  .description("Regenerate all harness configs from agent.config.yaml")
  .option("--only <harnesses>", `comma-separated: ${ALL_HARNESSES.join(", ")}`)
  .option("--force", "overwrite hand-edited (drifted) files")
  .action((opts) => {
    try {
      const only = opts.only
        ? (opts.only.split(",").map((s: string) => s.trim()) as HarnessName[])
        : undefined;
      if (only) {
        for (const h of only) {
          if (!ALL_HARNESSES.includes(h)) fail(new Error(`Unknown harness "${h}". Valid: ${ALL_HARNESSES.join(", ")}`));
        }
      }
      sync({ only, force: opts.force });
    } catch (e) { fail(e); }
  });

program
  .command("status")
  .description("Show project, harnesses, drift, and memory status")
  .option("--json", "machine-readable JSON output (for editor integrations)")
  .action((opts) => {
    try { status({ json: opts.json }); } catch (e) { fail(e); }
  });

const mcp = program.command("mcp").description("Run MCP servers (for harness registration)");

mcp
  .command("memory")
  .description("Run the memory MCP server over stdio")
  .action(async () => {
    const server = createMemoryServer();
    await server.connect(new StdioServerTransport());
  });

mcp
  .command("supersearch")
  .description("Run the supersearch MCP server over stdio (text/symbol/git-history search)")
  .action(async () => {
    const server = createSupersearchServer();
    await server.connect(new StdioServerTransport());
  });

mcp
  .command("codegraph")
  .description("Run the codegraph MCP server over stdio (dependency graph + impact analysis)")
  .action(async () => {
    const server = createCodegraphServer();
    await server.connect(new StdioServerTransport());
  });

const skill = program.command("skill").description("Manage AgentOS skills");

skill
  .command("list")
  .description("List bundled + installed skills")
  .option("--json", "machine-readable JSON output (for editor integrations)")
  .action((opts) => { try { skillList({ json: opts.json }); } catch (e) { fail(e); } });

skill
  .command("install <name>")
  .description("Install a bundled skill into this project")
  .action((name: string) => { try { skillInstall(name); } catch (e) { fail(e); } });

skill
  .command("test")
  .description("Validate all skills (frontmatter, structure, tests)")
  .action(() => { try { skillTest(); } catch (e) { fail(e); } });

program
  .command("handoff")
  .description("Export full agent context (task, decisions, memory, git) for another harness — FR-7")
  .option("--to <harness>", "target harness: claude-code | codex | antigravity | any")
  .option("--from <harness>", "source harness (auto-detected if omitted)")
  .option("--task <text>", "REQUIRED: what was being worked on + current state")
  .option("--files <list>", "comma-separated files in progress")
  .option("--decisions <list>", "comma-separated pending decisions")
  .option("--questions <list>", "comma-separated open questions")
  .option("--notes <text>", "free-form notes")
  .action((opts) => {
    try { handoff(opts); } catch (e) { fail(e); }
  });

program
  .command("handoff:show")
  .description("Print the latest handoff bundle")
  .action(() => { try { handoffShow(); } catch (e) { fail(e); } });

program
  .command("doctor")
  .description("Health check: config, harnesses, drift, MCP, memory, skills, handoff")
  .option("--json", "machine-readable JSON output (for editor integrations)")
  .action((opts) => {
    try {
      if (opts.json) {
        const { checks, ok } = doctor({ quiet: true });
        console.log(JSON.stringify({ ok, checks }, null, 2));
        if (!ok) process.exit(1);
        return;
      }
      const { ok } = doctor();
      if (!ok) process.exit(1);
    } catch (e) { fail(e); }
  });

program
  .command("learn")
  .description("Learn rules from git history (co-changing files, hot spots) — auto-improvement loop")
  .option("--apply", "append suggestions to agent.config.local.yaml (review, then promote)")
  .action((opts) => { try { learn({ apply: opts.apply }); } catch (e) { fail(e); } });

function fail(e: unknown): never {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
}

program.parseAsync(process.argv);
