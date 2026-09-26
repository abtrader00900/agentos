import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { agentConfigSchema } from "./schema.js";
function loadLayer(file) {
    if (!existsSync(file))
        return {};
    try {
        return { raw: parse(readFileSync(file, "utf8")) ?? {} };
    }
    catch (e) {
        return { error: `${file}: ${e.message}` };
    }
}
function mergeLayer(base, layer) {
    const out = { ...base };
    for (const [key, value] of Object.entries(layer)) {
        const existing = out[key];
        if (Array.isArray(existing) && Array.isArray(value)) {
            // merge arrays by id/name so overrides replace instead of duplicate
            const map = new Map();
            existing.forEach((item, i) => {
                const id = item && typeof item === "object"
                    ? (item.id ?? item.name ?? i)
                    : i;
                map.set(id, item);
            });
            value.forEach((item, i) => {
                const id = item && typeof item === "object"
                    ? (item.id ?? item.name ?? i)
                    : i;
                map.set(id, item);
            });
            out[key] = [...map.values()];
        }
        else if (existing && value && typeof existing === "object" && typeof value === "object" &&
            !Array.isArray(existing) && !Array.isArray(value)) {
            out[key] = mergeLayer(existing, value);
        }
        else {
            out[key] = value;
        }
    }
    return out;
}
// HOME is unset on Windows (USERPROFILE is the equivalent); homedir() covers every platform.
export function loadConfig(cwd = process.cwd(), home = homedir()) {
    const globalFile = path.join(home, ".agentos", "agent.config.yaml");
    const projectFile = path.join(cwd, "agent.config.yaml");
    const localFile = path.join(cwd, "agent.config.local.yaml");
    const layers = [globalFile, projectFile, localFile];
    const missing = [];
    let merged = {};
    const sources = [];
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
        merged = mergeLayer(merged, raw);
    }
    if (sources.length === 0) {
        throw new Error(`No agent.config.yaml found. Searched:\n  ${layers.join("\n  ")}\n\n` +
            `Run "agentos init" to create one.`);
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
//# sourceMappingURL=loader.js.map