import type { AgentConfig } from "../core/schema.js";
import type { GeneratedFile, HarnessGenerator } from "./types.js";
import { mcpServersJson, ruleBody, yamlString } from "./shared.js";

/**
 * Antigravity (FR-1.4).
 * Rules: .agents/rules/*.md — frontmatter is required and `trigger: always_on`
 * puts the rule in every turn (https://antigravity.google/docs/rules).
 * MCP:   .agents/mcp_config.json, same { mcpServers } shape as Claude Code
 *        (https://antigravity.google/docs/mcp).
 */
export const antigravityGenerator: HarnessGenerator = {
  harness: "antigravity",
  generate(config: AgentConfig): GeneratedFile[] {
    const lines = [
      "---",
      "trigger: always_on",
      `description: ${yamlString(`AgentOS rules — ${config.project.name}`)}`,
      "---",
      "",
      ...ruleBody(config, "antigravity"),
    ];
    return [
      { path: ".agents/rules/agentos.md", content: lines.join("\n") },
      { path: ".agents/mcp_config.json", content: mcpServersJson(config) },
    ];
  },
};
