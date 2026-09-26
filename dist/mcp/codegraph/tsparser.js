/**
 * Issue #4: tree-sitter (WASM) import-extraction backend for codegraph.
 *
 * web-tree-sitter + tree-sitter-wasms prebuilt grammars — pure WASM,
 * zero native dependencies (npm install never compiles anything).
 * When unavailable, graph.ts transparently falls back to regex extraction.
 */
import { createRequire } from "node:module";
import path from "node:path";
const require2 = createRequire(import.meta.url);
const GRAMMAR_BY_EXT = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".php": "php",
    ".go": "go",
    ".java": "java",
    ".kt": "kotlin",
};
let active = false;
let failed = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ParserCtor = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const languages = new Map();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parsers = new Map();
/** Load the runtime + all available grammars. Safe to call repeatedly. */
export async function initTreeSitter() {
    if (active)
        return true;
    if (failed)
        return false;
    try {
        const mod = await import("web-tree-sitter");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ParserCtor = mod.default ?? mod;
        const pkgRoot = path.dirname(require2.resolve("web-tree-sitter"));
        await ParserCtor.init({ locateFile: (f) => path.join(pkgRoot, f) });
        for (const g of new Set(Object.values(GRAMMAR_BY_EXT))) {
            try {
                const wasmPath = require2.resolve(`tree-sitter-wasms/out/tree-sitter-${g}.wasm`);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                languages.set(g, await ParserCtor.Language.load(wasmPath));
            }
            catch {
                // grammar pack missing — that language falls back to regex
            }
        }
        active = languages.size > 0;
        if (!active)
            failed = true;
    }
    catch {
        failed = true;
        active = false;
    }
    return active;
}
export function treeSitterActive() {
    return active;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parserFor(ext) {
    const g = GRAMMAR_BY_EXT[ext];
    if (!g)
        return null;
    let p = parsers.get(g);
    if (!p) {
        const lang = languages.get(g);
        if (!lang)
            return null;
        p = new ParserCtor();
        p.setLanguage(lang);
        parsers.set(g, p);
    }
    return p;
}
// ---------- AST helpers ----------
function descendants(n, pred) {
    const out = [];
    const stack = [...n.namedChildren];
    while (stack.length) {
        const c = stack.pop();
        if (pred(c))
            out.push(c);
        stack.push(...c.namedChildren);
    }
    return out;
}
/** First direct child whose type looks like a string literal. */
function firstStringChild(n) {
    for (const c of n.children) {
        if (c.type.includes("string"))
            return c.text;
    }
    return null;
}
function stripQuotes(s) {
    return s.trim().replace(/^['"`]/, "").replace(/['"`]$/, "").replace(/;$/, "").trim();
}
function nodeSpecifiers(n) {
    switch (n.type) {
        // --- TS/JS/TSX ---
        case "import_statement": {
            const out = [];
            const s = firstStringChild(n);
            if (s)
                out.push([stripQuotes(s), "import"]); // TS/JS source
            for (const d of descendants(n, (c) => c.type === "dotted_name")) {
                out.push([d.text, "import"]); // Python: import a.b, import a.b as c
            }
            return out.length ? out : null;
        }
        case "export_statement": {
            const s = firstStringChild(n); // re-export: export { x } from "./y"
            return s ? [[stripQuotes(s), "import"]] : null;
        }
        case "call_expression": {
            const fn = n.namedChildren[0]?.text;
            if (fn !== "require" && fn !== "import")
                return null; // import() = dynamic import
            const s = descendants(n, (c) => c.type.includes("string"))[0];
            return s ? [[stripQuotes(s.text), fn === "require" ? "require" : "import"]] : null;
        }
        // --- Python ---
        case "import_from_statement": {
            // only the module part BEFORE the "import" keyword;
            // names after it (from a.b import Name) are not modules
            const kw = n.children.find((c) => c.type === "import");
            const cutoff = kw ? kw.startIndex : Number.POSITIVE_INFINITY;
            const rel = descendants(n, (c) => c.type === "relative_import" && c.startIndex < cutoff)[0];
            const dotted = descendants(n, (c) => c.type === "dotted_name" && c.startIndex < cutoff)[0];
            if (dotted) {
                const spec = rel && !rel.text.endsWith(dotted.text) ? rel.text + dotted.text : (rel?.text ?? dotted.text);
                return [[spec, "import"]];
            }
            return rel ? [[rel.text, "import"]] : null;
        }
        // --- PHP ---
        case "namespace_use_declaration": {
            const out = [];
            const clauses = descendants(n, (c) => c.type === "namespace_use_clause");
            for (const clause of clauses) {
                const qn = descendants(clause, (c) => c.type === "qualified_name")[0];
                out.push([qn ? qn.text : clause.text, "import"]); // use App\Models\User; use function App\helpers\foo;
            }
            if (!out.length) {
                for (const qn of descendants(n, (c) => c.type === "qualified_name")) {
                    out.push([qn.text, "import"]);
                }
            }
            return out.length ? out : null;
        }
        case "require_expression":
        case "require_once_expression":
        case "include_expression":
        case "include_once_expression": {
            const s = firstStringChild(n);
            return s ? [[stripQuotes(s), "require"]] : null;
        }
        // --- Go + Java (both grammars use "import_declaration") ---
        case "import_declaration": {
            const strs = descendants(n, (c) => c.type.includes("string_literal")); // Go: "fmt"
            if (strs.length)
                return strs.map((s) => [stripQuotes(s.text), "import"]);
            const id = // Java: scoped_identifier
             descendants(n, (c) => c.type === "scoped_identifier")[0] ??
                descendants(n, (c) => c.type === "identifier")[0];
            return id ? [[id.text.replace(/\.\*$/, ""), "import"]] : null;
        }
        // --- Kotlin ---
        case "import_header": {
            const id = descendants(n, (c) => c.type === "identifier")[0];
            return id ? [[id.text.replace(/\.\*$/, ""), "import"]] : null;
        }
        default:
            return null;
    }
}
/**
 * Extract import refs via tree-sitter. Returns null when the engine is
 * unavailable or the file has no grammar — caller falls back to regex.
 */
export function extractWithTreeSitter(filePath, content) {
    if (!active)
        return null;
    const parser = parserFor(path.extname(filePath));
    if (!parser)
        return null;
    let root;
    try {
        root = parser.parse(content).rootNode;
    }
    catch {
        return null;
    }
    const refs = [];
    const seen = new Set();
    const push = (specifier, kind) => {
        const s = specifier.trim();
        if (s && !seen.has(kind + s)) {
            seen.add(kind + s);
            refs.push({ specifier: s, kind });
        }
    };
    const stack = [...root.namedChildren];
    while (stack.length) {
        const n = stack.pop();
        const specs = nodeSpecifiers(n);
        if (specs)
            for (const [s, k] of specs)
                push(s, k);
        stack.push(...n.namedChildren);
    }
    return refs;
}
//# sourceMappingURL=tsparser.js.map