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
    skillRegistry?: string | undefined;
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
}>;
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type AgentRule = z.infer<typeof ruleSchema>;
export type HarnessName = "claude-code" | "codex" | "antigravity" | "cursor" | "windsurf";
export declare const ALL_HARNESSES: HarnessName[];
export declare function rulesForHarness(config: AgentConfig, harness: HarnessName): AgentRule[];
