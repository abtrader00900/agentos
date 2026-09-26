/**
 * Where the project lives, for MCP servers a harness may start from anywhere:
 * AGENTOS_PROJECT wins, then the nearest ancestor of `from` that holds an
 * agent.config.yaml (or an .agentos/ directory), then `from` itself.
 */
export declare function projectRoot(from?: string): string;
