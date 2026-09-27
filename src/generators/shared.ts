import type { AgentConfig, HarnessName } from "../core/schema.js";
import { rulesForHarness } from "../core/schema.js";

/** A YAML double-quoted scalar (JSON strings are valid YAML): "my: app" must not break frontmatter. */
export const yamlString = (s: string) => JSON.stringify(s);

// the question each tool answers: agents only reach for a tool when told when to use it (bench/RESULTS.md).
// Every word lands in every session — keep these short.
const TOOL_DESCRIPTIONS: Record<string, string> = {
  memory: "why/how this project does things, conventions, commands, past decisions: call `memory_recall` first",
  supersearch: "symbol definitions, git history, blame (plain text search: your built-in Grep)",
  codegraph: "what breaks if X changes, who uses X: `codegraph_impact`",
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
      "Use these MCP tools instead of guessing:",
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
