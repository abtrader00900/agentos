#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { searchText } from "./searcher.js";
import { searchSymbols } from "./symbols.js";
import { searchHistory, blameFile, isGitRepo } from "./gitsearch.js";

/**
 * MCP Supersearch Server (FR-4.x)
 * Text (ripgrep/builtin), symbols (ast-grep), git history — all local.
 */

export function createSupersearchServer(cwd = process.env.AGENTOS_PROJECT ?? process.cwd()): McpServer {
  const server = new McpServer({ name: "agentos-supersearch", version: "0.1.0" });

  server.tool(
    "supersearch_text",
    "Search file contents by regex across the project. Honors .gitignore, skips binaries. Faster and free compared to asking the LLM to read files.",
    {
      pattern: z.string().describe("Regex to search for"),
      glob: z.string().optional().describe("e.g. '*.ts' or 'app/**'"),
      caseSensitive: z.boolean().optional().default(false),
      maxResults: z.number().optional().default(50),
    },
    async ({ pattern, glob, caseSensitive, maxResults }) => {
      try {
        const matches = searchText({ cwd, pattern, glob, caseSensitive, maxResults });
        if (!matches.length) return { content: [{ type: "text", text: "No matches." }] };
        return {
          content: [{
            type: "text",
            text: matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join("\n"),
          }],
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "supersearch_symbol",
    "Find function/class/method/interface definitions by name. Use before editing to locate symbols.",
    {
      name: z.string().optional().describe("Symbol name or substring"),
      kind: z.enum(["function", "class", "method", "interface", "struct"]).optional(),
      file: z.string().optional().describe("Restrict to one file path"),
      maxResults: z.number().optional().default(30),
    },
    async ({ name, kind, file, maxResults }) => {
      try {
        const matches = searchSymbols({ cwd, name, kind, file, maxResults });
        if (!matches.length) return { content: [{ type: "text", text: "No symbols found." }] };
        return {
          content: [{
            type: "text",
            text: matches.map((m) => `[${m.kind}] ${m.name} — ${m.file}:${m.line}\n  ${m.signature}`).join("\n"),
          }],
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    "supersearch_history",
    "Find commits that changed a string (pickaxe search) — 'when was this introduced/removed?'.",
    {
      query: z.string().describe("String to search in commit diffs"),
      maxResults: z.number().optional().default(20),
    },
    async ({ query, maxResults }) => {
      if (!isGitRepo(cwd)) {
        return { content: [{ type: "text", text: "Not a git repository." }], isError: true };
      }
      const matches = searchHistory(cwd, query, maxResults);
      if (!matches.length) return { content: [{ type: "text", text: "No commits found." }] };
      return {
        content: [{
          type: "text",
          text: matches.map((m) => `${m.commit} ${m.date} ${m.author}: ${m.message}`).join("\n"),
        }],
      };
    },
  );

  server.tool(
    "supersearch_blame",
    "Per-line authorship of a file — who last touched each line and when.",
    {
      file: z.string().describe("File path relative to project root"),
      maxLines: z.number().optional().default(200),
    },
    async ({ file, maxLines }) => {
      if (!isGitRepo(cwd)) {
        return { content: [{ type: "text", text: "Not a git repository." }], isError: true };
      }
      const lines = blameFile(cwd, file, maxLines);
      if (!lines.length) return { content: [{ type: "text", text: "No blame info." }] };
      return {
        content: [{
          type: "text",
          text: lines.map((l) => `${l.commit} ${l.date} ${l.author} L${l.line}: ${l.content}`).join("\n"),
        }],
      };
    },
  );

  return server;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (isMain) {
  const server = createSupersearchServer();
  await server.connect(new StdioServerTransport());
}
