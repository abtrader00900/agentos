import type { AgentConfig } from "../core/schema.js";
import { rulesForHarness } from "../core/schema.js";
import type { GeneratedFile, HarnessGenerator } from "./types.js";

/** .antigravity/ config for Antigravity (FR-1.4) */
export const antigravityGenerator: HarnessGenerator = {
  harness: "antigravity",
  generate(config: AgentConfig): GeneratedFile[] {
    const rules = rulesForHarness(config, "antigravity");
    const lines: string[] = [
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
      { path: ".antigravity/config.md", content: lines.join("\n") },
      { path: ".antigravity/mcp.json", content: JSON.stringify(mcp, null, 2) + "\n" },
    ];
  },
};
