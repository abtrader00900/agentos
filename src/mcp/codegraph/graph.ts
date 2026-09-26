import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { JsonStore } from "../../core/jsonstore.js";
import { initTreeSitter, treeSitterActive, extractWithTreeSitter } from "./tsparser.js";
import path from "node:path";

/**
 * FR-5.x: file-level dependency graph.
 * Deterministic import extraction (no model), JSON storage,
 * incremental rebuild via mtime tracking (FR-5.4/5.5).
 *
 * Import extraction: tree-sitter (WASM) when available (Issue #4),
 * transparent regex fallback — zero native deps either way.
 */

let engineReady: Promise<boolean> | null = null;

/** Best-effort async engine warmup; call before relying on tree-sitter edges. */
export function ensureGraphEngine(): Promise<boolean> {
  engineReady ??= initTreeSitter().catch(() => false);
  return engineReady;
}

export function graphEngine(): "tree-sitter" | "regex" {
  return treeSitterActive() ? "tree-sitter" : "regex";
}

/** tree-sitter extraction when active, regex fallback otherwise. */
export function extractImportsAuto(filePath: string, content: string): ImportRef[] {
  if (treeSitterActive()) {
    const refs = extractWithTreeSitter(filePath, content);
    if (refs) return refs;
  }
  return extractImports(filePath, content);
}

// ---------- import extraction ----------

export interface ImportRef {
  specifier: string;
  kind: "import" | "require";
}

const JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const RESOLVE_EXTS = [...JS_EXTS, ".py", ".php", ".go", ".java", ".kt"];

/** Extensions a specifier may resolve to, by the importer's language. */
function extsFor(importerExt: string): string[] {
  if (JS_EXTS.includes(importerExt)) return JS_EXTS;
  if (importerExt === ".java" || importerExt === ".kt") return [".java", ".kt"];
  if (RESOLVE_EXTS.includes(importerExt)) return [importerExt];
  return RESOLVE_EXTS;
}

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

/** readdir results for one resolution pass (update() hands the same map to every call). */
export type DirCache = Map<string, Set<string>>;

function listDir(dir: string, cache?: DirCache): Set<string> {
  let names = cache?.get(dir);
  if (!names) {
    try { names = new Set(readdirSync(dir)); } catch { names = new Set(); }
    cache?.set(dir, names);
  }
  return names;
}

/**
 * existsSync is case-insensitive on Windows and default macOS volumes, so
 * "App/Models/X.php" reports found when only "app/Models/X.php" exists — and
 * the wrong-case edge never matches the real file key. Require the on-disk spelling.
 */
function existsExact(cwd: string, abs: string, cache?: DirCache): boolean {
  if (!existsSync(abs)) return false;
  const rel = path.relative(cwd, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return true; // outside the project: nothing to compare against
  let dir = cwd;
  for (const seg of rel.split(path.sep)) {
    if (!listDir(dir, cache).has(seg)) return false;
    dir = path.join(dir, seg);
  }
  return true;
}

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

const JAVA_ROOTS = ["", "src", "src/main/java", "src/main/kotlin", "app/src/main/java", "app/src/main/kotlin"];

export function resolveModule(cwd: string, importerRel: string, specifier: string, cache?: DirCache): string | null {
  const importerDir = path.dirname(path.join(cwd, importerRel));
  const lang = path.extname(importerRel);
  const exts = extsFor(lang);
  const rel = (p: string) => path.relative(cwd, p).replace(/\\/g, "/");
  const tryAt = (base: string) => resolveAsFileOrDir(cwd, base, exts, rel, cache);

  // relative imports
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return tryAt(path.resolve(importerDir, specifier));
  }

  // Python relative: "from .x import y" / "from .. import z" — each extra dot walks up one package
  if (lang === ".py") {
    const m = specifier.match(/^(\.+)(.*)$/);
    if (m) {
      let base = importerDir;
      for (let i = 1; i < m[1].length; i++) base = path.dirname(base);
      return tryAt(m[2] ? path.join(base, ...m[2].split(".")) : base);
    }
  }

  // dotted packages: Python "a.b.c", Java/Kotlin "com.x.Foo" ("com.x.Foo.CONST" → drop the member)
  if ([".py", ".java", ".kt"].includes(lang) && specifier.includes(".") && !specifier.includes("/")) {
    const parts = specifier.split(".");
    const roots = lang === ".py" ? ["", "src"] : JAVA_ROOTS;
    for (const cand of [parts, parts.slice(0, -1)]) {
      if (!cand.length) continue;
      for (const root of roots) {
        const r = tryAt(path.join(cwd, root, ...cand));
        if (r) return r;
      }
    }
    return null;
  }

  // absolute-from-root style ("/app/Models/User" in Laravel, "@/lib/x" and "~/lib/x" aliases → root or src/)
  const cleaned = specifier.replace(/^[@~]\//, "");
  for (const root of ["", "src"]) {
    const r = tryAt(path.join(cwd, root, cleaned));
    if (r) return r;
  }

  // PHP namespace style: App\Models\User → App/Models/User.php, then PSR-4 lower-case app/
  if (/^([A-Za-z_][\w]*\\)+[A-Za-z_][\w]*$/.test(specifier)) {
    const phpPath = specifier.replace(/\\/g, "/");
    return tryAt(path.join(cwd, phpPath)) ?? tryAt(path.join(cwd, phpPath.charAt(0).toLowerCase() + phpPath.slice(1)));
  }

  return null; // external package or unresolved alias
}

const TS_FOR_JS: Record<string, string[]> = { ".js": [".ts", ".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };

function resolveAsFileOrDir(cwd: string, base: string, exts: string[], rel: (p: string) => string, cache?: DirCache): string | null {
  const ok = (p: string) => existsExact(cwd, p, cache);
  const ext = path.extname(base);
  if (ext && ok(base) && !isDir(base)) return rel(base);
  // ESM TypeScript writes `import "./x.js"` for x.ts
  if (TS_FOR_JS[ext]) {
    const stem = base.slice(0, -ext.length);
    for (const e of TS_FOR_JS[ext]) if (ok(stem + e)) return rel(stem + e);
  }
  for (const e of exts) {
    if (ok(base + e)) return rel(base + e);
  }
  if (ok(base) && isDir(base)) {
    const indexes = exts.includes(".py")
      ? ["__init__.py"]
      : exts.filter((e) => JS_EXTS.includes(e)).map((e) => "index" + e);
    for (const name of indexes) {
      if (ok(path.join(base, name))) return rel(path.join(base, name));
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
interface EdgeRow { src: string; dst: string; kind: string; spec?: string }
/** An import that did not resolve when its file was scanned — retried when files appear (FR-5.4). */
interface PendingRow { src: string; spec: string; kind: string }

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

  private pending(): PendingRow[] {
    return this.db.table<PendingRow>("pending");
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

  private setPending(rows: PendingRow[]): void {
    const t = this.db.table<PendingRow>("pending");
    t.splice(0, t.length, ...rows);
  }

  /** FR-5.4: incremental — only re-extract files whose mtime changed */
  update(cwd: string): { scanned: number; changed: number } {
    const cache: DirCache = new Map();
    const onDisk = scanProject(cwd);
    const fileRows = this.files();
    let edges = this.edges().slice();
    let pending = this.pending().slice();

    const changed: string[] = [];
    const added: string[] = [];
    for (const [p, mtime] of onDisk) {
      if (fileRows.get(p) !== mtime) changed.push(p);
      if (!fileRows.has(p)) added.push(p);
    }
    const removed = new Set([...fileRows.keys()].filter((p) => !onDisk.has(p)));

    if (removed.size) {
      // edges into a removed file go back to pending so a rename/restore re-links them
      for (const e of edges) {
        if (removed.has(e.dst) && !removed.has(e.src) && e.spec) pending.push({ src: e.src, spec: e.spec, kind: e.kind });
      }
      edges = edges.filter((e) => !removed.has(e.src) && !removed.has(e.dst));
      pending = pending.filter((p) => !removed.has(p.src));
      for (const p of removed) fileRows.delete(p);
    }

    const changedSet = new Set(changed);
    edges = edges.filter((e) => !changedSet.has(e.src));
    pending = pending.filter((p) => !changedSet.has(p.src));

    const link = (src: string, ref: ImportRef) => {
      const dst = resolveModule(cwd, src, ref.specifier, cache);
      if (dst && dst !== src) edges.push({ src, dst, kind: ref.kind, spec: ref.specifier });
      else if (!dst) pending.push({ src, spec: ref.specifier, kind: ref.kind });
    };

    for (const p of changed) {
      fileRows.set(p, onDisk.get(p)!);
      let content: string;
      try { content = readFileSync(path.join(cwd, p), "utf8"); } catch { continue; }
      for (const ref of extractImportsAuto(p, content)) link(p, ref);
    }

    // a file that appeared may be what an earlier-scanned import was pointing at
    // ponytail: retries every pending specifier of unchanged files (externals included);
    // index pending by basename if this ever shows up in a profile
    if (added.length) {
      const retry = pending.filter((p) => !changedSet.has(p.src));
      pending = pending.filter((p) => changedSet.has(p.src));
      for (const r of retry) link(r.src, { specifier: r.spec, kind: r.kind as ImportRef["kind"] });
    }

    this.setEdges(edges);
    this.setPending(pending);
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

  stats(): { files: number; edges: number; engine: "tree-sitter" | "regex" } {
    return { files: this.files().size, edges: this.edges().length, engine: graphEngine() };
  }

  rebuild(cwd: string): { scanned: number; changed: number } {
    this.setEdges([]);
    this.setPending([]);
    this.setFiles(new Map());
    this.db.save();
    return this.update(cwd);
  }

  close(): void {
    this.db.close();
  }
}
