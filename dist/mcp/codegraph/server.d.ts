#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/**
 * MCP Codegraph Server (FR-5.x)
 * Dependency graph + change impact analysis — deterministic, local, no model.
 */
export declare function createCodegraphServer(root?: string): McpServer;
