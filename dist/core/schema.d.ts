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
/** a path or size rule that marks a PR for the owner's attention (flag) or stops it before it opens (block) */
export declare const riskRuleSchema: z.ZodEffects<z.ZodObject<{
    name: z.ZodString;
    action: z.ZodEnum<["flag", "block"]>;
    paths: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    deletedLines: z.ZodOptional<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    name: string;
    action: "flag" | "block";
    paths?: string[] | undefined;
    deletedLines?: number | undefined;
}, {
    name: string;
    action: "flag" | "block";
    paths?: string[] | undefined;
    deletedLines?: number | undefined;
}>, {
    name: string;
    action: "flag" | "block";
    paths?: string[] | undefined;
    deletedLines?: number | undefined;
}, {
    name: string;
    action: "flag" | "block";
    paths?: string[] | undefined;
    deletedLines?: number | undefined;
}>;
/** `agentos run`: plan → parallel workers → verify + cross-model review → PR (PRD 1) */
export declare const orchestratorSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
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
    /** reviews the diff; swapped for an agent that wrote none of it when it wrote every subtask */
    reviewer: z.ZodDefault<z.ZodEnum<["claude", "codex"]>>;
    /** the hard boundary of this project: no fallback ever calls an agent outside it */
    agents: z.ZodOptional<z.ZodArray<z.ZodEnum<["claude", "codex"]>, "many">>;
    /** how long an agent counts as limited when its CLI names no wait */
    quotaCooldownMinutes: z.ZodDefault<z.ZodNumber>;
    /** shell commands that must pass before a PR opens, run in the run worktree */
    verify: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** shell commands run in the run worktree right before the PR, e.g. to refresh committed build output */
    build: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** a second worker only starts while this much memory is free */
    minFreeMemoryMb: z.ZodDefault<z.ZodNumber>;
    /** folders linked from the checkout into each worktree (installed deps the verify commands need) */
    link: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** per-CLI model, overriding the CLI's own default (which may be unsupported); every name lands on a Windows command line, so plain names only */
    models: z.ZodDefault<z.ZodObject<{
        claude: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            read: z.ZodOptional<z.ZodString>;
            write: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            read?: string | undefined;
            write?: string | undefined;
        }, {
            read?: string | undefined;
            write?: string | undefined;
        }>]>>;
        codex: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            read: z.ZodOptional<z.ZodString>;
            write: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            read?: string | undefined;
            write?: string | undefined;
        }, {
            read?: string | undefined;
            write?: string | undefined;
        }>]>>;
    }, "strict", z.ZodTypeAny, {
        codex?: string | {
            read?: string | undefined;
            write?: string | undefined;
        } | undefined;
        claude?: string | {
            read?: string | undefined;
            write?: string | undefined;
        } | undefined;
    }, {
        codex?: string | {
            read?: string | undefined;
            write?: string | undefined;
        } | undefined;
        claude?: string | {
            read?: string | undefined;
            write?: string | undefined;
        } | undefined;
    }>>;
    /** replaces the built-in risk rules (all "flag") when given */
    risk: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodObject<{
        name: z.ZodString;
        action: z.ZodEnum<["flag", "block"]>;
        paths: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        deletedLines: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        name: string;
        action: "flag" | "block";
        paths?: string[] | undefined;
        deletedLines?: number | undefined;
    }, {
        name: string;
        action: "flag" | "block";
        paths?: string[] | undefined;
        deletedLines?: number | undefined;
    }>, {
        name: string;
        action: "flag" | "block";
        paths?: string[] | undefined;
        deletedLines?: number | undefined;
    }, {
        name: string;
        action: "flag" | "block";
        paths?: string[] | undefined;
        deletedLines?: number | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    autonomy: "pr";
    maxWorkers: number;
    maxFixRounds: number;
    maxMinutes: number;
    subtaskMinutes: number;
    planner: "codex" | "claude";
    workers: ("codex" | "claude")[];
    reviewer: "codex" | "claude";
    quotaCooldownMinutes: number;
    verify: string[];
    build: string[];
    minFreeMemoryMb: number;
    link: string[];
    models: {
        codex?: string | {
            read?: string | undefined;
            write?: string | undefined;
        } | undefined;
        claude?: string | {
            read?: string | undefined;
            write?: string | undefined;
        } | undefined;
    };
    agents?: ("codex" | "claude")[] | undefined;
    risk?: {
        name: string;
        action: "flag" | "block";
        paths?: string[] | undefined;
        deletedLines?: number | undefined;
    }[] | undefined;
}, {
    autonomy?: "pr" | "merge" | "deploy" | undefined;
    maxWorkers?: number | undefined;
    maxFixRounds?: number | undefined;
    maxMinutes?: number | undefined;
    subtaskMinutes?: number | undefined;
    planner?: "codex" | "claude" | undefined;
    workers?: ("codex" | "claude")[] | undefined;
    reviewer?: "codex" | "claude" | undefined;
    agents?: ("codex" | "claude")[] | undefined;
    quotaCooldownMinutes?: number | undefined;
    verify?: string[] | undefined;
    build?: string[] | undefined;
    minFreeMemoryMb?: number | undefined;
    link?: string[] | undefined;
    models?: {
        codex?: string | {
            read?: string | undefined;
            write?: string | undefined;
        } | undefined;
        claude?: string | {
            read?: string | undefined;
            write?: string | undefined;
        } | undefined;
    } | undefined;
    risk?: {
        name: string;
        action: "flag" | "block";
        paths?: string[] | undefined;
        deletedLines?: number | undefined;
    }[] | undefined;
}>, {
    agents: ("codex" | "claude")[];
    autonomy: "pr";
    maxWorkers: number;
    maxFixRounds: number;
    maxMinutes: number;
    subtaskMinutes: number;
    planner: "codex" | "claude";
    workers: ("codex" | "claude")[];
    reviewer: "codex" | "claude";
    quotaCooldownMinutes: number;
    verify: string[];
    build: string[];
    minFreeMemoryMb: number;
    link: string[];
    models: {
        codex?: string | {
            read?: string | undefined;
            write?: string | undefined;
        } | undefined;
        claude?: string | {
            read?: string | undefined;
            write?: string | undefined;
        } | undefined;
    };
    risk?: {
        name: string;
        action: "flag" | "block";
        paths?: string[] | undefined;
        deletedLines?: number | undefined;
    }[] | undefined;
}, {
    autonomy?: "pr" | "merge" | "deploy" | undefined;
    maxWorkers?: number | undefined;
    maxFixRounds?: number | undefined;
    maxMinutes?: number | undefined;
    subtaskMinutes?: number | undefined;
    planner?: "codex" | "claude" | undefined;
    workers?: ("codex" | "claude")[] | undefined;
    reviewer?: "codex" | "claude" | undefined;
    agents?: ("codex" | "claude")[] | undefined;
    quotaCooldownMinutes?: number | undefined;
    verify?: string[] | undefined;
    build?: string[] | undefined;
    minFreeMemoryMb?: number | undefined;
    link?: string[] | undefined;
    models?: {
        codex?: string | {
            read?: string | undefined;
            write?: string | undefined;
        } | undefined;
        claude?: string | {
            read?: string | undefined;
            write?: string | undefined;
        } | undefined;
    } | undefined;
    risk?: {
        name: string;
        action: "flag" | "block";
        paths?: string[] | undefined;
        deletedLines?: number | undefined;
    }[] | undefined;
}>, {
    agents: ("codex" | "claude")[];
    autonomy: "pr";
    maxWorkers: number;
    maxFixRounds: number;
    maxMinutes: number;
    subtaskMinutes: number;
    planner: "codex" | "claude";
    workers: ("codex" | "claude")[];
    reviewer: "codex" | "claude";
    quotaCooldownMinutes: number;
    verify: string[];
    build: string[];
    minFreeMemoryMb: number;
    link: string[];
    models: {
        codex?: string | {
            read?: string | undefined;
            write?: string | undefined;
        } | undefined;
        claude?: string | {
            read?: string | undefined;
            write?: string | undefined;
        } | undefined;
    };
    risk?: {
        name: string;
        action: "flag" | "block";
        paths?: string[] | undefined;
        deletedLines?: number | undefined;
    }[] | undefined;
}, {
    autonomy?: "pr" | "merge" | "deploy" | undefined;
    maxWorkers?: number | undefined;
    maxFixRounds?: number | undefined;
    maxMinutes?: number | undefined;
    subtaskMinutes?: number | undefined;
    planner?: "codex" | "claude" | undefined;
    workers?: ("codex" | "claude")[] | undefined;
    reviewer?: "codex" | "claude" | undefined;
    agents?: ("codex" | "claude")[] | undefined;
    quotaCooldownMinutes?: number | undefined;
    verify?: string[] | undefined;
    build?: string[] | undefined;
    minFreeMemoryMb?: number | undefined;
    link?: string[] | undefined;
    models?: {
        codex?: string | {
            read?: string | undefined;
            write?: string | undefined;
        } | undefined;
        claude?: string | {
            read?: string | undefined;
            write?: string | undefined;
        } | undefined;
    } | undefined;
    risk?: {
        name: string;
        action: "flag" | "block";
        paths?: string[] | undefined;
        deletedLines?: number | undefined;
    }[] | undefined;
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
/** agentos daemon (PRD 4): what the daemon may do in this project; off unless enabled */
export declare const daemonScheduleSchema: z.ZodObject<{
    /** 5-field cron, local time, e.g. "0 2 * * *" (checked by the daemon and doctor) */
    cron: z.ZodString;
    task: z.ZodString;
    quick: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    cron: string;
    task: string;
    quick: boolean;
}, {
    cron: string;
    task: string;
    quick?: boolean | undefined;
}>;
export declare const daemonSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    /** watch this project's agentos/run-* PRs and fix failed CI on the same branch */
    ciFix: z.ZodDefault<z.ZodBoolean>;
    schedules: z.ZodDefault<z.ZodArray<z.ZodObject<{
        /** 5-field cron, local time, e.g. "0 2 * * *" (checked by the daemon and doctor) */
        cron: z.ZodString;
        task: z.ZodString;
        quick: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        cron: string;
        task: string;
        quick: boolean;
    }, {
        cron: string;
        task: string;
        quick?: boolean | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    enabled: boolean;
    ciFix: boolean;
    schedules: {
        cron: string;
        task: string;
        quick: boolean;
    }[];
}, {
    enabled?: boolean | undefined;
    ciFix?: boolean | undefined;
    schedules?: {
        cron: string;
        task: string;
        quick?: boolean | undefined;
    }[] | undefined;
}>;
export type DaemonConfig = z.infer<typeof daemonSchema>;
/** the optional local decider (PRD 4.5b): a yes/no model on this machine; nothing is sent elsewhere */
export declare const deciderSchema: z.ZodObject<{
    autoQuick: z.ZodDefault<z.ZodBoolean>;
    contentRisk: z.ZodDefault<z.ZodBoolean>;
    quickAbove: z.ZodDefault<z.ZodNumber>;
    riskAbove: z.ZodDefault<z.ZodNumber>;
    url: z.ZodEffects<z.ZodDefault<z.ZodString>, string, string | undefined>;
}, "strict", z.ZodTypeAny, {
    autoQuick: boolean;
    contentRisk: boolean;
    quickAbove: number;
    riskAbove: number;
    url: string;
}, {
    autoQuick?: boolean | undefined;
    contentRisk?: boolean | undefined;
    quickAbove?: number | undefined;
    riskAbove?: number | undefined;
    url?: string | undefined;
}>;
export type DeciderConfigSchema = z.infer<typeof deciderSchema>;
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
    orchestrator: z.ZodOptional<z.ZodEffects<z.ZodEffects<z.ZodObject<{
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
        /** reviews the diff; swapped for an agent that wrote none of it when it wrote every subtask */
        reviewer: z.ZodDefault<z.ZodEnum<["claude", "codex"]>>;
        /** the hard boundary of this project: no fallback ever calls an agent outside it */
        agents: z.ZodOptional<z.ZodArray<z.ZodEnum<["claude", "codex"]>, "many">>;
        /** how long an agent counts as limited when its CLI names no wait */
        quotaCooldownMinutes: z.ZodDefault<z.ZodNumber>;
        /** shell commands that must pass before a PR opens, run in the run worktree */
        verify: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** shell commands run in the run worktree right before the PR, e.g. to refresh committed build output */
        build: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** a second worker only starts while this much memory is free */
        minFreeMemoryMb: z.ZodDefault<z.ZodNumber>;
        /** folders linked from the checkout into each worktree (installed deps the verify commands need) */
        link: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** per-CLI model, overriding the CLI's own default (which may be unsupported); every name lands on a Windows command line, so plain names only */
        models: z.ZodDefault<z.ZodObject<{
            claude: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                read: z.ZodOptional<z.ZodString>;
                write: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                read?: string | undefined;
                write?: string | undefined;
            }, {
                read?: string | undefined;
                write?: string | undefined;
            }>]>>;
            codex: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                read: z.ZodOptional<z.ZodString>;
                write: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                read?: string | undefined;
                write?: string | undefined;
            }, {
                read?: string | undefined;
                write?: string | undefined;
            }>]>>;
        }, "strict", z.ZodTypeAny, {
            codex?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
            claude?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
        }, {
            codex?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
            claude?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
        }>>;
        /** replaces the built-in risk rules (all "flag") when given */
        risk: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodObject<{
            name: z.ZodString;
            action: z.ZodEnum<["flag", "block"]>;
            paths: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            deletedLines: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            name: string;
            action: "flag" | "block";
            paths?: string[] | undefined;
            deletedLines?: number | undefined;
        }, {
            name: string;
            action: "flag" | "block";
            paths?: string[] | undefined;
            deletedLines?: number | undefined;
        }>, {
            name: string;
            action: "flag" | "block";
            paths?: string[] | undefined;
            deletedLines?: number | undefined;
        }, {
            name: string;
            action: "flag" | "block";
            paths?: string[] | undefined;
            deletedLines?: number | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        autonomy: "pr";
        maxWorkers: number;
        maxFixRounds: number;
        maxMinutes: number;
        subtaskMinutes: number;
        planner: "codex" | "claude";
        workers: ("codex" | "claude")[];
        reviewer: "codex" | "claude";
        quotaCooldownMinutes: number;
        verify: string[];
        build: string[];
        minFreeMemoryMb: number;
        link: string[];
        models: {
            codex?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
            claude?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
        };
        agents?: ("codex" | "claude")[] | undefined;
        risk?: {
            name: string;
            action: "flag" | "block";
            paths?: string[] | undefined;
            deletedLines?: number | undefined;
        }[] | undefined;
    }, {
        autonomy?: "pr" | "merge" | "deploy" | undefined;
        maxWorkers?: number | undefined;
        maxFixRounds?: number | undefined;
        maxMinutes?: number | undefined;
        subtaskMinutes?: number | undefined;
        planner?: "codex" | "claude" | undefined;
        workers?: ("codex" | "claude")[] | undefined;
        reviewer?: "codex" | "claude" | undefined;
        agents?: ("codex" | "claude")[] | undefined;
        quotaCooldownMinutes?: number | undefined;
        verify?: string[] | undefined;
        build?: string[] | undefined;
        minFreeMemoryMb?: number | undefined;
        link?: string[] | undefined;
        models?: {
            codex?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
            claude?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
        } | undefined;
        risk?: {
            name: string;
            action: "flag" | "block";
            paths?: string[] | undefined;
            deletedLines?: number | undefined;
        }[] | undefined;
    }>, {
        agents: ("codex" | "claude")[];
        autonomy: "pr";
        maxWorkers: number;
        maxFixRounds: number;
        maxMinutes: number;
        subtaskMinutes: number;
        planner: "codex" | "claude";
        workers: ("codex" | "claude")[];
        reviewer: "codex" | "claude";
        quotaCooldownMinutes: number;
        verify: string[];
        build: string[];
        minFreeMemoryMb: number;
        link: string[];
        models: {
            codex?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
            claude?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
        };
        risk?: {
            name: string;
            action: "flag" | "block";
            paths?: string[] | undefined;
            deletedLines?: number | undefined;
        }[] | undefined;
    }, {
        autonomy?: "pr" | "merge" | "deploy" | undefined;
        maxWorkers?: number | undefined;
        maxFixRounds?: number | undefined;
        maxMinutes?: number | undefined;
        subtaskMinutes?: number | undefined;
        planner?: "codex" | "claude" | undefined;
        workers?: ("codex" | "claude")[] | undefined;
        reviewer?: "codex" | "claude" | undefined;
        agents?: ("codex" | "claude")[] | undefined;
        quotaCooldownMinutes?: number | undefined;
        verify?: string[] | undefined;
        build?: string[] | undefined;
        minFreeMemoryMb?: number | undefined;
        link?: string[] | undefined;
        models?: {
            codex?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
            claude?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
        } | undefined;
        risk?: {
            name: string;
            action: "flag" | "block";
            paths?: string[] | undefined;
            deletedLines?: number | undefined;
        }[] | undefined;
    }>, {
        agents: ("codex" | "claude")[];
        autonomy: "pr";
        maxWorkers: number;
        maxFixRounds: number;
        maxMinutes: number;
        subtaskMinutes: number;
        planner: "codex" | "claude";
        workers: ("codex" | "claude")[];
        reviewer: "codex" | "claude";
        quotaCooldownMinutes: number;
        verify: string[];
        build: string[];
        minFreeMemoryMb: number;
        link: string[];
        models: {
            codex?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
            claude?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
        };
        risk?: {
            name: string;
            action: "flag" | "block";
            paths?: string[] | undefined;
            deletedLines?: number | undefined;
        }[] | undefined;
    }, {
        autonomy?: "pr" | "merge" | "deploy" | undefined;
        maxWorkers?: number | undefined;
        maxFixRounds?: number | undefined;
        maxMinutes?: number | undefined;
        subtaskMinutes?: number | undefined;
        planner?: "codex" | "claude" | undefined;
        workers?: ("codex" | "claude")[] | undefined;
        reviewer?: "codex" | "claude" | undefined;
        agents?: ("codex" | "claude")[] | undefined;
        quotaCooldownMinutes?: number | undefined;
        verify?: string[] | undefined;
        build?: string[] | undefined;
        minFreeMemoryMb?: number | undefined;
        link?: string[] | undefined;
        models?: {
            codex?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
            claude?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
        } | undefined;
        risk?: {
            name: string;
            action: "flag" | "block";
            paths?: string[] | undefined;
            deletedLines?: number | undefined;
        }[] | undefined;
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
    /** agentos daemon — absent means the daemon ignores this project */
    daemon: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        /** watch this project's agentos/run-* PRs and fix failed CI on the same branch */
        ciFix: z.ZodDefault<z.ZodBoolean>;
        schedules: z.ZodDefault<z.ZodArray<z.ZodObject<{
            /** 5-field cron, local time, e.g. "0 2 * * *" (checked by the daemon and doctor) */
            cron: z.ZodString;
            task: z.ZodString;
            quick: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            cron: string;
            task: string;
            quick: boolean;
        }, {
            cron: string;
            task: string;
            quick?: boolean | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        ciFix: boolean;
        schedules: {
            cron: string;
            task: string;
            quick: boolean;
        }[];
    }, {
        enabled?: boolean | undefined;
        ciFix?: boolean | undefined;
        schedules?: {
            cron: string;
            task: string;
            quick?: boolean | undefined;
        }[] | undefined;
    }>>;
    /** local decider (jevos) — absent means defaults; it does nothing unless a decider is running */
    decider: z.ZodOptional<z.ZodObject<{
        autoQuick: z.ZodDefault<z.ZodBoolean>;
        contentRisk: z.ZodDefault<z.ZodBoolean>;
        quickAbove: z.ZodDefault<z.ZodNumber>;
        riskAbove: z.ZodDefault<z.ZodNumber>;
        url: z.ZodEffects<z.ZodDefault<z.ZodString>, string, string | undefined>;
    }, "strict", z.ZodTypeAny, {
        autoQuick: boolean;
        contentRisk: boolean;
        quickAbove: number;
        riskAbove: number;
        url: string;
    }, {
        autoQuick?: boolean | undefined;
        contentRisk?: boolean | undefined;
        quickAbove?: number | undefined;
        riskAbove?: number | undefined;
        url?: string | undefined;
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
        agents: ("codex" | "claude")[];
        autonomy: "pr";
        maxWorkers: number;
        maxFixRounds: number;
        maxMinutes: number;
        subtaskMinutes: number;
        planner: "codex" | "claude";
        workers: ("codex" | "claude")[];
        reviewer: "codex" | "claude";
        quotaCooldownMinutes: number;
        verify: string[];
        build: string[];
        minFreeMemoryMb: number;
        link: string[];
        models: {
            codex?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
            claude?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
        };
        risk?: {
            name: string;
            action: "flag" | "block";
            paths?: string[] | undefined;
            deletedLines?: number | undefined;
        }[] | undefined;
    } | undefined;
    learning?: {
        retro: boolean;
        retroAgent: "codex" | "claude";
        maxLessonsInPrompt: number;
        skillAfterRuns: number;
    } | undefined;
    daemon?: {
        enabled: boolean;
        ciFix: boolean;
        schedules: {
            cron: string;
            task: string;
            quick: boolean;
        }[];
    } | undefined;
    decider?: {
        autoQuick: boolean;
        contentRisk: boolean;
        quickAbove: number;
        riskAbove: number;
        url: string;
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
        agents?: ("codex" | "claude")[] | undefined;
        quotaCooldownMinutes?: number | undefined;
        verify?: string[] | undefined;
        build?: string[] | undefined;
        minFreeMemoryMb?: number | undefined;
        link?: string[] | undefined;
        models?: {
            codex?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
            claude?: string | {
                read?: string | undefined;
                write?: string | undefined;
            } | undefined;
        } | undefined;
        risk?: {
            name: string;
            action: "flag" | "block";
            paths?: string[] | undefined;
            deletedLines?: number | undefined;
        }[] | undefined;
    } | undefined;
    learning?: {
        retro?: boolean | undefined;
        retroAgent?: "codex" | "claude" | undefined;
        maxLessonsInPrompt?: number | undefined;
        skillAfterRuns?: number | undefined;
    } | undefined;
    daemon?: {
        enabled?: boolean | undefined;
        ciFix?: boolean | undefined;
        schedules?: {
            cron: string;
            task: string;
            quick?: boolean | undefined;
        }[] | undefined;
    } | undefined;
    decider?: {
        autoQuick?: boolean | undefined;
        contentRisk?: boolean | undefined;
        quickAbove?: number | undefined;
        riskAbove?: number | undefined;
        url?: string | undefined;
    } | undefined;
}>;
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type AgentRule = z.infer<typeof ruleSchema>;
export type HarnessName = "claude-code" | "codex" | "antigravity" | "cursor" | "windsurf";
export declare const ALL_HARNESSES: HarnessName[];
export declare function rulesForHarness(config: AgentConfig, harness: HarnessName): AgentRule[];
