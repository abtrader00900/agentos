import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
/**
 * Line endings are not content: a Windows clone with core.autocrlf=true checks
 * the generated files out as CRLF, and raw-byte hashes then called every one of
 * them hand-edited.
 */
export const normalizeEol = (content) => content.replace(/\r\n/g, "\n");
export function hashContent(content) {
    return createHash("sha256").update(normalizeEol(content), "utf8").digest("hex");
}
export function manifestPath(cwd) {
    return path.join(cwd, ".agentos", "manifest.json");
}
/** A project-relative path that stays inside the project — manifest.json may be committed and edited by anyone. */
export function isProjectPath(cwd, p) {
    if (typeof p !== "string" || !p || path.isAbsolute(p) || /^[a-zA-Z]:/.test(p))
        return false;
    const rel = path.relative(cwd, path.resolve(cwd, p));
    return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}
export function readManifest(cwd) {
    const p = manifestPath(cwd);
    if (!existsSync(p))
        return null;
    let raw;
    try {
        raw = JSON.parse(readFileSync(p, "utf8"));
    }
    catch {
        return null;
    }
    const files = raw?.files;
    if (!Array.isArray(files))
        return null;
    return {
        version: 1,
        generatedAt: String(raw.generatedAt ?? ""),
        // drop malformed entries and anything pointing outside the project: sync deletes
        // stale manifest files, and that must never reach ../ or an absolute path
        files: files.filter((f) => !!f && typeof f === "object" &&
            isProjectPath(cwd, f.path) &&
            typeof f.generatedHash === "string"),
    };
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
        let current = null;
        try {
            current = readFileSync(onDiskPath, "utf8");
        }
        catch { /* replaced by a directory, unreadable */ }
        if (current === null || hashContent(current) !== entry.generatedHash) {
            result.drifted.push(entry.path);
        }
        else {
            result.ok.push(entry.path);
        }
    }
    return result;
}
//# sourceMappingURL=manifest.js.map