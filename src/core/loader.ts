import { readFileSync, existsSync } from "node:fs";
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
}

function loadLayer(file: string): { raw?: unknown; error?: string } {
  if (!existsSync(file)) return {};
  try {
    return { raw: parse(readFileSync(file, "utf8")) ?? {} };
  } catch (e) {
    return { error: `${file}: ${(e as Error).message}` };
  }
}

function mergeLayer(base: Record<string, unknown>, layer: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(layer)) {
    const existing = out[key];
    if (Array.isArray(existing) && Array.isArray(value)) {
      // merge arrays by id/name so overrides replace instead of duplicate
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

export function loadConfig(cwd = process.cwd(), home = process.env.HOME ?? ""): LoadedConfig {
  const globalFile = path.join(home, ".agentos", "agent.config.yaml");
  const projectFile = path.join(cwd, "agent.config.yaml");
  const localFile = path.join(cwd, "agent.config.local.yaml");

  const layers = [globalFile, projectFile, localFile];
  const missing: string[] = [];
  let merged: Record<string, unknown> = {};
  const sources: string[] = [];

  for (const file of layers) {
    const { raw, error } = loadLayer(file);
    if (error) {
      throw new Error(`Invalid YAML in ${error}`);
    }
    if (raw === undefined) {
      missing.push(file);
      continue;
    }
    sources.push(file);
    merged = mergeLayer(merged, raw as Record<string, unknown>);
  }

  if (sources.length === 0) {
    throw new Error(
      `No agent.config.yaml found. Searched:\n  ${layers.join("\n  ")}\n\n` +
        `Run "agentos init" or create one. See examples/agent.config.yaml.`,
    );
  }

  const parsed = agentConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`agent.config.yaml validation failed:\n${issues}`);
  }

  return { config: parsed.data, sources, missing };
}
