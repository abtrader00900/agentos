import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { JsonStore } from "../../core/jsonstore.js";
import path from "node:path";

/**
 * FR-5.x: file-level dependency graph.
 * Deterministic import extraction (no model), SQLite storage,
 * incremental rebuild via mtime tracking (FR-5.4/5.5).
 *
 * NOTE: v0 uses regex import parsing (fast, zero native deps). Upgrade path:
 * tree-sitter (WASM) for deeper call-level graphs in a later phase.
 */

// ---------- import extraction ----------

export interface ImportRef {
  specifier: string;
  kind: "import" | "require";
}

const RESOLVE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".php", ".go", ".java", ".kt"];

export function extractImports(filePath: string, content: string): ImportRef[] {
  const ext = path.extname(filePath);
  const refs: ImportRef[] = [];
  const push = (specifier: string, kind: ImportRef["kind"] = "import") => {
    const s = specifier.trim();
    if (s) refs.push({ specifier: s, kind });
  };

  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    for (const m of content.matchAll(/import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)) push(m[1]);
    for (const m of content.matchAll(/export\s+(?:[^'"]*?\s+from\s+)['"]([^'"]+)['"]/g)) push(m[1]);
    for (const m of content.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) push(m[1], "require");
    for (const m of content.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) push(m[1]);
  } else if (ext === ".py") {
    for (const m of content.matchAll(/^\s*import\s+([\w.]+)/gm)) push(m[1]);
    for (const m of content.matchAll(/^\s*from\s+([\w.]+)\s+import\s+/gm)) push(m[1]);
  } else if (ext === ".php") {
    for (const m of content.matchAll(/^\s*use\s+([\\\w]+)(?:\s+as\s+\w+)?\s*;/gm)) push(m[1]);
    for (const m of content.matchAll(/(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g)) push(m[1], "require");
  } else if (ext === ".go") {
    for (const m of content.matchAll(/import\s+(?:\(\s*)?["`]([^"`]+)["`]/g)) push(m[1]);
    for (const m of content.matchAll(/^\s*["`]([^"`]+)["`]\s*$/gm)) push(m[1]);
  } else if ([".java", ".kt"].includes(ext)) {
    for (const m of content.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+)(?:\.\*)?\s*;?/gm)) push(m[1]);
  }
  return refs;
}

// ---------- module resolution ----------

export function resolveModule(cwd: string, importerRel: string, specifier: string): string | null {
  const importerDir = path.dirname(path.join(cwd, importerRel));
  const rel = (p: string) => path.relative(cwd, p).replace(/\\/g, "/");

  // relative imports
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const base = path.resolve(importerDir, specifier);
    return resolveAsFileOrDir(base, rel);
  }

  // absolute-from-root style (e.g. "/app/Models/User" in Laravel, "@/lib/x" aliases)
  const cleaned = specifier.replace(/^@[/]/, "");
  const fromRoot = resolveAsFileOrDir(path.join(cwd, cleaned), rel);
  if (fromRoot) return fromRoot;

  // PHP namespace style: App\Models\User → app/Models/User.php
  if (/^([A-Z][\w]*\\)+[\w]+$/.test(specifier)) {
    const phpPath = specifier.replace(/\\/g, "/");
    const fromApp = resolveAsFileOrDir(path.join(cwd, phpPath), rel);
    if (fromApp) return fromApp;
    const lowerApp = resolveAsFileOrDir(path.join(cwd, phpPath.charAt(0).toLowerCase() + phpPath.slice(1)), rel);
    if (lowerApp) return lowerApp;
  }

  return null; // external package or unresolved alias
}

function resolveAsFileOrDir(base: string, rel: (p: string) => string): string | null {
  for (const ext of RESOLVE_EXTS) {
    if (existsSync(base + ext)) return rel(base + ext);
  }
  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const ext of RESOLVE_EXTS) {
      if (existsSync(path.join(base, "index" + ext))) return rel(path.join(base, "index" + ext));
    }
  }
  return null;
}

// ---------- scanning ----------

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "vendor", ".next", ".cache",
  "coverage", "out", ".agentos", "target", "__pycache__", "storage", "bootstrap",
]);

export function scanProject(cwd: string): Map<string, number> {
  const files = new Map<string, number>();
  const walk = (dir: string, rel: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name), r);
      } else if (RESOLVE_EXTS.includes(path.extname(e.name))) {
        try { files.set(r, statSync(path.join(dir, e.name)).mtimeMs); } catch { /* ignore */ }
      }
    }
  };
  walk(cwd, "");
  return files;
}

// ---------- graph store ----------

interface FileRow { path: string; mtime: number }
interface EdgeRow { src: string; dst: string; kind: string }

export class GraphStore {
  private db: JsonStore;

  constructor(dbPath: string) {
    this.db = new JsonStore(dbPath);
  }

  private files(): Map<string, number> {
    return new Map(this.db.table<FileRow>("files").map((f) => [f.path, f.mtime]));
  }

  private edges(): EdgeRow[] {
    return this.db.table<EdgeRow>("edges");
  }

  private setFiles(files: Map<string, number>): void {
    this.db.table<FileRow>("files").splice(
      0,
      this.db.table<FileRow>("files").length,
      ...[...files.entries()].map(([path, mtime]) => ({ path, mtime })),
    );
  }

  private setEdges(edges: EdgeRow[]): void {
    const t = this.db.table<EdgeRow>("edges");
    t.splice(0, t.length, ...edges);
  }

  /** FR-5.4: incremental — only re-extract files whose mtime changed */
  update(cwd: string): { scanned: number; changed: number } {
    const onDisk = scanProject(cwd);
    const fileRows = this.files();
    const edges = this.edges();

    const changed: string[] = [];
    for (const [p, mtime] of onDisk) {
      if (fileRows.get(p) !== mtime) changed.push(p);
    }
    const removed = new Set([...fileRows.keys()].filter((p) => !onDisk.has(p)));

    if (removed.size) {
      this.setEdges(edges.filter((e) => !removed.has(e.src) && !removed.has(e.dst)));
      for (const p of removed) fileRows.delete(p);
    }

    const changedSet = new Set(changed);
    const newEdges = this.edges().filter((e) => !changedSet.has(e.src));
    for (const p of changed) {
      fileRows.set(p, onDisk.get(p)!);
      let content: string;
      try { content = readFileSync(path.join(cwd, p), "utf8"); } catch { continue; }
      for (const ref of extractImports(p, content)) {
        const dst = resolveModule(cwd, p, ref.specifier);
        if (dst && dst !== p) newEdges.push({ src: p, dst, kind: ref.kind });
      }
    }
    this.setEdges(newEdges);
    this.setFiles(fileRows);
    this.db.save();
    return { scanned: onDisk.size, changed: changed.length };
  }

  /** FR-5.3: who depends on this file (impact of changing it) */
  impact(file: string): string[] {
    return [...new Set(this.edges().filter((e) => e.dst === file).map((e) => e.src))].sort();
  }

  /** What this file depends on */
  dependencies(file: string): string[] {
    return [...new Set(this.edges().filter((e) => e.src === file).map((e) => e.dst))].sort();
  }

  /** FR-5.6: files nobody imports */
  orphans(): string[] {
    const imported = new Set(this.edges().map((e) => e.dst));
    return [...this.files().keys()].filter((p) => !imported.has(p)).sort();
  }

  /** FR-5.6: import cycles (DFS) */
  cycles(): string[][] {
    const adj = new Map<string, string[]>();
    for (const e of this.edges()) {
      if (!adj.has(e.src)) adj.set(e.src, []);
      adj.get(e.src)!.push(e.dst);
    }
    const found: string[][] = [];
    const visiting = new Set<string>();
    const done = new Set<string>();
    const stack: string[] = [];
    const dfs = (n: string) => {
      if (done.has(n)) return;
      if (visiting.has(n)) {
        const start = stack.indexOf(n);
        if (start >= 0) found.push([...stack.slice(start), n]);
        return;
      }
      visiting.add(n);
      stack.push(n);
      for (const m of adj.get(n) ?? []) dfs(m);
      stack.pop();
      visiting.delete(n);
      done.add(n);
    };
    for (const n of adj.keys()) dfs(n);
    return found;
  }

  stats(): { files: number; edges: number } {
    return { files: this.files().size, edges: this.edges().length };
  }

  rebuild(cwd: string): { scanned: number; changed: number } {
    this.setEdges([]);
    this.setFiles(new Map());
    this.db.save();
    return this.update(cwd);
  }

  close(): void {
    this.db.close();
  }
}
