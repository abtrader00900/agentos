import { z } from "zod";
/**
 * agent.config.yaml — single source of truth for all harness configs.
 * FR-1.1, FR-1.7: schema validated on every command.
 */
export declare const ruleSchema: z.ZodObject<{
    /** Short rule id, e.g. "no-any" */
    id: z.ZodString;
    /** The rule text injected into harness configs */
    text: z.ZodString;
    /** Which harnesses receive this rule. Default: all */
    harnesses: z.ZodOptional<z.ZodArray<z.ZodEnum<["claude-code", "codex", "antigravity", "cursor", "windsurf"]>, "many">>;
    /** Glob patterns this rule applies to (informational for now) */
    files: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    id: string;
    text: string;
    harnesses?: ("claude-code" | "codex" | "antigravity" | "cursor" | "windsurf")[] | undefined;
    files?: string[] | undefined;
}, {
    id: string;
    text: string;
    harnesses?: ("claude-code" | "codex" | "antigravity" | "cursor" | "windsurf")[] | undefined;
    files?: string[] | undefined;
}>;
export declare const skillRefSchema: z.ZodObject<{
    name: z.ZodString;
    /** local path or git url */
    source: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    source?: string | undefined;
}, {
    name: string;
    source?: string | undefined;
}>;
export declare const mcpServerRefSchema: z.ZodObject<{
    name: z.ZodString;
    command: z.ZodString;
    args: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string> | undefined;
}, {
    name: string;
    command: string;
    args?: string[] | undefined;
    env?: Record<string, string> | undefined;
}>;
export declare const agentNameSchema: z.ZodEnum<["claude", "codex"]>;
export type AgentName = z.infer<typeof agentNameSchema>;
/** `agentos run`: plan → parallel workers → verify + cross-model review → PR (PRD 1) */
export declare const orchestratorSchema: z.ZodObject<{
    /** how far a run may go on its own; merge/deploy come in a later release */
    autonomy: z.ZodEffects<z.ZodDefault<z.ZodEnum<["pr", "merge", "deploy"]>>, "pr", "pr" | "merge" | "deploy" | undefined>;
    maxWorkers: z.ZodDefault<z.ZodNumber>;
    maxFixRounds: z.ZodDefault<z.ZodNumber>;
    /** the whole run, per engine session */
    maxMinutes: z.ZodDefault<z.ZodNumber>;
    /** one agent call */
    subtaskMinutes: z.ZodDefault<z.ZodNumber>;
    planner: z.ZodDefault<z.ZodEnum<["claude", "codex"]>>;
    workers: z.ZodDefault<z.ZodArray<z.ZodEnum<["claude", "codex"]>, "many">>;
    /** reviews the diff; swapped for the other CLI when it wrote every subtask */
    reviewer: z.ZodDefault<z.ZodEnum<["claude", "codex"]>>;
    /** shell commands that must pass before a PR opens, run in the run worktree */
    verify: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** shell commands run in the run worktree right before the PR, e.g. to refresh committed build output */
    build: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** a second worker only starts while this much memory is free */
    minFreeMemoryMb: z.ZodDefault<z.ZodNumber>;
    /** folders linked from the checkout into each worktree (installed deps the verify commands need) */
    link: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** per-CLI model, overriding the CLI's own default (which may be unsupported); lands on a Windows command line, so plain names only */
    models: z.ZodDefault<z.ZodObject<{
        claude: z.ZodOptional<z.ZodString>;
        codex: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        codex?: string | undefined;
        claude?: string | undefined;
    }, {
        codex?: string | undefined;
        claude?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    autonomy: "pr";
    maxWorkers: number;
    maxFixRounds: number;
    maxMinutes: number;
    subtaskMinutes: number;
    planner: "codex" | "claude";
    workers: ("codex" | "claude")[];
    reviewer: "codex" | "claude";
    verify: string[];
    build: string[];
    minFreeMemoryMb: number;
    link: string[];
    models: {
        codex?: string | undefined;
        claude?: string | undefined;
    };
}, {
    autonomy?: "pr" | "merge" | "deploy" | undefined;
    maxWorkers?: number | undefined;
    maxFixRounds?: number | undefined;
    maxMinutes?: number | undefined;
    subtaskMinutes?: number | undefined;
    planner?: "codex" | "claude" | undefined;
    workers?: ("codex" | "claude")[] | undefined;
    reviewer?: "codex" | "claude" | undefined;
    verify?: string[] | undefined;
    build?: string[] | undefined;
    minFreeMemoryMb?: number | undefined;
    link?: string[] | undefined;
    models?: {
        codex?: string | undefined;
        claude?: string | undefined;
    } | undefined;
}>;
export type OrchestratorConfig = z.infer<typeof orchestratorSchema>;
/** learning from runs (PRD 2): lessons fed into later runs, skill drafts after repeated success */
export declare const learningSchema: z.ZodObject<{
    /** a read-only agent writes lessons after each run; false = no lessons */
    retro: z.ZodDefault<z.ZodBoolean>;
    retroAgent: z.ZodDefault<z.ZodEnum<["claude", "codex"]>>;
    /** lessons added to each planner/worker/reviewer/fixer prompt */
    maxLessonsInPrompt: z.ZodDefault<z.ZodNumber>;
    /** successful runs of one task kind before a skill is drafted */
    skillAfterRuns: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    retro: boolean;
    retroAgent: "codex" | "claude";
    maxLessonsInPrompt: number;
    skillAfterRuns: number;
}, {
    retro?: boolean | undefined;
    retroAgent?: "codex" | "claude" | undefined;
    maxLessonsInPrompt?: number | undefined;
    skillAfterRuns?: number | undefined;
}>;
export type LearningConfig = z.infer<typeof learningSchema>;
export declare const agentConfigSchema: z.ZodObject<{
    /** Project display name */
    project: z.ZodObject<{
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description?: string | undefined;
    }, {
        name: string;
        description?: string | undefined;
    }>;
    /** Project stack, e.g. ["laravel", "react", "sqlite"] */
    stack: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** Behavioral rules merged into every harness config */
    rules: z.ZodDefault<z.ZodArray<z.ZodObject<{
        /** Short rule id, e.g. "no-any" */
        id: z.ZodString;
        /** The rule text injected into harness configs */
        text: z.ZodString;
        /** Which harnesses receive this rule. Default: all */
        harnesses: z.ZodOptional<z.ZodArray<z.ZodEnum<["claude-code", "codex", "antigravity", "cursor", "windsurf"]>, "many">>;
        /** Glob patterns this rule applies to (informational for now) */
        files: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        text: string;
        harnesses?: ("claude-code" | "codex" | "antigravity" | "cursor" | "windsurf")[] | undefined;
        files?: string[] | undefined;
    }, {
        id: string;
        text: string;
        harnesses?: ("claude-code" | "codex" | "antigravity" | "cursor" | "windsurf")[] | undefined;
        files?: string[] | undefined;
    }>, "many">>;
    /** Installed skills */
    skills: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        /** local path or git url */
        source: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        source?: string | undefined;
    }, {
        name: string;
        source?: string | undefined;
    }>, "many">>;
    /** MCP servers to register with harnesses */
    mcpServers: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        command: z.ZodString;
        args: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        command: string;
        args: string[];
        env?: Record<string, string> | undefined;
    }, {
        name: string;
        command: string;
        args?: string[] | undefined;
        env?: Record<string, string> | undefined;
    }>, "many">>;
    /** Community skill registry index (https URL, file:// path, or local path) */
    skillRegistry: z.ZodOptional<z.ZodString>;
    /** When doctor/sync call injected context stale */
    staleAfter: z.ZodDefault<z.ZodObject<{
        /** the active handoff is older than this */
        handoffDays: z.ZodDefault<z.ZodNumber>;
        /** HEAD moved more than this many commits past the handoff's commit */
        handoffCommits: z.ZodDefault<z.ZodNumber>;
        /** a pinned memory fact was not updated for this long */
        pinnedFactDays: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        handoffDays: number;
        handoffCommits: number;
        pinnedFactDays: number;
    }, {
        handoffDays?: number | undefined;
        handoffCommits?: number | undefined;
        pinnedFactDays?: number | undefined;
    }>>;
    /** agentos run — absent means the command explains how to add it */
    orchestrator: z.ZodOptional<z.ZodObject<{
        /** how far a run may go on its own; merge/deploy come in a later release */
        autonomy: z.ZodEffects<z.ZodDefault<z.ZodEnum<["pr", "merge", "deploy"]>>, "pr", "pr" | "merge" | "deploy" | undefined>;
        maxWorkers: z.ZodDefault<z.ZodNumber>;
        maxFixRounds: z.ZodDefault<z.ZodNumber>;
        /** the whole run, per engine session */
        maxMinutes: z.ZodDefault<z.ZodNumber>;
        /** one agent call */
        subtaskMinutes: z.ZodDefault<z.ZodNumber>;
        planner: z.ZodDefault<z.ZodEnum<["claude", "codex"]>>;
        workers: z.ZodDefault<z.ZodArray<z.ZodEnum<["claude", "codex"]>, "many">>;
        /** reviews the diff; swapped for the other CLI when it wrote every subtask */
        reviewer: z.ZodDefault<z.ZodEnum<["claude", "codex"]>>;
        /** shell commands that must pass before a PR opens, run in the run worktree */
        verify: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** shell commands run in the run worktree right before the PR, e.g. to refresh committed build output */
        build: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** a second worker only starts while this much memory is free */
        minFreeMemoryMb: z.ZodDefault<z.ZodNumber>;
        /** folders linked from the checkout into each worktree (installed deps the verify commands need) */
        link: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** per-CLI model, overriding the CLI's own default (which may be unsupported); lands on a Windows command line, so plain names only */
        models: z.ZodDefault<z.ZodObject<{
            claude: z.ZodOptional<z.ZodString>;
            codex: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            codex?: string | undefined;
            claude?: string | undefined;
        }, {
            codex?: string | undefined;
            claude?: string | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        autonomy: "pr";
        maxWorkers: number;
        maxFixRounds: number;
        maxMinutes: number;
        subtaskMinutes: number;
        planner: "codex" | "claude";
        workers: ("codex" | "claude")[];
        reviewer: "codex" | "claude";
        verify: string[];
        build: string[];
        minFreeMemoryMb: number;
        link: string[];
        models: {
            codex?: string | undefined;
            claude?: string | undefined;
        };
    }, {
        autonomy?: "pr" | "merge" | "deploy" | undefined;
        maxWorkers?: number | undefined;
        maxFixRounds?: number | undefined;
        maxMinutes?: number | undefined;
        subtaskMinutes?: number | undefined;
        planner?: "codex" | "claude" | undefined;
        workers?: ("codex" | "claude")[] | undefined;
        reviewer?: "codex" | "claude" | undefined;
        verify?: string[] | undefined;
        build?: string[] | undefined;
        minFreeMemoryMb?: number | undefined;
        link?: string[] | undefined;
        models?: {
            codex?: string | undefined;
            claude?: string | undefined;
        } | undefined;
    }>>;
    /** learning from agentos runs — defaults apply whenever `orchestrator` is set */
    learning: z.ZodOptional<z.ZodObject<{
        /** a read-only agent writes lessons after each run; false = no lessons */
        retro: z.ZodDefault<z.ZodBoolean>;
        retroAgent: z.ZodDefault<z.ZodEnum<["claude", "codex"]>>;
        /** lessons added to each planner/worker/reviewer/fixer prompt */
        maxLessonsInPrompt: z.ZodDefault<z.ZodNumber>;
        /** successful runs of one task kind before a skill is drafted */
        skillAfterRuns: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        retro: boolean;
        retroAgent: "codex" | "claude";
        maxLessonsInPrompt: number;
        skillAfterRuns: number;
    }, {
        retro?: boolean | undefined;
        retroAgent?: "codex" | "claude" | undefined;
        maxLessonsInPrompt?: number | undefined;
        skillAfterRuns?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    project: {
        name: string;
        description?: string | undefined;
    };
    stack: string[];
    rules: {
        id: string;
        text: string;
        harnesses?: ("claude-code" | "codex" | "antigravity" | "cursor" | "windsurf")[] | undefined;
        files?: string[] | undefined;
    }[];
    skills: {
        name: string;
        source?: string | undefined;
    }[];
    mcpServers: {
        name: string;
        command: string;
        args: string[];
        env?: Record<string, string> | undefined;
    }[];
    staleAfter: {
        handoffDays: number;
        handoffCommits: number;
        pinnedFactDays: number;
    };
    skillRegistry?: string | undefined;
    orchestrator?: {
        autonomy: "pr";
        maxWorkers: number;
        maxFixRounds: number;
        maxMinutes: number;
        subtaskMinutes: number;
        planner: "codex" | "claude";
        workers: ("codex" | "claude")[];
        reviewer: "codex" | "claude";
        verify: string[];
        build: string[];
        minFreeMemoryMb: number;
        link: string[];
        models: {
            codex?: string | undefined;
            claude?: string | undefined;
        };
    } | undefined;
    learning?: {
        retro: boolean;
        retroAgent: "codex" | "claude";
        maxLessonsInPrompt: number;
        skillAfterRuns: number;
    } | undefined;
}, {
    project: {
        name: string;
        description?: string | undefined;
    };
    stack?: string[] | undefined;
    rules?: {
        id: string;
        text: string;
        harnesses?: ("claude-code" | "codex" | "antigravity" | "cursor" | "windsurf")[] | undefined;
        files?: string[] | undefined;
    }[] | undefined;
    skills?: {
        name: string;
        source?: string | undefined;
    }[] | undefined;
    mcpServers?: {
        name: string;
        command: string;
        args?: string[] | undefined;
        env?: Record<string, string> | undefined;
    }[] | undefined;
    skillRegistry?: string | undefined;
    staleAfter?: {
        handoffDays?: number | undefined;
        handoffCommits?: number | undefined;
        pinnedFactDays?: number | undefined;
    } | undefined;
    orchestrator?: {
        autonomy?: "pr" | "merge" | "deploy" | undefined;
        maxWorkers?: number | undefined;
        maxFixRounds?: number | undefined;
        maxMinutes?: number | undefined;
        subtaskMinutes?: number | undefined;
        planner?: "codex" | "claude" | undefined;
        workers?: ("codex" | "claude")[] | undefined;
        reviewer?: "codex" | "claude" | undefined;
        verify?: string[] | undefined;
        build?: string[] | undefined;
        minFreeMemoryMb?: number | undefined;
        link?: string[] | undefined;
        models?: {
            codex?: string | undefined;
            claude?: string | undefined;
        } | undefined;
    } | undefined;
    learning?: {
        retro?: boolean | undefined;
        retroAgent?: "codex" | "claude" | undefined;
        maxLessonsInPrompt?: number | undefined;
        skillAfterRuns?: number | undefined;
    } | undefined;
}>;
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type AgentRule = z.infer<typeof ruleSchema>;
export type HarnessName = "claude-code" | "codex" | "antigravity" | "cursor" | "windsurf";
export declare const ALL_HARNESSES: HarnessName[];
export declare function rulesForHarness(config: AgentConfig, harness: HarnessName): AgentRule[];
