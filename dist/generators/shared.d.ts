import type { AgentConfig, HarnessName } from "../core/schema.js";
/** A YAML double-quoted scalar (JSON strings are valid YAML): "my: app" must not break frontmatter. */
export declare const yamlString: (s: string) => string;
/** The body shared by every rule file: title, description, stack, rules, and the MCP tools actually configured. */
export declare function ruleBody(config: AgentConfig, harness: HarnessName, toolsNote?: string): string[];
/** { mcpServers: { name: { command, args, env? } } } — the shape Claude Code, Cursor and Antigravity read. */
export declare function mcpServersJson(config: AgentConfig): string;
