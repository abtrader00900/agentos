import Database from "better-sqlite3";
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
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

export class GraphStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        mtime REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS edges (
        src TEXT NOT NULL,
        dst TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'import',
        PRIMARY KEY (src, dst)
      );
      CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);
    `);
  }

  /** FR-5.4: incremental — only re-extract files whose mtime changed */
  update(cwd: string): { scanned: number; changed: number } {
    const onDisk = scanProject(cwd);
    const known = new Map(
      (this.db.prepare(`SELECT path, mtime FROM files`).all() as { path: string; mtime: number }[])
        .map((r) => [r.path, r.mtime]),
    );

    const changed: string[] = [];
    for (const [p, mtime] of onDisk) {
      if (known.get(p) !== mtime) changed.push(p);
    }
    const removed = [...known.keys()].filter((p) => !onDisk.has(p));

    const delEdges = this.db.prepare(`DELETE FROM edges WHERE src = ?`);
    const upsertFile = this.db.prepare(`INSERT INTO files (path, mtime) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime`);
    const delFile = this.db.prepare(`DELETE FROM files WHERE path = ?`);
    const insEdge = this.db.prepare(`INSERT OR IGNORE INTO edges (src, dst, kind) VALUES (?, ?, ?)`);

    const tx = this.db.transaction(() => {
      for (const p of removed) {
        delEdges.run(p);
        delFile.run(p);
      }
      for (const p of changed) {
        delEdges.run(p);
        upsertFile.run(p, onDisk.get(p));
        let content: string;
        try { content = readFileSync(path.join(cwd, p), "utf8"); } catch { return; }
        for (const ref of extractImports(p, content)) {
          const dst = resolveModule(cwd, p, ref.specifier);
          if (dst && dst !== p) insEdge.run(p, dst, ref.kind);
        }
      }
    });
    tx();
    return { scanned: onDisk.size, changed: changed.length };
  }

  /** FR-5.3: who depends on this file (impact of changing it) */
  impact(file: string): string[] {
    return (this.db.prepare(`SELECT src FROM edges WHERE dst = ? ORDER BY src`).all(file) as { src: string }[]).map((r) => r.src);
  }

  /** What this file depends on */
  dependencies(file: string): string[] {
    return (this.db.prepare(`SELECT dst FROM edges WHERE src = ? ORDER BY dst`).all(file) as { dst: string }[]).map((r) => r.dst);
  }

  /** FR-5.6: files nobody imports */
  orphans(): string[] {
    return (this.db.prepare(`
      SELECT f.path FROM files f
      LEFT JOIN edges e ON e.dst = f.path
      WHERE e.dst IS NULL ORDER BY f.path
    `).all() as { path: string }[]).map((r) => r.path);
  }

  /** FR-5.6: import cycles (DFS) */
  cycles(): string[][] {
    const edges = this.db.prepare(`SELECT src, dst FROM edges`).all() as { src: string; dst: string }[];
    const adj = new Map<string, string[]>();
    for (const e of edges) {
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
    const files = (this.db.prepare(`SELECT COUNT(*) c FROM files`).get() as { c: number }).c;
    const edges = (this.db.prepare(`SELECT COUNT(*) c FROM edges`).get() as { c: number }).c;
    return { files, edges };
  }

  rebuild(cwd: string): { scanned: number; changed: number } {
    this.db.exec(`DELETE FROM edges; DELETE FROM files;`);
    return this.update(cwd);
  }

  close(): void {
    this.db.close();
  }
}
