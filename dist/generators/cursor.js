import { mcpServersJson, ruleBody, yamlString } from "./shared.js";
/**
 * Cursor target (FR-1.8): .cursor/rules/*.mdc + .cursor/mcp.json.
 * Cursor loads rule files from .cursor/rules/ (.mdc frontmatter: description,
 * globs, alwaysApply) and project MCP servers from .cursor/mcp.json
 * (https://cursor.com/docs/context/mcp) — without it the rule's "Local Tools"
 * would point at tools Cursor never started.
 */
export const cursorGenerator = {
    harness: "cursor",
    generate(config) {
        const lines = [
            "---",
            `description: ${yamlString(`AgentOS rules — ${config.project.name}`)}`,
            "alwaysApply: true",
            "---",
            "",
            ...ruleBody(config, "cursor"),
        ];
        const files = [{ path: ".cursor/rules/agentos.mdc", content: lines.join("\n") }];
        if (config.mcpServers.length)
            files.push({ path: ".cursor/mcp.json", content: mcpServersJson(config) });
        return files;
    },
};
//# sourceMappingURL=cursor.js.map