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
export declare const normalizeEol: (content: string) => string;
export declare function hashContent(content: string): string;
export declare function manifestPath(cwd: string): string;
/** A project-relative path that stays inside the project — manifest.json may be committed and edited by anyone. */
export declare function isProjectPath(cwd: string, p: string): boolean;
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
