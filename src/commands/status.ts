import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/loader.js";
import { detectDrift, readManifest } from "../core/manifest.js";

/**
 * FR-2.3: status — harnesses detected, drift, memory size.
 */
export function status(options: { cwd?: string } = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const lines: string[] = [];

  let configSources: string[] = [];
  try {
    const loaded = loadConfig(cwd);
    configSources = loaded.sources;
    lines.push(`Project:    ${loaded.config.project.name}`);
    lines.push(`Stack:      ${loaded.config.stack.join(", ") || "(none)"}`);
    lines.push(`Rules:      ${loaded.config.rules.length}`);
    lines.push(`Skills:     ${loaded.config.skills.map((s) => s.name).join(", ") || "(none)"}`);
    lines.push(`MCP servers: ${loaded.config.mcpServers.map((s) => s.name).join(", ") || "(none)"}`);
  } catch (e) {
    lines.push(`Config:     ⚠ ${(e as Error).message.split("\n")[0]}`);
  }

  lines.push(`Sources:    ${configSources.length} (${configSources.map((s) => path.basename(path.dirname(s)) + "/" + path.basename(s)).join(", ")})`);

  // harness config presence
  const harnessFiles: Record<string, string> = {
    "claude-code": "CLAUDE.md",
    codex: "AGENTS.md",
    antigravity: ".antigravity/config.md",
  };
  lines.push("", "Harnesses:");
  for (const [name, file] of Object.entries(harnessFiles)) {
    const present = existsSync(path.join(cwd, file));
    lines.push(`  ${present ? "✓" : "✗"} ${name} (${file})`);
  }

  // drift
  const manifest = readManifest(cwd);
  if (manifest) {
    const drift = detectDrift(cwd, new Map());
    lines.push("", `Drift:      ${drift.drifted.length ? "⚠ " + drift.drifted.join(", ") : "none"}`);
  } else {
    lines.push("", "Drift:      no manifest yet — run `agentos sync`");
  }

  // memory size
  const memDb = path.join(cwd, ".agentos", "memory.json");
  if (existsSync(memDb)) {
    const size = statSync(memDb).size;
    lines.push(`Memory:     ${(size / 1024).toFixed(1)} KB (.agentos/memory.json)`);
  } else {
    lines.push("Memory:     not initialized (starts on first MCP use)");
  }

  const out = lines.join("\n");
  console.log(out);
  return out;
}
