import type { AgentConfig, HarnessName } from "../core/schema.js";
import { rulesForHarness } from "../core/schema.js";

/** A YAML double-quoted scalar (JSON strings are valid YAML): "my: app" must not break frontmatter. */
export const yamlString = (s: string) => JSON.stringify(s);

const TOOL_DESCRIPTIONS: Record<string, string> = {
  memory: "store/recall project facts (long-term memory)",
  supersearch: "text/symbol/git-history search",
  codegraph: "dependency graph + change impact",
};

/** The body shared by every rule file: title, description, stack, rules, and the MCP tools actually configured. */
export function ruleBody(config: AgentConfig, harness: HarnessName, toolsNote?: string): string[] {
  const rules = rulesForHarness(config, harness);
  const lines: string[] = [`# ${config.project.name}`, "", config.project.description ?? "", ""];
  if (config.stack.length) lines.push(`**Stack:** ${config.stack.join(", ")}`, "");
  if (rules.length) {
    lines.push("## Rules", "");
    for (const r of rules) lines.push(`- **${r.id}:** ${r.text}`);
    lines.push("");
  }
  // only advertise tools that are configured — promising MCP tools the agent cannot
  // reach sends it hunting for them
  if (config.mcpServers.length) {
    lines.push(
      "## Local Tools (AgentOS)",
      "",
      "Deterministic tools are available via MCP — prefer them over guessing:",
      ...config.mcpServers.map((s) => `- \`${s.name}\`${TOOL_DESCRIPTIONS[s.name] ? ` — ${TOOL_DESCRIPTIONS[s.name]}` : ""}`),
      "",
    );
    if (toolsNote) lines.push(toolsNote, "");
  }
  return lines;
}

/** { mcpServers: { name: { command, args, env? } } } — the shape Claude Code, Cursor and Antigravity read. */
export function mcpServersJson(config: AgentConfig): string {
  const mcp = {
    mcpServers: Object.fromEntries(
      config.mcpServers.map((s) => [s.name, { command: s.command, args: s.args, ...(s.env ? { env: s.env } : {}) }]),
    ),
  };
  return JSON.stringify(mcp, null, 2) + "\n";
}
