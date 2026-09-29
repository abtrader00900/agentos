import { z } from "zod";
/**
 * agent.config.yaml — single source of truth for all harness configs.
 * FR-1.1, FR-1.7: schema validated on every command.
 */
export const ruleSchema = z.object({
    /** Short rule id, e.g. "no-any" */
    id: z.string().min(1),
    /** The rule text injected into harness configs */
    text: z.string().min(1),
    /** Which harnesses receive this rule. Default: all */
    harnesses: z.array(z.enum(["claude-code", "codex", "antigravity", "cursor", "windsurf"])).optional(),
    /** Glob patterns this rule applies to (informational for now) */
    files: z.array(z.string()).optional(),
});
export const skillRefSchema = z.object({
    name: z.string().min(1),
    /** local path or git url */
    source: z.string().optional(),
});
export const mcpServerRefSchema = z.object({
    name: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).optional(),
});
export const agentConfigSchema = z.object({
    /** Project display name */
    project: z.object({
        name: z.string().min(1),
        description: z.string().optional(),
    }),
    /** Project stack, e.g. ["laravel", "react", "sqlite"] */
    stack: z.array(z.string()).default([]),
    /** Behavioral rules merged into every harness config */
    rules: z.array(ruleSchema).default([]),
    /** Installed skills */
    skills: z.array(skillRefSchema).default([]),
    /** MCP servers to register with harnesses */
    mcpServers: z.array(mcpServerRefSchema).default([]),
    /** Community skill registry index (https URL, file:// path, or local path) */
    skillRegistry: z.string().optional(),
    /** When doctor/sync call injected context stale */
    staleAfter: z
        .object({
        /** the active handoff is older than this */
        handoffDays: z.number().positive().default(3),
        /** HEAD moved more than this many commits past the handoff's commit */
        handoffCommits: z.number().int().nonnegative().default(20),
        /** a pinned memory fact was not updated for this long */
        pinnedFactDays: z.number().positive().default(14),
    })
        .default({}),
});
export const ALL_HARNESSES = ["claude-code", "codex", "antigravity", "cursor", "windsurf"];
export function rulesForHarness(config, harness) {
    return config.rules.filter((r) => !r.harnesses || r.harnesses.includes(harness));
}
//# sourceMappingURL=schema.js.map