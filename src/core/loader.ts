import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { agentConfigSchema, type AgentConfig } from "./schema.js";

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

function loadLayer(file: string): { raw?: unknown; error?: string } {
  if (!existsSync(file)) return {};
  try {
    return { raw: parse(readFileSync(file, "utf8")) ?? {} };
  } catch (e) {
    return { error: `${file}: ${(e as Error).message}` };
  }
}

const keyed = (item: unknown) =>
  !!item && typeof item === "object" && !Array.isArray(item) &&
  ((item as Record<string, unknown>).id !== undefined || (item as Record<string, unknown>).name !== undefined);

function mergeLayer(base: Record<string, unknown>, layer: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(layer)) {
    const existing = out[key];
    if (Array.isArray(existing) && Array.isArray(value) && [...existing, ...value].every(keyed)) {
      // merge arrays of rules/skills/servers by id/name so overrides replace instead of duplicate;
      // plain lists (stack: [vue]) fall through and replace the lower layer's list wholesale
      const map = new Map<string | number, unknown>();
      existing.forEach((item, i) => {
        const id =
          item && typeof item === "object"
            ? ((item as Record<string, unknown>).id ?? (item as Record<string, unknown>).name ?? i)
            : i;
        map.set(id as string | number, item);
      });
      value.forEach((item, i) => {
        const id =
          item && typeof item === "object"
            ? ((item as Record<string, unknown>).id ?? (item as Record<string, unknown>).name ?? i)
            : i;
        map.set(id as string | number, item);
      });
      out[key] = [...map.values()];
    } else if (
      existing && value && typeof existing === "object" && typeof value === "object" &&
      !Array.isArray(existing) && !Array.isArray(value)
    ) {
      out[key] = mergeLayer(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// HOME is unset on Windows (USERPROFILE is the equivalent); homedir() covers every platform.
export function loadConfig(cwd = process.cwd(), home = homedir()): LoadedConfig {
  const globalFile = path.join(home, ".agentos", "agent.config.yaml");
  const projectFile = path.join(cwd, "agent.config.yaml");
  const localFile = path.join(cwd, "agent.config.local.yaml");

  const layers = [globalFile, projectFile, localFile];
  const missing: string[] = [];
  let merged: Record<string, unknown> = {};
  const sources: string[] = [];
  let localMcpEnv: string[] = [];

  for (const file of layers) {
    const { raw, error } = loadLayer(file);
    if (error) {
      throw new Error(`Invalid YAML in ${error}`);
    }
    if (raw === undefined) {
      missing.push(file);
      continue;
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Invalid config in ${file}: the top level must be a mapping (project:, rules:, …), not a ${Array.isArray(raw) ? "list" : typeof raw}`);
    }
    sources.push(file);
    if (file === localFile) {
      const servers = (raw as { mcpServers?: unknown }).mcpServers;
      localMcpEnv = Array.isArray(servers)
        ? servers.filter((s) => s && typeof s === "object" && (s as { env?: unknown }).env).map((s) => String((s as { name?: unknown }).name))
        : [];
    }
    merged = mergeLayer(merged, raw as Record<string, unknown>);
  }

  if (sources.length === 0) {
    // first line stands alone: status/doctor show only that line
    throw new Error(
      `No agent.config.yaml found in ${cwd} — run "agentos init". Searched:\n  ${layers.join("\n  ")}`,
    );
  }

  const parsed = agentConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`agent.config.yaml validation failed:\n${issues}`);
  }

  return { config: parsed.data, sources, missing, hasProject: sources.includes(projectFile), localMcpEnv };
}
