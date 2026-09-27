/**
 * Published npm name. The generated config runs the MCP servers through
 * `npx -y <PKG>`, so this must match package.json exactly -- "agentos" is an
 * unrelated placeholder package owned by someone else on the public registry.
 */
export declare const PKG = "@basit0090/agent-os";
export declare function init(options?: {
    cwd?: string;
    force?: boolean;
}): void;
