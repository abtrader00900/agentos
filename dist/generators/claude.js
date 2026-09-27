import { mcpServersJson, ruleBody } from "./shared.js";
/** CLAUDE.md + .mcp.json for Claude Code (FR-1.2) */
export const claudeGenerator = {
    harness: "claude-code",
    generate(config) {
        const lines = ruleBody(config, "claude-code");
        if (config.skills.length) {
            // skills go before the tools section in the original layout; keep them near the rules
            const at = lines.indexOf("## Local Tools (AgentOS)");
            const skills = [
                "## Skills",
                "",
                ...config.skills.map((s) => `- ${s.name}${s.source ? ` (${s.source})` : ""}`),
                "",
                "Skills live in .agentos/skills/. Read SKILL.md before applying a skill.",
                "",
            ];
            lines.splice(at < 0 ? lines.length : at, 0, ...skills);
        }
        return [
            { path: "CLAUDE.md", content: lines.join("\n") },
            { path: ".mcp.json", content: mcpServersJson(config) },
        ];
    },
};
//# sourceMappingURL=claude.js.map