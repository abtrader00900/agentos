import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * FR-4.1/4.5/4.6: text search.
 * Uses ripgrep when available on PATH; falls back to a built-in scanner.
 * Honors .gitignore basics and skips binary files either way.
 */

export interface TextSearchOptions {
  cwd: string;
  pattern: string;
  glob?: string;
  caseSensitive?: boolean;
  maxResults?: number;
  context?: number; // lines of context around match
}

export interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "vendor", ".next", ".cache",
  "coverage", "out", ".agentos", "target", "__pycache__", ".idea", ".vscode",
]);

const MAX_FILE_BYTES = 512 * 1024;

function isBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

/** glob → regex source: `**` spans directories, `*` and `?` stay inside one path segment */
function globToRegex(glob: string): string {
  return glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
}

function parseGitignore(cwd: string): ((rel: string) => boolean)[] {
  const gi = path.join(cwd, ".gitignore");
  if (!existsSync(gi)) return [];
  return readFileSync(gi, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"))
    .map((l) => {
      // gitignore: a pattern with a slash is anchored to the root, one without matches at any
      // depth ("*.log" also ignores sub/x.log); either way the match covers everything below it
      const clean = l.replace(/\/$/, "");
      const anchored = clean.includes("/");
      const rx = new RegExp((anchored ? "^" : "(?:^|/)") + globToRegex(clean.replace(/^\//, "")) + "(?:/|$)");
      return (rel: string) => rx.test(rel);
    });
}

let rgCached: boolean | undefined;
/** ripgrep >= 13 (has --no-require-git); an older rg falls back to the builtin scanner */
function rgAvailable(): boolean {
  if (rgCached === undefined) rgCached = spawnSync("rg", ["--no-require-git", "--version"], { stdio: "ignore" }).status === 0;
  return rgCached;
}

/** rg prints "./a/b.ts" (".\a\b.ts" on Windows); the builtin prints "a/b.ts" — make them identical */
const normalizePath = (f: string) => f.replace(/\\/g, "/").replace(/^\.\//, "");

function searchWithRg(opts: TextSearchOptions): SearchMatch[] {
  const max = opts.maxResults ?? 100;
  const args = [
    "--line-number", "--no-heading", "--color=never", "--no-require-git",
    "--max-count", String(max), // per file; the total is capped below
    ...(opts.caseSensitive ? [] : ["--ignore-case"]),
    ...(opts.glob ? ["--glob", opts.glob] : []),
    "--", opts.pattern, ".",
  ];
  const r = spawnSync("rg", args, { cwd: opts.cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  // exit 1 = no matches; 2 = bad regex / IO error, which the caller must see
  if (r.status === 2) throw new Error(`ripgrep: ${(r.stderr ?? "").trim() || "search failed"}`);
  return (r.stdout ?? "")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(.+?):(\d+):(.*)$/);
      return m ? { file: normalizePath(m[1]), line: parseInt(m[2], 10), text: m[3] } : null;
    })
    .filter((x): x is SearchMatch => x !== null)
    .slice(0, max);
}

export function searchTextBuiltin(opts: TextSearchOptions): SearchMatch[] {
  const ignores = parseGitignore(opts.cwd);
  const rx = new RegExp(opts.pattern, opts.caseSensitive ? "" : "i");
  // "*.ts" matches a file name; "app/**" matches the path relative to the project
  const globRx = opts.glob ? new RegExp("^" + globToRegex(opts.glob) + "$") : null;
  const globMatches = (rel: string) => !globRx || globRx.test(opts.glob!.includes("/") ? rel : path.basename(rel));
  const results: SearchMatch[] = [];
  const max = opts.maxResults ?? 100;

  const walk = (dir: string, rel: string) => {
    if (results.length >= max) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= max) return;
      if (e.name.startsWith(".") && e.name !== ".env.example") {
        if (e.name === ".git" || e.isDirectory()) continue;
      }
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || ignores.some((f) => f(r))) continue;
        walk(path.join(dir, e.name), r);
      } else if (e.isFile()) {
        if (ignores.some((f) => f(r))) continue;
        if (!globMatches(r)) continue;
        let buf: Buffer;
        try {
          if (statSync(path.join(dir, e.name)).size > MAX_FILE_BYTES) continue;
          buf = readFileSync(path.join(dir, e.name));
        } catch { continue; }
        if (isBinary(buf)) continue;
        const lines = buf.toString("utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= max) return;
          if (rx.test(lines[i])) results.push({ file: r, line: i + 1, text: lines[i].slice(0, 500) });
        }
      }
    }
  };
  walk(opts.cwd, "");
  return results;
}

export function searchText(opts: TextSearchOptions): SearchMatch[] {
  return rgAvailable() ? searchWithRg(opts) : searchTextBuiltin(opts);
}
