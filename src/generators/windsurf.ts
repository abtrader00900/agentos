import type { AgentConfig } from "../core/schema.js";
import { rulesForHarness } from "../core/schema.js";
import type { GeneratedFile, HarnessGenerator } from "./types.js";

/**
 * Windsurf target (FR-1.8): .windsurf/rules/*.md
 * Windsurf loads markdown rules from .windsurf/rules/.
 */
export const windsurfGenerator: HarnessGenerator = {
  harness: "windsurf",
  generate(config: AgentConfig): GeneratedFile[] {
    const rules = rulesForHarness(config, "windsurf");
    const lines: string[] = [
      "---",
      "trigger: always_on",
      `description: AgentOS rules — ${config.project.name}`,
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
      for (const r of rules) lines.push(`- **${r.id}:** ${r.text}`);
      lines.push("");
    }
    lines.push(
      "## Local Tools (AgentOS)",
      "",
      "Deterministic tools are available via MCP — prefer them over guessing:",
      "- `memory` — store/recall project facts",
      "- `supersearch` — text/symbol/git-history search",
      "- `codegraph` — dependency graph + change impact",
      "",
    );
    return [{ path: ".windsurf/rules/agentos.md", content: lines.join("\n") }];
  },
};
