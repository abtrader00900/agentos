import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/loader.js";
import { detectDrift, readManifest } from "../core/manifest.js";
import { HARNESS_MARKER } from "../generators/index.js";
export function statusData(options = {}) {
    const cwd = options.cwd ?? process.cwd();
    const data = {
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
    }
    catch (e) {
        data.configError = e.message.split("\n")[0];
    }
    const harnessFiles = HARNESS_MARKER;
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
export function status(options = {}) {
    const data = statusData(options);
    if (options.json) {
        const out = JSON.stringify(data, null, 2);
        console.log(out);
        return out;
    }
    const lines = [];
    if (data.project) {
        lines.push(`Project:    ${data.project.name}`);
        lines.push(`Stack:      ${data.project.stack.join(", ") || "(none)"}`);
        lines.push(`Rules:      ${data.project.rules}`);
        lines.push(`Skills:     ${data.project.skills.join(", ") || "(none)"}`);
        lines.push(`MCP servers: ${data.project.mcpServers.join(", ") || "(none)"}`);
    }
    else {
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
//# sourceMappingURL=status.js.map