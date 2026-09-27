import { ruleBody, yamlString } from "./shared.js";
/**
 * Windsurf target (FR-1.8): .windsurf/rules/*.md with `trigger: always_on`
 * (without frontmatter a rule is manual-only). Windsurf has no project-level
 * MCP file — servers are registered in its global mcp_config.json — so the
 * rule says so instead of promising tools that may not be there.
 */
export const windsurfGenerator = {
    harness: "windsurf",
    generate(config) {
        const lines = [
            "---",
            "trigger: always_on",
            `description: ${yamlString(`AgentOS rules — ${config.project.name}`)}`,
            "---",
            "",
            ...ruleBody(config, "windsurf", "_Windsurf reads MCP servers only from its global `mcp_config.json`: add these servers there " +
                "(same command/args as .mcp.json in this project) for the tools to be available._"),
        ];
        return [{ path: ".windsurf/rules/agentos.md", content: lines.join("\n") }];
    },
};
//# sourceMappingURL=windsurf.js.map