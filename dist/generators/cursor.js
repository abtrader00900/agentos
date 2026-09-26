import { rulesForHarness } from "../core/schema.js";
/**
 * Cursor target (FR-1.8): .cursor/rules/*.mdc
 * Cursor loads rule files from .cursor/rules/; .mdc supports frontmatter
 * (description, globs, alwaysApply).
 */
export const cursorGenerator = {
    harness: "cursor",
    generate(config) {
        const rules = rulesForHarness(config, "cursor");
        const lines = [
            "---",
            `description: AgentOS rules — ${config.project.name}`,
            "alwaysApply: true",
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
            for (const r of rules)
                lines.push(`- **${r.id}:** ${r.text}`);
            lines.push("");
        }
        lines.push("## Local Tools (AgentOS)", "", "Deterministic tools are available via MCP — prefer them over guessing:", "- `memory` — store/recall project facts", "- `supersearch` — text/symbol/git-history search", "- `codegraph` — dependency graph + change impact", "");
        return [{ path: ".cursor/rules/agentos.mdc", content: lines.join("\n") }];
    },
};
//# sourceMappingURL=cursor.js.map