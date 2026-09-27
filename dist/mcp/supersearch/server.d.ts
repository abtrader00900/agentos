#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/**
 * MCP Supersearch Server (FR-4.x)
 * Text (ripgrep/builtin), symbols (ast-grep), git history — all local.
 */
export declare function createSupersearchServer(cwd?: string): McpServer;
