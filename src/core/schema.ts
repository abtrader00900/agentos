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
  harnesses: z.array(z.enum(["claude-code", "codex", "antigravity"])).optional(),
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
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type AgentRule = z.infer<typeof ruleSchema>;
export type HarnessName = "claude-code" | "codex" | "antigravity";

export const ALL_HARNESSES: HarnessName[] = ["claude-code", "codex", "antigravity"];

export function rulesForHarness(config: AgentConfig, harness: HarnessName): AgentRule[] {
  return config.rules.filter((r) => !r.harnesses || r.harnesses.includes(harness));
}
