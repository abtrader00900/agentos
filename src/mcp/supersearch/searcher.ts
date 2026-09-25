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

function parseGitignore(cwd: string): ((rel: string) => boolean)[] {
  const gi = path.join(cwd, ".gitignore");
  if (!existsSync(gi)) return [];
  return readFileSync(gi, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"))
    .map((l) => {
      const dirOnly = l.endsWith("/");
      const clean = l.replace(/^\//, "").replace(/\/$/, "");
      const rx = new RegExp(
        "^" + clean.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + (dirOnly ? "(/|$)" : "$"),
      );
      return (rel: string) => rx.test(rel);
    });
}

function rgAvailable(): boolean {
  const r = spawnSync("rg", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

function searchWithRg(opts: TextSearchOptions): SearchMatch[] {
  const args = [
    "--line-number", "--no-heading", "--color=never",
    "--max-count", String(opts.maxResults ?? 100),
    ...(opts.caseSensitive ? [] : ["--ignore-case"]),
    ...(opts.glob ? ["--glob", opts.glob] : []),
    "--", opts.pattern, ".",
  ];
  const r = spawnSync("rg", args, { cwd: opts.cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 && !r.stdout) return [];
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^([^:]+):(\d+):(.*)$/);
      if (!m) return null;
      return { file: m[1], line: parseInt(m[2], 10), text: m[3] };
    })
    .filter((x): x is SearchMatch => x !== null);
}

function searchBuiltin(opts: TextSearchOptions): SearchMatch[] {
  const ignores = parseGitignore(opts.cwd);
  const rx = new RegExp(opts.pattern, opts.caseSensitive ? "" : "i");
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
        if (opts.glob && !globMatch(opts.glob, e.name)) continue;
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

function globMatch(glob: string, name: string): boolean {
  const rx = new RegExp("^" + glob.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return rx.test(name);
}

export function searchText(opts: TextSearchOptions): SearchMatch[] {
  return rgAvailable() ? searchWithRg(opts) : searchBuiltin(opts);
}
