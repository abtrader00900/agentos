import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
export function hashContent(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
}
export function manifestPath(cwd) {
    return path.join(cwd, ".agentos", "manifest.json");
}
export function readManifest(cwd) {
    const p = manifestPath(cwd);
    if (!existsSync(p))
        return null;
    try {
        return JSON.parse(readFileSync(p, "utf8"));
    }
    catch {
        return null;
    }
}
export function writeManifest(cwd, entries) {
    const p = manifestPath(cwd);
    mkdirSync(path.dirname(p), { recursive: true });
    const manifest = { version: 1, generatedAt: new Date().toISOString(), files: entries };
    writeFileSync(p, JSON.stringify(manifest, null, 2) + "\n");
}
export function detectDrift(cwd) {
    const manifest = readManifest(cwd);
    const result = { drifted: [], missing: [], ok: [] };
    if (!manifest)
        return result;
    for (const entry of manifest.files) {
        const onDiskPath = path.join(cwd, entry.path);
        if (!existsSync(onDiskPath)) {
            result.missing.push(entry.path);
            continue;
        }
        const current = readFileSync(onDiskPath, "utf8");
        if (hashContent(current) !== entry.generatedHash) {
            result.drifted.push(entry.path);
        }
        else {
            result.ok.push(entry.path);
        }
    }
    return result;
}
//# sourceMappingURL=manifest.js.map