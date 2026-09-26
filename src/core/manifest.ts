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

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function manifestPath(cwd: string): string {
  return path.join(cwd, ".agentos", "manifest.json");
}

export function readManifest(cwd: string): Manifest | null {
  const p = manifestPath(cwd);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Manifest;
  } catch {
    return null;
  }
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
    const current = readFileSync(onDiskPath, "utf8");
    if (hashContent(current) !== entry.generatedHash) {
      result.drifted.push(entry.path);
    } else {
      result.ok.push(entry.path);
    }
  }
  return result;
}
