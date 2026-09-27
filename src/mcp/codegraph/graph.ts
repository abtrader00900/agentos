import { readFileSync, readdirSync, statSync } from "node:fs";
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

const JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
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

  if (JS_EXTS.includes(ext)) {
    for (const m of content.matchAll(/import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)) push(m[1]);
    for (const m of content.matchAll(/export\s+(?:[^'"]*?\s+from\s+)['"]([^'"]+)['"]/g)) push(m[1]);
    for (const m of content.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) push(m[1], "require");
    for (const m of content.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) push(m[1]);
  } else if (ext === ".py") {
    for (const m of content.matchAll(/^\s*import\s+([\w.]+)/gm)) push(m[1]);
    for (const m of content.matchAll(/^\s*from\s+([\w.]*\w)\s+import\s+/gm)) push(m[1]);
    // from . import models, views — each name is a sibling module (or a symbol of the package)
    for (const m of content.matchAll(/^\s*from\s+(\.+)\s+import\s+\(?([\w\s,]+)/gm)) {
      for (const name of m[2].split(",").map((x) => x.trim().split(/\s+/)[0]).filter(Boolean)) push(m[1] + name);
    }
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

/**
 * Directory listings for one resolution pass: dir → (entry name → isDirectory).
 * update() hands the same map to every call, so resolving thousands of imports
 * costs one readdir per directory instead of a dozen existsSync calls per import.
 */
export type DirCache = Map<string, Map<string, boolean>>;

function listDir(dir: string, cache?: DirCache): Map<string, boolean> {
  let names = cache?.get(dir);
  if (!names) {
    names = new Map();
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) names.set(e.name, e.isDirectory());
    } catch { /* missing or unreadable: empty */ }
    cache?.set(dir, names);
  }
  return names;
}

/**
 * Entry type at `abs` with its exact on-disk spelling, or undefined.
 * existsSync is case-insensitive on Windows and default macOS volumes, so
 * "App/Models/X.php" reports found when only "app/Models/X.php" exists — and
 * the wrong-case edge never matches the real file key.
 */
function entryAt(cwd: string, abs: string, cache?: DirCache): "file" | "dir" | undefined {
  const rel = path.relative(cwd, abs);
  if (!rel) return "dir";
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    // outside the project: nothing to compare the spelling against
    try { return statSync(abs).isDirectory() ? "dir" : "file"; } catch { return undefined; }
  }
  let dir = cwd;
  let isDir: boolean | undefined;
  for (const seg of rel.split(path.sep)) {
    isDir = listDir(dir, cache).get(seg);
    if (isDir === undefined) return undefined;
    dir = path.join(dir, seg);
  }
  return isDir ? "dir" : "file";
}

/** Java/Kotlin source roots for an importer: its own module's main/test roots first, then common layouts. */
function javaRoots(importerRel: string): string[] {
  const roots = ["", "src", "src/main/java", "src/main/kotlin", "app/src/main/java", "app/src/main/kotlin"];
  const m = importerRel.match(/^(.*?)src\/(?:main|test)\/(?:java|kotlin)\//);
  if (!m) return roots;
  const mod = m[1];
  return [...["main/java", "main/kotlin", "test/java", "test/kotlin"].map((s) => `${mod}src/${s}`), ...roots];
}

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

  // Python relative: "from .x import y" / "from .. import z" — each extra dot walks up one package.
  // `from . import name` arrives as ".name": a sibling module, or else a symbol of the package itself.
  if (lang === ".py") {
    const m = specifier.match(/^(\.+)(.*)$/);
    if (m) {
      let base = importerDir;
      for (let i = 1; i < m[1].length; i++) base = path.dirname(base);
      const parts = m[2] ? m[2].split(".") : [];
      for (let n = parts.length; n >= 0; n--) {
        const r = tryAt(path.join(base, ...parts.slice(0, n)));
        if (r) return r;
      }
      return null;
    }
  }

  // dotted packages: Python "a.b.c", Java/Kotlin "com.x.Foo" ("com.x.Foo.CONST" → drop the member)
  if ([".py", ".java", ".kt"].includes(lang) && specifier.includes(".") && !specifier.includes("/")) {
    const parts = specifier.split(".");
    const roots = lang === ".py" ? ["", "src"] : javaRoots(importerRel);
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

/** go.mod lookups for one resolution pass: dir → the nearest go.mod's { dir, module }, or null. */
export type GoModCache = Map<string, { dir: string; module: string } | null>;

function nearestGoMod(cwd: string, fromDir: string, cache: GoModCache): { dir: string; module: string } | null {
  if (cache.has(fromDir)) return cache.get(fromDir)!;
  let found: { dir: string; module: string } | null = null;
  let text: string | null = null;
  try { text = readFileSync(path.join(fromDir, "go.mod"), "utf8"); } catch { /* none here */ }
  const m = text?.match(/^\s*module\s+(\S+)/m);
  if (m) found = { dir: fromDir, module: m[1] };
  else {
    const parent = path.dirname(fromDir);
    if (parent !== fromDir && !path.relative(cwd, parent).startsWith("..")) found = nearestGoMod(cwd, parent, cache);
  }
  cache.set(fromDir, found);
  return found;
}

/**
 * Every file an import points at. A Go import names a package — a directory — so it
 * links to each non-test .go file in it; everything else resolves to one file.
 */
export function resolveTargets(cwd: string, importerRel: string, specifier: string, cache?: DirCache, goMods: GoModCache = new Map()): string[] {
  if (path.extname(importerRel) === ".go") {
    const importerDir = path.dirname(path.join(cwd, importerRel));
    let dir: string | null = null;
    if (specifier.startsWith("./") || specifier.startsWith("../")) dir = path.resolve(importerDir, specifier);
    else {
      const mod = nearestGoMod(cwd, importerDir, goMods);
      if (mod && (specifier === mod.module || specifier.startsWith(mod.module + "/"))) {
        dir = path.join(mod.dir, specifier.slice(mod.module.length));
      }
    }
    if (!dir || entryAt(cwd, dir, cache) !== "dir") return [];
    const pkgDir = dir;
    return [...listDir(pkgDir, cache)]
      .filter(([name, isDir]) => !isDir && name.endsWith(".go") && !name.endsWith("_test.go"))
      .map(([name]) => path.relative(cwd, path.join(pkgDir, name)).replace(/\\/g, "/"))
      .sort();
  }
  const one = resolveModule(cwd, importerRel, specifier, cache);
  return one ? [one] : [];
}

const TS_FOR_JS: Record<string, string[]> = {
  ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"],
};

function resolveAsFileOrDir(cwd: string, base: string, exts: string[], rel: (p: string) => string, cache?: DirCache): string | null {
  const at = (p: string) => entryAt(cwd, p, cache);
  const ext = path.extname(base);
  if (ext && at(base) === "file") return rel(base);
  // ESM TypeScript writes `import "./x.js"` for x.ts
  if (TS_FOR_JS[ext]) {
    const stem = base.slice(0, -ext.length);
    for (const e of TS_FOR_JS[ext]) if (at(stem + e) === "file") return rel(stem + e);
  }
  for (const e of exts) {
    if (at(base + e) === "file") return rel(base + e);
  }
  if (at(base) === "dir") {
    const indexes = exts.includes(".py")
      ? ["__init__.py"]
      : exts.filter((e) => JS_EXTS.includes(e)).map((e) => "index" + e);
    for (const name of indexes) {
      if (at(path.join(base, name)) === "file") return rel(path.join(base, name));
    }
  }
  return null;
}

// ---------- scanning ----------

/** skipped at any depth */
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "vendor", "coverage", "out", "target", "__pycache__",
]);
/** Laravel's runtime dirs — only at the project root; src/storage or lib/bootstrap are real code */
const SKIP_ROOT_DIRS = new Set(["storage", "bootstrap"]);

export function scanProject(cwd: string): Map<string, number> {
  const files = new Map<string, number>();
  const walk = (dir: string, rel: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || (!rel && SKIP_ROOT_DIRS.has(e.name))) continue;
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
    const goMods: GoModCache = new Map();
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
    const stats = changed.length;

    // A Go import links to every file of the package: a file added to (or removed from)
    // that directory changes the importer's edges, so re-extract those importers too.
    const goDirs = new Set([...added, ...removed].filter((p) => p.endsWith(".go")).map((p) => path.posix.dirname(p)));
    if (goDirs.size) {
      const relink = new Set(edges.filter((e) => e.dst.endsWith(".go") && goDirs.has(path.posix.dirname(e.dst))).map((e) => e.src));
      for (const src of relink) if (onDisk.has(src) && !changed.includes(src)) changed.push(src);
    }

    const reopened = new Set<PendingRow>();
    if (removed.size) {
      // edges into a removed file go back to pending so a rename/restore re-links them
      for (const e of edges) {
        if (removed.has(e.dst) && !removed.has(e.src) && e.spec) {
          const row = { src: e.src, spec: e.spec, kind: e.kind };
          pending.push(row);
          reopened.add(row);
        }
      }
      edges = edges.filter((e) => !removed.has(e.src) && !removed.has(e.dst));
      pending = pending.filter((p) => !removed.has(p.src));
      for (const p of removed) fileRows.delete(p);
    }

    const changedSet = new Set(changed);
    edges = edges.filter((e) => !changedSet.has(e.src));
    pending = pending.filter((p) => !changedSet.has(p.src));

    const link = (src: string, ref: ImportRef) => {
      const dsts = resolveTargets(cwd, src, ref.specifier, cache, goMods).filter((d) => d !== src);
      for (const dst of dsts) edges.push({ src, dst, kind: ref.kind, spec: ref.specifier });
      if (!dsts.length) pending.push({ src, spec: ref.specifier, kind: ref.kind });
    };

    for (const p of changed) {
      fileRows.set(p, onDisk.get(p)!);
      let content: string;
      try { content = readFileSync(path.join(cwd, p), "utf8"); } catch { continue; }
      for (const ref of extractImportsAuto(p, content)) link(p, ref);
    }

    // A file that appeared may be what an earlier-scanned import was pointing at, and a
    // removed one may have been shadowing another candidate (b.ts gone, b/index.ts left).
    // Only imports that could name an added file or directory are retried — "react",
    // "zod" and friends stay pending without being probed on every file add.
    if (added.length || reopened.size) {
      const tokens = (s: string) => s.toLowerCase().split(/[\\/.:]+/).filter(Boolean);
      const addedNames = new Set(added.flatMap((p) => {
        const parts = p.toLowerCase().split("/");
        const file = parts.pop()!;
        return [...parts, file.replace(/\.[^.]+$/, "")];
      }));
      const mayResolve = (p: PendingRow) => reopened.has(p) || tokens(p.spec).some((t) => addedNames.has(t));
      const retry = pending.filter((p) => !changedSet.has(p.src) && mayResolve(p));
      const retrySet = new Set(retry);
      pending = pending.filter((p) => !retrySet.has(p));
      for (const r of retry) link(r.src, { specifier: r.spec, kind: r.kind as ImportRef["kind"] });
    }

    this.setEdges(edges);
    this.setPending(pending);
    this.setFiles(fileRows);
    this.db.save();
    return { scanned: onDisk.size, changed: stats };
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
