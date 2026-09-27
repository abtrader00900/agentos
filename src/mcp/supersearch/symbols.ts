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

/**
 * One ast-grep rule per (language, definition node). Matching on the node
 * *kind* (not a textual pattern) means `if (x) { … }` can never come back as a
 * method, and the name is read from the node's `name` field.
 */
const byField = (kind: string) => `kind: ${kind}\n  has: { field: name, pattern: $NAME }`;
// grammars without a `name` field: the identifier that is a direct child
const byChild = (kind: string, child: string) => `kind: ${kind}\n  has: { kind: ${child}, pattern: $NAME, stopBy: neighbor }`;

// a definition directly or indirectly inside a class body is a method, anywhere else a function
const inClass = (cls: string) => `\n  inside: { kind: ${cls}, stopBy: end }`;
const notInClass = (cls: string) => `\n  not: { inside: { kind: ${cls}, stopBy: end } }`;

const RULES: { lang: string; kind: SymbolMatch["kind"]; rule: string }[] = [
  ...["TypeScript", "Tsx", "JavaScript"].flatMap((lang) => [
    { lang, kind: "function" as const, rule: byField("function_declaration") },
    { lang, kind: "function" as const, rule: byField("generator_function_declaration") },
    { lang, kind: "method" as const, rule: byField("method_definition") },
    { lang, kind: "class" as const, rule: byField("class_declaration") },
    ...(lang === "JavaScript" ? [] : [
      { lang, kind: "class" as const, rule: byField("abstract_class_declaration") },
      { lang, kind: "interface" as const, rule: byField("interface_declaration") },
    ]),
  ]),
  { lang: "Python", kind: "function", rule: byField("function_definition") + notInClass("class_definition") },
  { lang: "Python", kind: "method", rule: byField("function_definition") + inClass("class_definition") },
  { lang: "Python", kind: "class", rule: byField("class_definition") },
  { lang: "Php", kind: "function", rule: byField("function_definition") },
  { lang: "Php", kind: "method", rule: byField("method_declaration") },
  { lang: "Php", kind: "class", rule: byField("class_declaration") },
  { lang: "Php", kind: "class", rule: byField("trait_declaration") },
  { lang: "Php", kind: "class", rule: byField("enum_declaration") },
  { lang: "Php", kind: "interface", rule: byField("interface_declaration") },
  { lang: "Go", kind: "function", rule: byField("function_declaration") },
  { lang: "Go", kind: "method", rule: byField("method_declaration") },
  { lang: "Go", kind: "struct", rule: `kind: type_spec\n  all:\n    - has: { field: name, pattern: $NAME }\n    - has: { field: type, kind: struct_type }` },
  { lang: "Java", kind: "method", rule: byField("method_declaration") },
  { lang: "Java", kind: "method", rule: byField("constructor_declaration") },
  { lang: "Java", kind: "class", rule: byField("class_declaration") },
  { lang: "Java", kind: "class", rule: byField("enum_declaration") },
  { lang: "Java", kind: "class", rule: byField("record_declaration") },
  { lang: "Java", kind: "interface", rule: byField("interface_declaration") },
  { lang: "Kotlin", kind: "function", rule: byChild("function_declaration", "simple_identifier") + notInClass("class_body") },
  { lang: "Kotlin", kind: "method", rule: byChild("function_declaration", "simple_identifier") + inClass("class_body") },
  { lang: "Kotlin", kind: "class", rule: byChild("class_declaration", "type_identifier") },
  { lang: "Kotlin", kind: "class", rule: byChild("object_declaration", "type_identifier") },
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
  const max = opts.maxResults ?? 50;
  const nameFilter = opts.name ? new RegExp(opts.name, "i") : null;

  const rules = RULES.filter((r) => !opts.kind || r.kind === opts.kind);
  const kindOf = new Map(rules.map((r, i) => [`r${i}`, r.kind]));
  const yaml = rules
    .map((r, i) => `id: r${i}\nlanguage: ${r.lang}\nrule:\n  ${r.rule}`)
    .join("\n---\n");

  // one scan for every rule: ast-grep walks the tree once, respecting .gitignore
  const args = ["scan", "--inline-rules", yaml, "--json=compact"];
  // agents pass "./src/a.ts", "src\a.ts" or an absolute path — compare project-relative forward-slash paths
  const wantFile = opts.file ? path.relative(opts.cwd, path.resolve(opts.cwd, opts.file)).replace(/\\/g, "/") : undefined;
  if (opts.file) args.push(path.resolve(opts.cwd, opts.file));
  const r = spawnSync(binary, args, { cwd: opts.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (!r.stdout && r.status !== 0) throw new Error(`ast-grep failed: ${(r.stderr ?? "").trim() || `exit ${r.status}`}`);

  let items: unknown[];
  try {
    items = JSON.parse(r.stdout || "[]");
  } catch {
    throw new Error("ast-grep returned unreadable output");
  }
  if (!Array.isArray(items)) return [];

  const results: SymbolMatch[] = [];
  for (const raw of items) {
    const item = raw as {
      ruleId?: string;
      text?: string;
      file?: string;
      range?: { start?: { line?: number } };
      metaVariables?: { single?: Record<string, { text?: string }> };
    };
    const kind = kindOf.get(item.ruleId ?? "");
    const name = item.metaVariables?.single?.NAME?.text;
    if (!kind || !name) continue;
    if (nameFilter && !nameFilter.test(name)) continue;
    const rawFile = item.file ?? "";
    // ast-grep returns absolute paths when given an absolute path, relative otherwise
    const relFile = rawFile
      ? (path.isAbsolute(rawFile) ? path.relative(opts.cwd, rawFile) : rawFile).replace(/\\/g, "/")
      : (wantFile ?? "");
    if (wantFile !== undefined && relFile !== wantFile) continue;
    results.push({
      file: relFile,
      line: (item.range?.start?.line ?? 0) + 1,
      kind,
      name,
      signature: (item.text ?? "").split("\n")[0].slice(0, 200),
    });
  }
  return dedupe(results)
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
    .slice(0, max);
}

function dedupe(matches: SymbolMatch[]): SymbolMatch[] {
  const seen = new Set<string>();
  return matches.filter((m) => {
    // kind is part of the key: `class J { J() {} }` is a class AND a constructor on one line
    const k = `${m.file}:${m.line}:${m.kind}:${m.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
