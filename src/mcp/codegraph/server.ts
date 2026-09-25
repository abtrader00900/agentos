#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { GraphStore } from "./graph.js";

/**
 * MCP Codegraph Server (FR-5.x)
 * Dependency graph + change impact analysis — deterministic, local, no model.
 */

function projectRoot(): string {
  return process.env.AGENTOS_PROJECT ?? process.cwd();
}

function dbPath(): string {
  return path.join(projectRoot(), ".agentos", "graph.json");
}

export function createCodegraphServer(root = projectRoot()): McpServer {
  const store = new GraphStore(dbPath());

  const server = new McpServer({ name: "agentos-codegraph", version: "0.1.0" });

  const fmt = (files: string[], empty: string) =>
    files.length ? { content: [{ type: "text" as const, text: files.join("\n") }] }
                 : { content: [{ type: "text" as const, text: empty }] };

  server.tool(
    "codegraph_impact",
    "FR-5.3: If I change this file, what breaks? Returns every file that (transitively) depends on it.",
    { file: z.string().describe("Path relative to project root") },
    async ({ file }) => {
      store.update(root);
      const direct = store.impact(file);
      if (!direct.length) return fmt([], `Nothing imports "${file}". No impact.`);
      // transitive closure (bounded)
      const seen = new Set<string>([file]);
      const queue = [file];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const dep of store.impact(cur)) {
          if (!seen.has(dep)) { seen.add(dep); queue.push(dep); }
        }
      }
      seen.delete(file);
      const text = [
        `Direct dependents (${direct.length}):`,
        ...direct,
        ``,
        `Full transitive impact (${seen.size} files):`,
        ...[...seen].sort(),
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "codegraph_deps",
    "What does this file import/depend on?",
    { file: z.string() },
    async ({ file }) => fmt(store.dependencies(file), `"${file}" has no resolved internal dependencies.`),
  );

  server.tool(
    "codegraph_orphans",
    "Files nobody imports — dead code candidates (FR-5.6).",
    {},
    async () => {
      store.update(root);
      return fmt(store.orphans(), "No orphan files.");
    },
  );

  server.tool(
    "codegraph_cycles",
    "Import cycles in the project (FR-5.6).",
    {},
    async () => {
      const cycles = store.cycles();
      return fmt(
        cycles.map((c) => c.join(" → ")),
        "No import cycles found.",
      );
    },
  );

  server.tool(
    "codegraph_rebuild",
    "Force full graph rebuild (normally incremental updates happen automatically).",
    {},
    async () => {
      const r = store.rebuild(root);
      return { content: [{ type: "text", text: `Rebuilt: ${r.scanned} files scanned, ${r.changed} processed.` }] };
    },
  );

  server.tool(
    "codegraph_stats",
    "Graph size stats.",
    {},
    async () => {
      const s = store.stats();
      return { content: [{ type: "text", text: `${s.files} files, ${s.edges} dependency edges.` }] };
    },
  );

  return server;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (isMain) {
  const server = createCodegraphServer();
  await server.connect(new StdioServerTransport());
}
