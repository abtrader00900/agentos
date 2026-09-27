import { createRequire } from "node:module";

/** package.json is the only place the version lives (works from src/ via tsx and from dist/). */
export const VERSION = (createRequire(import.meta.url)("../package.json") as { version: string }).version;
