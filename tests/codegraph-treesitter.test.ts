import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initTreeSitter, extractWithTreeSitter } from "../src/mcp/codegraph/tsparser.js";
import { extractImports, GraphStore, ensureGraphEngine, graphEngine } from "../src/mcp/codegraph/graph.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "agentos-ts-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("tree-sitter engine (Issue #4)", () => {
  it("initializes with prebuilt grammars", async () => {
    expect(await initTreeSitter()).toBe(true);
    expect(graphEngine()).toBe("tree-sitter");
  });

  it("TS: imports, type imports, re-exports, require, dynamic import", async () => {
    await initTreeSitter();
    const src = [
      `import { a } from "./a";`,
      `import type { B } from "./b";`,
      `export { c } from "./c";`,
      `const d = require("./d");`,
      `const e = import("./e");`,
      `import {\n  f,\n} from "./f";`,
    ].join("\n");
    const specs = extractWithTreeSitter("x.ts", src)!.map((r) => r.specifier).sort();
    expect(specs).toEqual(["./a", "./b", "./c", "./d", "./e", "./f"]);
    const kinds = Object.fromEntries(extractWithTreeSitter("x.ts", src)!.map((r) => [r.specifier, r.kind]));
    expect(kinds["./d"]).toBe("require");
    expect(kinds["./e"]).toBe("import");
  });

  it("Python: import / from-import, no name noise", async () => {
    await initTreeSitter();
    const src = `import os\nimport numpy as np\nfrom .models import User\nfrom app.services.invoice import calc\nimport a.b.c`;
    const specs = extractWithTreeSitter("x.py", src)!.map((r) => r.specifier);
    expect(specs).toContain("os");
    expect(specs).toContain("numpy");
    expect(specs).toContain("a.b.c");
    expect(specs).toContain("app.services.invoice");
    expect(specs).toContain(".models");
    expect(specs).not.toContain("User");
    expect(specs).not.toContain("calc");
  });

  it("PHP: use, use function, aliases, require/include", async () => {
    await initTreeSitter();
    const src = `<?php\nuse App\\Models\\User;\nuse function App\\helpers\\foo;\nuse Illuminate\\Support\\Collection as C;\nrequire_once "lib/legacy.php";\ninclude "tpl/header.php";`;
    const refs = extractWithTreeSitter("x.php", src)!;
    const specs = refs.map((r) => r.specifier);
    expect(specs).toContain("App\\Models\\User");
    expect(specs).toContain("App\\helpers\\foo"); // regex backend misses this
    expect(specs).toContain("Illuminate\\Support\\Collection");
    expect(specs).toContain("lib/legacy.php");
    expect(refs.find((r) => r.specifier === "lib/legacy.php")?.kind).toBe("require");
  });

  it("Go/Java/Kotlin import forms", async () => {
    await initTreeSitter();
    expect(extractWithTreeSitter("x.go", `import (\n  "fmt"\n  "github.com/x/y"\n)`)!.map(r=>r.specifier).sort()).toEqual(["fmt", "github.com/x/y"]);
    expect(extractWithTreeSitter("x.java", `import java.util.List;\nimport com.app.Model;`)!.map(r=>r.specifier).sort()).toEqual(["com.app.Model", "java.util.List"]);
    expect(extractWithTreeSitter("x.kt", `import com.app.core.User`)!.map(r=>r.specifier)).toEqual(["com.app.core.User"]);
  });

  it("unknown extension → null (regex fallback)", async () => {
    await initTreeSitter();
    expect(extractWithTreeSitter("x.rb", "require 'foo'")).toBeNull();
  });

  it("regex fallback backend stays intact", () => {
    const refs = extractImports("x.ts", `import { a } from "./a";\nconst d = require("./d");`);
    expect(refs.map((r) => r.specifier)).toEqual(["./a", "./d"]);
  });

  it("GraphStore edges use tree-sitter: PHP use function resolves", async () => {
    mkdirSync(path.join(dir, "app", "helpers"), { recursive: true });
    mkdirSync(path.join(dir, "app", "Models"), { recursive: true });
    writeFileSync(path.join(dir, "app", "helpers", "foo.php"), `<?php\nnamespace App\\helpers;\nfunction foo() {}`);
    writeFileSync(path.join(dir, "app", "Models", "User.php"), `<?php\nnamespace App\\Models;\nclass User {}`);
    writeFileSync(path.join(dir, "consumer.php"), `<?php\nuse function App\\helpers\\foo;\nuse App\\Models\\User;\nfoo(); new User;`);

    await ensureGraphEngine();
    const store = new GraphStore(path.join(dir, ".agentos-graph.json"));
    store.rebuild(dir);
    const deps = store.dependencies("consumer.php").sort();
    expect(deps).toEqual(["app/Models/User.php", "app/helpers/foo.php"]);
    expect(store.stats().engine).toBe("tree-sitter");
    store.close();
  });
});
