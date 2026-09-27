/** Best-effort async engine warmup; call before relying on tree-sitter edges. */
export declare function ensureGraphEngine(): Promise<boolean>;
export declare function graphEngine(): "tree-sitter" | "regex";
/** tree-sitter extraction when active, regex fallback otherwise. */
export declare function extractImportsAuto(filePath: string, content: string): ImportRef[];
export interface ImportRef {
    specifier: string;
    kind: "import" | "require";
}
export declare function extractImports(filePath: string, content: string): ImportRef[];
/**
 * Directory listings for one resolution pass: dir → (entry name → isDirectory).
 * update() hands the same map to every call, so resolving thousands of imports
 * costs one readdir per directory instead of a dozen existsSync calls per import.
 */
export type DirCache = Map<string, Map<string, boolean>>;
export declare function resolveModule(cwd: string, importerRel: string, specifier: string, cache?: DirCache): string | null;
/** go.mod lookups for one resolution pass: dir → the nearest go.mod's { dir, module }, or null. */
export type GoModCache = Map<string, {
    dir: string;
    module: string;
} | null>;
/**
 * Every file an import points at. A Go import names a package — a directory — so it
 * links to each non-test .go file in it; everything else resolves to one file.
 */
export declare function resolveTargets(cwd: string, importerRel: string, specifier: string, cache?: DirCache, goMods?: GoModCache): string[];
export declare function scanProject(cwd: string): Map<string, number>;
export declare class GraphStore {
    private db;
    constructor(dbPath: string);
    private files;
    private edges;
    private pending;
    private setFiles;
    private setEdges;
    private setPending;
    /** FR-5.4: incremental — only re-extract files whose mtime changed */
    update(cwd: string): {
        scanned: number;
        changed: number;
    };
    /** FR-5.3: who depends on this file (impact of changing it) */
    impact(file: string): string[];
    /** What this file depends on */
    dependencies(file: string): string[];
    /** FR-5.6: files nobody imports */
    orphans(): string[];
    /** FR-5.6: import cycles (DFS) */
    cycles(): string[][];
    stats(): {
        files: number;
        edges: number;
        engine: "tree-sitter" | "regex";
    };
    rebuild(cwd: string): {
        scanned: number;
        changed: number;
    };
    close(): void;
}
