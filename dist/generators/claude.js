import { rulesForHarness } from "../core/schema.js";
/** CLAUDE.md + .mcp.json for Claude Code (FR-1.2) */
export const claudeGenerator = {
    harness: "claude-code",
    generate(config) {
        const rules = rulesForHarness(config, "claude-code");
        const lines = [
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
            for (const r of rules)
                lines.push(`- **${r.id}:** ${r.text}`);
            lines.push("");
        }
        if (config.skills.length) {
            lines.push("## Skills", "");
            for (const s of config.skills)
                lines.push(`- ${s.name}${s.source ? ` (${s.source})` : ""}`);
            lines.push("", "Skills live in .agentos/skills/. Read SKILL.md before applying a skill.", "");
        }
        lines.push("## Local Tools (AgentOS)", "", "Deterministic tools are available via MCP — prefer them over guessing:", "- `memory` — store/recall project facts (long-term memory)", "- `supersearch` — text/symbol/git-history search", "- `codegraph` — dependency graph + change impact", "");
        const mcp = {
            mcpServers: Object.fromEntries(config.mcpServers.map((s) => [s.name, { command: s.command, args: s.args, ...(s.env ? { env: s.env } : {}) }])),
        };
        return [
            { path: "CLAUDE.md", content: lines.join("\n") },
            { path: ".mcp.json", content: JSON.stringify(mcp, null, 2) + "\n" },
        ];
    },
};
//# sourceMappingURL=claude.js.map