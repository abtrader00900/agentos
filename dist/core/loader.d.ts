import { type AgentConfig } from "./schema.js";
/**
 * FR-1.5: merges three config layers with override order local > project > global.
 *
 *   global   ~/.agentos/agent.config.yaml        (defaults, applies everywhere)
 *   project  <cwd>/agent.config.yaml             (committed to repo, shared)
 *   local    <cwd>/agent.config.local.yaml       (gitignored, personal overrides)
 */
export interface LoadedConfig {
    config: AgentConfig;
    sources: string[];
    missing: string[];
}
export declare function loadConfig(cwd?: string, home?: string): LoadedConfig;
