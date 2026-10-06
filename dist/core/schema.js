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
export const agentNameSchema = z.enum(["claude", "codex"]);
const modelNameSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/, "model names are letters, digits and . _ : - (at most 64)");
/** a path or size rule that marks a PR for the owner's attention (flag) or stops it before it opens (block) */
export const riskRuleSchema = z
    .object({
    name: z.string().min(1),
    action: z.enum(["flag", "block"]),
    paths: z.array(z.string().min(1)).min(1).optional(),
    deletedLines: z.number().int().positive().optional(),
})
    .strict()
    .refine((r) => (r.paths !== undefined) !== (r.deletedLines !== undefined), { message: "a risk rule needs exactly one of paths or deletedLines" });
/** the agents a config puts to work, in order, deduped — the default for `agents` */
const roleAgents = (o) => [...new Set([o.planner, ...o.workers, o.reviewer])];
/** `agentos run`: plan → parallel workers → verify + cross-model review → PR (PRD 1) */
export const orchestratorSchema = z.object({
    /** how far a run may go on its own; merge/deploy come in a later release */
    autonomy: z
        .enum(["pr", "merge", "deploy"])
        .default("pr")
        .refine((a) => a === "pr", { message: "only autonomy: pr is available in this version (merge and deploy come in a later release)" }),
    maxWorkers: z.number().int().min(1).max(8).default(2),
    maxFixRounds: z.number().int().min(0).max(10).default(3),
    /** the whole run, per engine session */
    maxMinutes: z.number().positive().default(90),
    /** one agent call */
    subtaskMinutes: z.number().positive().default(20),
    planner: agentNameSchema.default("claude"),
    workers: z.array(agentNameSchema).min(1).default(["claude", "codex"]),
    /** reviews the diff; swapped for an agent that wrote none of it when it wrote every subtask */
    reviewer: agentNameSchema.default("codex"),
    /** the hard boundary of this project: no fallback ever calls an agent outside it */
    agents: z.array(agentNameSchema).min(1).optional(),
    /** how long an agent counts as limited when its CLI names no wait */
    quotaCooldownMinutes: z.number().positive().default(60),
    /** shell commands that must pass before a PR opens, run in the run worktree */
    verify: z.array(z.string().min(1)).default([]),
    /** shell commands run in the run worktree right before the PR, e.g. to refresh committed build output */
    build: z.array(z.string().min(1)).default([]),
    /** a second worker only starts while this much memory is free */
    minFreeMemoryMb: z.number().nonnegative().default(1500),
    /** folders linked from the checkout into each worktree (installed deps the verify commands need) */
    link: z.array(z.string().min(1)).default(["node_modules"]),
    /** per-CLI model, overriding the CLI's own default (which may be unsupported); lands on a Windows command line, so plain names only */
    models: z
        .object({ claude: modelNameSchema.optional(), codex: modelNameSchema.optional() })
        .strict()
        .default({}),
    /** replaces the built-in risk rules (all "flag") when given */
    risk: z.array(riskRuleSchema).optional(),
})
    // a .default() cannot read sibling fields, so the allowlist is filled here instead
    .transform((o) => ({ ...o, agents: o.agents ?? roleAgents(o) }))
    .superRefine((o, ctx) => {
    const missing = roleAgents(o).filter((a) => !o.agents.includes(a));
    if (missing.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["agents"], message: `agents must contain planner, workers and reviewer (missing: ${missing.join(", ")})` });
    }
});
/** learning from runs (PRD 2): lessons fed into later runs, skill drafts after repeated success */
export const learningSchema = z.object({
    /** a read-only agent writes lessons after each run; false = no lessons */
    retro: z.boolean().default(true),
    retroAgent: agentNameSchema.default("claude"),
    /** lessons added to each planner/worker/reviewer/fixer prompt */
    maxLessonsInPrompt: z.number().int().min(0).max(20).default(5),
    /** successful runs of one task kind before a skill is drafted */
    skillAfterRuns: z.number().int().min(2).max(20).default(3),
});
/** agentos daemon (PRD 4): what the daemon may do in this project; off unless enabled */
export const daemonScheduleSchema = z.object({
    /** 5-field cron, local time, e.g. "0 2 * * *" (checked by the daemon and doctor) */
    cron: z.string().min(1),
    task: z.string().min(3).max(2000),
    quick: z.boolean().default(false),
});
export const daemonSchema = z.object({
    enabled: z.boolean().default(false),
    /** watch this project's agentos/run-* PRs and fix failed CI on the same branch */
    ciFix: z.boolean().default(false),
    schedules: z.array(daemonScheduleSchema).default([]),
});
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
/** the optional local decider (PRD 4.5b): a yes/no model on this machine; nothing is sent elsewhere */
export const deciderSchema = z
    .object({
    autoQuick: z.boolean().default(true),
    contentRisk: z.boolean().default(true),
    quickAbove: z.number().min(0).max(1).default(0.8),
    riskAbove: z.number().min(0).max(1).default(0.6),
    url: z
        .string()
        .url()
        .default("http://127.0.0.1:8017")
        .refine((u) => LOOPBACK.has(new URL(u).hostname), { message: "decider.url must be a loopback address (127.0.0.1, localhost or [::1]): tasks and diffs never leave this machine" }),
})
    .strict();
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
    /** agentos run — absent means the command explains how to add it */
    orchestrator: orchestratorSchema.optional(),
    /** learning from agentos runs — defaults apply whenever `orchestrator` is set */
    learning: learningSchema.optional(),
    /** agentos daemon — absent means the daemon ignores this project */
    daemon: daemonSchema.optional(),
    /** local decider (jevos) — absent means defaults; it does nothing unless a decider is running */
    decider: deciderSchema.optional(),
});
export const ALL_HARNESSES = ["claude-code", "codex", "antigravity", "cursor", "windsurf"];
export function rulesForHarness(config, harness) {
    return config.rules.filter((r) => !r.harnesses || r.harnesses.includes(harness));
}
//# sourceMappingURL=schema.js.map