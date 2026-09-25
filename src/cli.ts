#!/usr/bin/env node
import { Command } from "commander";
import { init } from "./commands/init.js";
import { install } from "./commands/install.js";
import { sync } from "./commands/sync.js";
import { status } from "./commands/status.js";
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
  .action(() => {
    try { status(); } catch (e) { fail(e); }
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

function fail(e: unknown): never {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
}

program.parseAsync(process.argv);
