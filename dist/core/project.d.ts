/**
 * Where the project lives, for MCP servers a harness may start from anywhere:
 * AGENTOS_PROJECT (when it names an existing directory) wins, then the nearest
 * ancestor of `from` that holds an agent.config.yaml or a project .agentos/
 * directory, then `from` itself.
 *
 * ~/.agentos is the GLOBAL config directory, not a project marker — treating it
 * as one made every MCP server launched outside a project index the whole home.
 * The real home is excluded as well as the passed one, because `from` is often a
 * temp directory that lives *under* the home: walking out of it must not land on
 * the global directory just because this call was given a different home.
 */
export declare function projectRoot(from?: string, home?: string): string;
