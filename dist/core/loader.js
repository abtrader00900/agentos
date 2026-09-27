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
const keyed = (item) => !!item && typeof item === "object" && !Array.isArray(item) &&
    (item.id !== undefined || item.name !== undefined);
function mergeLayer(base, layer) {
    const out = { ...base };
    for (const [key, value] of Object.entries(layer)) {
        const existing = out[key];
        if (Array.isArray(existing) && Array.isArray(value) && [...existing, ...value].every(keyed)) {
            // merge arrays of rules/skills/servers by id/name so overrides replace instead of duplicate;
            // plain lists (stack: [vue]) fall through and replace the lower layer's list wholesale
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
    let localMcpEnv = [];
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
            const servers = raw.mcpServers;
            localMcpEnv = Array.isArray(servers)
                ? servers.filter((s) => s && typeof s === "object" && s.env).map((s) => String(s.name))
                : [];
        }
        merged = mergeLayer(merged, raw);
    }
    if (sources.length === 0) {
        // first line stands alone: status/doctor show only that line
        throw new Error(`No agent.config.yaml found in ${cwd} — run "agentos init". Searched:\n  ${layers.join("\n  ")}`);
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
//# sourceMappingURL=loader.js.map