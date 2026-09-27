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
    /** <cwd>/agent.config.yaml exists — sync/install refuse to generate files without one */
    hasProject: boolean;
    /** mcpServers whose env comes from the personal, gitignored layer (it lands in committed files) */
    localMcpEnv: string[];
}
export declare function loadConfig(cwd?: string, home?: string): LoadedConfig;
