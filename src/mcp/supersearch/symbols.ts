import { spawnSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * FR-4.2: symbol search via ast-grep (prebuilt binary, no API).
 * Resolves the platform binary shipped with @ast-grep/cli.
 */

export interface SymbolMatch {
  file: string;
  line: number;
  kind: "function" | "class" | "method" | "interface" | "struct";
  name: string;
  signature: string;
}

let cachedBinary: string | null | undefined;

export function astGrepBinary(): string | null {
  if (cachedBinary !== undefined) return cachedBinary;
  cachedBinary = null;
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve("@ast-grep/cli/package.json");
    const scopeDir = path.dirname(path.dirname(pkgJson)); // node_modules/@ast-grep
    for (const dir of readdirSync(scopeDir)) {
      const candidate = path.join(scopeDir, dir, process.platform === "win32" ? "ast-grep.exe" : "ast-grep");
      if (existsSync(candidate)) {
        cachedBinary = candidate;
        break;
      }
    }
  } catch {
    // not installed — symbol search unavailable
  }
  return cachedBinary;
}

// per-language definition patterns for ast-grep
const PATTERNS: { kind: SymbolMatch["kind"]; langs: string[]; pattern: string }[] = [
  { kind: "function", langs: ["ts", "tsx", "js", "jsx", "mjs", "cjs"], pattern: "function $NAME($$$)" },
  { kind: "method", langs: ["ts", "tsx", "js", "jsx"], pattern: "$NAME($$$) { $$$ }" },
  { kind: "class", langs: ["ts", "tsx", "js", "jsx", "py", "php", "java", "kt"], pattern: "class $NAME { $$$ }" },
  { kind: "interface", langs: ["ts", "tsx"], pattern: "interface $NAME { $$$ }" },
  { kind: "function", langs: ["py"], pattern: "def $NAME($$$):" },
  { kind: "class", langs: ["py"], pattern: "class $NAME($$$):" },
  { kind: "function", langs: ["php"], pattern: "function $NAME($$$) { $$$ }" },
  { kind: "function", langs: ["go"], pattern: "func $NAME($$$) { $$$ }" },
  { kind: "struct", langs: ["go"], pattern: "type $NAME struct { $$$ }" },
  { kind: "function", langs: ["java", "kt"], pattern: "fun $NAME($$$) { $$$ }" },
  { kind: "class", langs: ["java"], pattern: "class $NAME { $$$ }" },
];

export interface SymbolSearchOptions {
  cwd: string;
  name?: string;
  kind?: SymbolMatch["kind"];
  file?: string; // restrict to one file
  maxResults?: number;
}

export function searchSymbols(opts: SymbolSearchOptions): SymbolMatch[] {
  const binary = astGrepBinary();
  if (!binary) throw new Error("ast-grep binary not found. Run: npm install @ast-grep/cli");
  const results: SymbolMatch[] = [];
  const max = opts.maxResults ?? 50;
  const nameFilter = opts.name ? new RegExp(opts.name, "i") : null;

  for (const p of PATTERNS) {
    if (results.length >= max) break;
    if (opts.kind && p.kind !== opts.kind) continue;
    const args = ["run", "--pattern", p.pattern, "--json=compact"];
    if (opts.file) args.push(path.resolve(opts.cwd, opts.file));
    const r = spawnSync(binary, args, { cwd: opts.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0 || !r.stdout) continue;
    let items: unknown[];
    try {
      items = JSON.parse(r.stdout);
    } catch {
      continue;
    }
    if (!Array.isArray(items)) continue;
    for (const raw of items) {
      if (results.length >= max) break;
      const item = raw as {
        text?: string;
        file?: string;
        range?: { start?: { line?: number } };
        metaVariables?: { single?: Record<string, { text?: string }> };
      };
      const meta = item.metaVariables?.single?.NAME?.text ?? extractName(item.text ?? "");
      if (!meta) continue;
      if (nameFilter && !nameFilter.test(meta)) continue;
      const rawFile = item.file ?? "";
      // ast-grep returns absolute paths when given an absolute path, relative otherwise
      const relFile = rawFile
        ? (path.isAbsolute(rawFile)
            ? path.relative(opts.cwd, rawFile)
            : rawFile).replace(/\\/g, "/")
        : (opts.file ?? "");
      if (opts.file && relFile !== opts.file.replace(/\\/g, "/")) continue;
      results.push({
        file: relFile,
        line: (item.range?.start?.line ?? 0) + 1,
        kind: p.kind,
        name: meta,
        signature: (item.text ?? "").split("\n")[0].slice(0, 200),
      });
    }
  }
  return dedupe(results).slice(0, max);
}

function extractName(text: string): string | null {
  const m = text.match(/(?:function|class|interface|def|func|type|fun)\s+([A-Za-z_$][\w$]*)/);
  return m ? m[1] : null;
}

function dedupe(matches: SymbolMatch[]): SymbolMatch[] {
  const seen = new Set<string>();
  return matches.filter((m) => {
    const k = `${m.file}:${m.line}:${m.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
