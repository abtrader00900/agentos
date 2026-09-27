import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * FR-1.6: drift detection. On sync we record a hash of each generated file
 * (the generated content, not what may have been hand-edited after).
 * status/doctor compares manifest hash vs the actual current generated
 * content to detect manual edits (drift).
 */

export interface ManifestEntry {
  path: string;
  /** sha256 of the content we last generated */
  generatedHash: string;
  /** sha256 of what was on disk right after we wrote it (== generatedHash unless raced) */
  writtenHash: string;
}

export interface Manifest {
  version: 1;
  generatedAt: string;
  files: ManifestEntry[];
}

/**
 * Line endings are not content: a Windows clone with core.autocrlf=true checks
 * the generated files out as CRLF, and raw-byte hashes then called every one of
 * them hand-edited.
 */
export const normalizeEol = (content: string) => content.replace(/\r\n/g, "\n");

export function hashContent(content: string): string {
  return createHash("sha256").update(normalizeEol(content), "utf8").digest("hex");
}

export function manifestPath(cwd: string): string {
  return path.join(cwd, ".agentos", "manifest.json");
}

/** A project-relative path that stays inside the project — manifest.json may be committed and edited by anyone. */
export function isProjectPath(cwd: string, p: string): boolean {
  if (typeof p !== "string" || !p || path.isAbsolute(p) || /^[a-zA-Z]:/.test(p)) return false;
  const rel = path.relative(cwd, path.resolve(cwd, p));
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function readManifest(cwd: string): Manifest | null {
  const p = manifestPath(cwd);
  if (!existsSync(p)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
  const files = (raw as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return null;
  return {
    version: 1,
    generatedAt: String((raw as { generatedAt?: unknown }).generatedAt ?? ""),
    // drop malformed entries and anything pointing outside the project: sync deletes
    // stale manifest files, and that must never reach ../ or an absolute path
    files: files.filter((f): f is ManifestEntry =>
      !!f && typeof f === "object" &&
      isProjectPath(cwd, (f as ManifestEntry).path) &&
      typeof (f as ManifestEntry).generatedHash === "string"),
  };
}

export function writeManifest(cwd: string, entries: ManifestEntry[]): void {
  const p = manifestPath(cwd);
  mkdirSync(path.dirname(p), { recursive: true });
  const manifest: Manifest = { version: 1, generatedAt: new Date().toISOString(), files: entries };
  writeFileSync(p, JSON.stringify(manifest, null, 2) + "\n");
}

export interface DriftResult {
  /** generated content differs from manifest — file was hand-edited after sync */
  drifted: string[];
  /** files missing from disk that manifest says should exist */
  missing: string[];
  /** clean files */
  ok: string[];
}

export function detectDrift(cwd: string): DriftResult {
  const manifest = readManifest(cwd);
  const result: DriftResult = { drifted: [], missing: [], ok: [] };
  if (!manifest) return result;
  for (const entry of manifest.files) {
    const onDiskPath = path.join(cwd, entry.path);
    if (!existsSync(onDiskPath)) {
      result.missing.push(entry.path);
      continue;
    }
    let current: string | null = null;
    try { current = readFileSync(onDiskPath, "utf8"); } catch { /* replaced by a directory, unreadable */ }
    if (current === null || hashContent(current) !== entry.generatedHash) {
      result.drifted.push(entry.path);
    } else {
      result.ok.push(entry.path);
    }
  }
  return result;
}
