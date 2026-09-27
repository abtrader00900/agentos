import type { HarnessGenerator } from "./types.js";
/**
 * Antigravity (FR-1.4).
 * Rules: .agents/rules/*.md — frontmatter is required and `trigger: always_on`
 * puts the rule in every turn (https://antigravity.google/docs/rules).
 * MCP:   .agents/mcp_config.json, same { mcpServers } shape as Claude Code
 *        (https://antigravity.google/docs/mcp).
 */
export declare const antigravityGenerator: HarnessGenerator;
