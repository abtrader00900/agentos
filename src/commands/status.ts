import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/loader.js";
import { detectDrift, readManifest } from "../core/manifest.js";
import { HARNESS_MARKER } from "../generators/index.js";

/**
 * FR-2.3: status — harnesses detected, drift, memory size.
 * FR-8.1: --json machine-readable output for editor integrations (VS Code ext).
 */

export interface StatusData {
  project: { name: string; stack: string[]; rules: number; skills: string[]; mcpServers: string[] } | null;
  configError: string | null;
  sources: string[];
  harnesses: { name: string; file: string; present: boolean }[];
  drift: { available: boolean; drifted: string[] };
  memory: { initialized: boolean; sizeKb: number | null };
}

export function statusData(options: { cwd?: string } = {}): StatusData {
  const cwd = options.cwd ?? process.cwd();
  const data: StatusData = {
    project: null,
    configError: null,
    sources: [],
    harnesses: [],
    drift: { available: false, drifted: [] },
    memory: { initialized: false, sizeKb: null },
  };

  try {
    const loaded = loadConfig(cwd);
    data.sources = loaded.sources;
    data.project = {
      name: loaded.config.project.name,
      stack: loaded.config.stack,
      rules: loaded.config.rules.length,
      skills: loaded.config.skills.map((s) => s.name),
      mcpServers: loaded.config.mcpServers.map((s) => s.name),
    };
  } catch (e) {
    data.configError = (e as Error).message.split("\n")[0];
  }

  const harnessFiles: Record<string, string> = HARNESS_MARKER;
  for (const [name, file] of Object.entries(harnessFiles)) {
    data.harnesses.push({ name, file, present: existsSync(path.join(cwd, file)) });
  }

  const manifest = readManifest(cwd);
  if (manifest) {
    data.drift = { available: true, drifted: detectDrift(cwd).drifted };
  }

  const memDb = path.join(cwd, ".agentos", "memory.json");
  if (existsSync(memDb)) {
    data.memory = { initialized: true, sizeKb: Number((statSync(memDb).size / 1024).toFixed(1)) };
  }

  return data;
}

export function status(options: { cwd?: string; json?: boolean } = {}): string {
  const data = statusData(options);

  if (options.json) {
    const out = JSON.stringify(data, null, 2);
    console.log(out);
    return out;
  }

  const lines: string[] = [];
  if (data.project) {
    lines.push(`Project:    ${data.project.name}`);
    lines.push(`Stack:      ${data.project.stack.join(", ") || "(none)"}`);
    lines.push(`Rules:      ${data.project.rules}`);
    lines.push(`Skills:     ${data.project.skills.join(", ") || "(none)"}`);
    lines.push(`MCP servers: ${data.project.mcpServers.join(", ") || "(none)"}`);
  } else {
    lines.push(`Config:     ⚠ ${data.configError}`);
  }
  lines.push(`Sources:    ${data.sources.length} (${data.sources.map((s) => path.basename(path.dirname(s)) + "/" + path.basename(s)).join(", ")})`);
  lines.push("", "Harnesses:");
  for (const h of data.harnesses) {
    lines.push(`  ${h.present ? "✓" : "✗"} ${h.name} (${h.file})`);
  }
  lines.push("", `Drift:      ${data.drift.available ? (data.drift.drifted.length ? "⚠ " + data.drift.drifted.join(", ") : "none") : "no manifest yet — run \`agentos sync\`"}`);
  lines.push(data.memory.initialized
    ? `Memory:     ${data.memory.sizeKb} KB (.agentos/memory.json)`
    : "Memory:     not initialized (starts on first MCP use)");

  const out = lines.join("\n");
  console.log(out);
  return out;
}
