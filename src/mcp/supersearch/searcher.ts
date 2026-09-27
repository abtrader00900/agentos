import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * FR-4.1/4.5/4.6: text search.
 * Uses ripgrep when available on PATH; falls back to a built-in scanner.
 * Both honor .gitignore, skip hidden and binary files, and return the same shape.
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
  "node_modules", "dist", "build", "vendor", "coverage", "out", "target", "__pycache__",
]);

const MAX_FILE_BYTES = 512 * 1024;
/** one minified line must not dump hundreds of KB into the model's context */
const MAX_LINE_CHARS = 500;

function isBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * glob → regex source: `**` spans directories, `*` and `?` stay inside one path
 * segment, `[abc]` is a character class, `{a,b}` an alternation.
 */
export function globToRegex(glob: string): string {
  let out = "";
  let braces = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        out += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (c === "[") {
      const end = glob.indexOf("]", i + 2);
      if (end < 0) { out += "\\["; continue; }
      const body = glob.slice(i + 1, end).replace(/^!/, "^").replace(/\\/g, "\\\\");
      out += `[${body}]`;
      i = end;
    } else if (c === "{") { out += "(?:"; braces++; }
    else if (c === "}" && braces) { out += ")"; braces--; }
    else if (c === "," && braces) out += "|";
    else if (c === "\\" && i + 1 < glob.length) out += "\\" + glob[++i];
    else out += /[.+^$()|\]\\]/.test(c) ? "\\" + c : c;
  }
  return out;
}

interface IgnoreRule {
  /** directory (project-relative, "" = root) whose .gitignore declared the rule */
  base: string;
  rx: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

function readIgnoreFile(dir: string, base: string): IgnoreRule[] {
  const file = path.join(dir, ".gitignore");
  if (!existsSync(file)) return [];
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { return []; }
  const rules: IgnoreRule[] = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/(?<!\\)\s+$/, "");
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith("/");
    line = line.replace(/\/+$/, "");
    // a slash anywhere but the end anchors the pattern to its .gitignore's directory;
    // otherwise it matches a name at any depth ("*.log" also ignores sub/x.log)
    const anchored = line.includes("/");
    const g = globToRegex(line.replace(/^\//, ""));
    rules.push({ base, rx: new RegExp((anchored ? "^" : "(?:^|/)") + g + "$"), negate, dirOnly });
  }
  return rules;
}

/** gitignore semantics: rules apply in order (outer files first), the last match wins. */
function isIgnored(rules: IgnoreRule[], rel: string, isDir: boolean): boolean {
  let ignored = false;
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    if (r.base && !rel.startsWith(r.base + "/")) continue;
    const sub = r.base ? rel.slice(r.base.length + 1) : rel;
    if (r.rx.test(sub)) ignored = !r.negate;
  }
  return ignored;
}

let rgCached: boolean | undefined;
/** ripgrep >= 13 (has --no-require-git); an older rg falls back to the builtin scanner */
function rgAvailable(): boolean {
  if (rgCached === undefined) rgCached = spawnSync("rg", ["--no-require-git", "--version"], { stdio: "ignore" }).status === 0;
  return rgCached;
}

/** rg prints "./a/b.ts" (".\a\b.ts" on Windows); the builtin prints "a/b.ts" — make them identical */
const normalizePath = (f: string) => f.replace(/\\/g, "/").replace(/^\.\//, "");
/** agents on Windows write globs with backslashes; globs are always "/"-separated */
const normalizeGlob = (g: string) => g.replace(/\\/g, "/");

function searchWithRg(opts: TextSearchOptions): SearchMatch[] {
  const max = opts.maxResults ?? 100;
  const args = [
    "--line-number", "--no-heading", "--color=never", "--no-require-git",
    "--crlf", // "$" matches before \r\n, so anchored patterns work on CRLF files
    "--max-count", String(max), // per file; the total is capped below
    ...(opts.caseSensitive ? [] : ["--ignore-case"]),
    ...(opts.glob ? ["--glob", normalizeGlob(opts.glob)] : []),
    "--", opts.pattern, ".",
  ];
  const r = spawnSync("rg", args, { cwd: opts.cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  // exit 1 = no matches; 2 = bad regex / IO error, which the caller must see
  if (r.status === 2) throw new Error(`ripgrep: ${(r.stderr ?? "").trim() || "search failed"}`);
  return (r.stdout ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      // "." does not match "\r" in JS — a CRLF file's lines used to fail this regex and vanish
      const m = l.replace(/\r$/, "").match(/^(.+?):(\d+):(.*)$/);
      return m ? { file: normalizePath(m[1]), line: parseInt(m[2], 10), text: m[3].slice(0, MAX_LINE_CHARS) } : null;
    })
    .filter((x): x is SearchMatch => x !== null)
    .slice(0, max);
}

export function searchTextBuiltin(opts: TextSearchOptions): SearchMatch[] {
  const rx = new RegExp(opts.pattern, opts.caseSensitive ? "" : "i");
  // "*.ts" matches a file name; "app/**" matches the path relative to the project; "!x" excludes
  const rawGlob = opts.glob ? normalizeGlob(opts.glob) : undefined;
  const negated = !!rawGlob?.startsWith("!");
  const glob = negated ? rawGlob!.slice(1) : rawGlob;
  const globRx = glob ? new RegExp("^" + globToRegex(glob) + "$") : null;
  const globMatches = (rel: string) =>
    !globRx || globRx.test(glob!.includes("/") ? rel : path.basename(rel)) !== negated;
  const results: SearchMatch[] = [];
  const max = opts.maxResults ?? 100;

  const walk = (dir: string, rel: string, rules: IgnoreRule[]) => {
    if (results.length >= max) return;
    const here = [...rules, ...readIgnoreFile(dir, rel)];
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= max) return;
      if (e.name.startsWith(".")) continue; // hidden files and dirs, like rg's default
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || isIgnored(here, r, true)) continue;
        walk(path.join(dir, e.name), r, here);
      } else if (e.isFile()) {
        if (isIgnored(here, r, false) || !globMatches(r)) continue;
        let buf: Buffer;
        try {
          if (statSync(path.join(dir, e.name)).size > MAX_FILE_BYTES) continue;
          buf = readFileSync(path.join(dir, e.name));
        } catch { continue; }
        if (isBinary(buf)) continue;
        const lines = buf.toString("utf8").split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= max) return;
          if (rx.test(lines[i])) results.push({ file: r, line: i + 1, text: lines[i].slice(0, MAX_LINE_CHARS) });
        }
      }
    }
  };
  walk(opts.cwd, "", []);
  return results;
}

export function searchText(opts: TextSearchOptions): SearchMatch[] {
  return rgAvailable() ? searchWithRg(opts) : searchTextBuiltin(opts);
}
