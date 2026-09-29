import type { AgentConfig, HarnessName } from "../core/schema.js";
/** A YAML double-quoted scalar (JSON strings are valid YAML): "my: app" must not break frontmatter. */
export declare const yamlString: (s: string) => string;
/** The body shared by every rule file: title, description, stack, rules, and the MCP tools actually configured. */
export declare function ruleBody(config: AgentConfig, harness: HarnessName, toolsNote?: string): string[];
/**
 * config.mcpServers with agentos's own package pinned to the CLI that generates the file.
 * npx caches by spec: an unversioned (= @latest) `npx -y @basit0090/agent-os` kept running
 * whichever version it fetched first — 0.2.0 long after 0.2.1 shipped. Other servers, and an
 * explicit version in agent.config.yaml, are written as they are.
 */
export declare function mcpServers(config: AgentConfig): AgentConfig["mcpServers"];
/** { mcpServers: { name: { command, args, env? } } } — the shape Claude Code, Cursor and Antigravity read. */
export declare function mcpServersJson(config: AgentConfig): string;
