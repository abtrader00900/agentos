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
export declare function hashContent(content: string): string;
export declare function manifestPath(cwd: string): string;
export declare function readManifest(cwd: string): Manifest | null;
export declare function writeManifest(cwd: string, entries: ManifestEntry[]): void;
export interface DriftResult {
    /** generated content differs from manifest — file was hand-edited after sync */
    drifted: string[];
    /** files missing from disk that manifest says should exist */
    missing: string[];
    /** clean files */
    ok: string[];
}
export declare function detectDrift(cwd: string): DriftResult;
