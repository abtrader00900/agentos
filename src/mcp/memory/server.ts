#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { MemoryStore } from "./store.js";
import { projectRoot } from "../../core/project.js";

/**
 * MCP Memory Server (FR-3.x)
 * Zero network, zero API. stdio transport → works with Claude Code, Codex, Antigravity.
 *
 * Storage: <project>/.agentos/memory.json (resolved from cwd, or AGENTOS_PROJECT env)
 */

function resolveDbPath(): string {
  const project = projectRoot();
  return path.join(project, ".agentos", "memory.json");
}

export function createMemoryServer(dbPath = resolveDbPath()): McpServer {
  const store = new MemoryStore(dbPath);

  const server = new McpServer({
    name: "agentos-memory",
    version: "0.1.0",
  });

  server.tool(
    "memory_store",
    "Store a project fact (architecture decision, convention, entity location). Persists across sessions.",
    {
      topic: z.string().describe("Category, e.g. 'architecture', 'conventions', 'entities'"),
      key: z.string().describe("Short identifier, e.g. 'auth-flow'"),
      value: z.string().describe("The fact content"),
      source: z.string().optional().describe("Where this came from (file path, commit)"),
      pinned: z.boolean().optional().describe("Pinned facts sort first in recall and are marked in exports and handoffs"),
    },
    async ({ topic, key, value, source, pinned }) => {
      const fact = store.store({ topic, key, value, source, pinned });
      return { content: [{ type: "text", text: `Stored [${fact.topic}/${fact.key}]` }] };
    },
  );

  server.tool(
    "memory_recall",
    "Recall stored project facts. Filter by topic, key substring, or free text.",
    {
      topic: z.string().optional(),
      key: z.string().optional(),
      text: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional().default(20),
    },
    async (query) => {
      const facts = store.recall(query);
      if (!facts.length) return { content: [{ type: "text", text: "No matching facts." }] };
      const out = facts
        .map((f) => `[${f.topic}/${f.key}]${f.pinned ? " 📌" : ""} ${f.value}${f.source ? ` (src: ${f.source})` : ""} — ${f.updated_at}`)
        .join("\n");
      return { content: [{ type: "text", text: out }] };
    },
  );

  server.tool(
    "memory_get",
    "Get one exact fact by topic + key.",
    { topic: z.string(), key: z.string() },
    async ({ topic, key }) => {
      const fact = store.get(topic, key);
      return { content: [{ type: "text", text: fact ? fact.value : `No fact [${topic}/${key}]` }] };
    },
  );

  server.tool(
    "memory_forget",
    "Delete a fact.",
    { topic: z.string(), key: z.string() },
    async ({ topic, key }) => {
      const ok = store.forget(topic, key);
      return { content: [{ type: "text", text: ok ? "Deleted." : "Fact not found." }] };
    },
  );

  server.tool(
    "memory_topics",
    "List all memory topics.",
    {},
    async () => {
      const topics = store.topics();
      return { content: [{ type: "text", text: topics.length ? topics.join(", ") : "(empty)" }] };
    },
  );

  server.tool(
    "memory_export",
    "Export all memory as markdown.",
    {},
    async () => ({ content: [{ type: "text", text: store.exportMarkdown() }] }),
  );

  server.tool(
    "memory_stats",
    "Memory stats: fact count, topic count.",
    {},
    async () => {
      const s = store.stats();
      return { content: [{ type: "text", text: `${s.facts} facts across ${s.topics} topics.` }] };
    },
  );

  return server;
}

// Run directly → stdio transport
const isMain = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (isMain) {
  const server = createMemoryServer();
  await server.connect(new StdioServerTransport());
}
