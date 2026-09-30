import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };

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
export function projectRoot(from = process.cwd(), home = homedir()): string {
  const env = process.env.AGENTOS_PROJECT?.trim();
  if (env && isDir(path.resolve(env))) return path.resolve(env);
  const start = path.resolve(from);
  const global = new Set([path.resolve(home), path.resolve(homedir())]);
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, "agent.config.yaml"))) return dir;
    if (!global.has(dir) && isDir(path.join(dir, ".agentos"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}
