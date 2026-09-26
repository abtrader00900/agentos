import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Where the project lives, for MCP servers a harness may start from anywhere:
 * AGENTOS_PROJECT wins, then the nearest ancestor of `from` that holds an
 * agent.config.yaml (or an .agentos/ directory), then `from` itself.
 */
export function projectRoot(from = process.cwd()): string {
  if (process.env.AGENTOS_PROJECT) return process.env.AGENTOS_PROJECT;
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, "agent.config.yaml")) || existsSync(path.join(dir, ".agentos"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(from);
    dir = parent;
  }
}
