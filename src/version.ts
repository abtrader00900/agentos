import { createRequire } from "node:module";

/** package.json is the only place the version lives (works from src/ via tsx and from dist/). */
const pkg = createRequire(import.meta.url)("../package.json") as { name: string; version: string };
export const VERSION = pkg.version;

/**
 * Published npm name. The generated config runs the MCP servers through
 * `npx -y <PKG>@<VERSION>` -- "agentos" is an unrelated placeholder package
 * owned by someone else on the public registry.
 */
export const PKG = pkg.name;
