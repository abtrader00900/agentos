import type { AgentConfig } from "../core/schema.js";
import { rulesForHarness } from "../core/schema.js";
import type { GeneratedFile, HarnessGenerator } from "./types.js";

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
    const rules = rulesForHarness(config, "antigravity");
    const lines: string[] = [
      "---",
      "trigger: always_on",
      `description: AgentOS rules — ${config.project.name}`,
      "---",
      "",
      `# ${config.project.name}`,
      "",
      config.project.description ?? "",
      "",
    ];
    if (config.stack.length) {
      lines.push(`**Stack:** ${config.stack.join(", ")}`, "");
    }
    if (rules.length) {
      lines.push("## Rules", "");
      for (const r of rules) lines.push(`- **${r.id}:** ${r.text}`);
      lines.push("");
    }
    lines.push(
      "## Local Tools (AgentOS)",
      "",
      "Deterministic tools are available via MCP — prefer them over guessing:",
      "- `memory` / `supersearch` / `codegraph`",
      "",
    );

    const mcp = {
      mcpServers: Object.fromEntries(
        config.mcpServers.map((s) => [s.name, { command: s.command, args: s.args, ...(s.env ? { env: s.env } : {}) }]),
      ),
    };

    return [
      { path: ".agents/rules/agentos.md", content: lines.join("\n") },
      { path: ".agents/mcp_config.json", content: JSON.stringify(mcp, null, 2) + "\n" },
    ];
  },
};
