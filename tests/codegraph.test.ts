import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GraphStore, extractImports, resolveModule } from "../src/mcp/codegraph/graph.js";

let dir: string;

function proj(files: Record<string, string>) {
  for (const [p, content] of Object.entries(files)) {
    const abs = path.join(dir, p);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agentos-cg-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("extractImports (FR-5.2)", () => {
  it("TS: import/export-from/require", () => {
    const refs = extractImports("a.ts", [
      `import { x } from "./lib";`,
      `import y from "@/utils/y";`,
      `export { z } from "./z";`,
      `const w = require("./w");`,
    ].join("\n"));
    expect(refs.map((r) => r.specifier)).toEqual(["./lib", "@/utils/y", "./z", "./w"]);
  });

  it("Python: import + from-import", () => {
    const refs = extractImports("a.py", `import os\nfrom services.payment import process\n`);
    expect(refs.map((r) => r.specifier)).toEqual(["os", "services.payment"]);
  });

  it("PHP: use statements (namespace style)", () => {
    const refs = extractImports("a.php", `<?php\nuse App\\Models\\Invoice;\nuse App\\Services\\Payment as Pay;\n`);
    expect(refs.map((r) => r.specifier)).toEqual(["App\\Models\\Invoice", "App\\Services\\Payment"]);
  });

  it("Go: import block", () => {
    const refs = extractImports("main.go", 'package main\nimport (\n\t"fmt"\n\t"./internal/pkg"\n)\n');
    expect(refs.map((r) => r.specifier)).toContain("fmt");
    expect(refs.map((r) => r.specifier)).toContain("./internal/pkg");
  });
});

describe("resolveModule", () => {
  it("resolves relative TS imports to files", () => {
    proj({ "src/lib.ts": "export const x = 1;" });
    expect(resolveModule(dir, "src/a.ts", "./lib")).toBe(path.join("src", "lib.ts").replace(/\\/g, "/"));
  });

  it("resolves PHP namespace App\\... to app/...", () => {
    proj({ "app/Models/Invoice.php": "<?php" });
    expect(resolveModule(dir, "app/x.php", "App\\Models\\Invoice")).toBe(path.join("app", "Models", "Invoice.php").replace(/\\/g, "/"));
  });

  it("returns null for external packages", () => {
    expect(resolveModule(dir, "src/a.ts", "lodash")).toBeNull();
  });
});

describe("GraphStore (FR-5.x)", () => {
  it("builds graph and answers impact queries (FR-5.3)", () => {
    proj({
      "src/invoice.ts": `export class Invoice {}`,
      "src/payment.ts": `import { Invoice } from "./invoice";\nexport function pay() {}`,
      "src/checkout.ts": `import { pay } from "./payment";\nexport function checkout() {}`,
    });
    const store = new GraphStore(path.join(dir, ".agentos", "graph.json"));
    const r = store.update(dir);
    expect(r.scanned).toBe(3);

    const impact = store.impact("src/invoice.ts");
    expect(impact).toEqual(["src/payment.ts"]);

    const deps = store.dependencies("src/checkout.ts");
    expect(deps).toEqual(["src/payment.ts"]);
    store.close();
  });

  it("detects cycles (FR-5.6)", () => {
    proj({
      "src/a.ts": `import { b } from "./b";`,
      "src/b.ts": `import { a } from "./a";`,
    });
    const store = new GraphStore(path.join(dir, ".agentos", "graph.json"));
    store.update(dir);
    const cycles = store.cycles();
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0].length).toBeGreaterThan(1);
    store.close();
  });

  it("finds orphans (FR-5.6)", () => {
    proj({
      "src/used.ts": `export const u = 1;`,
      "src/user.ts": `import { u } from "./used";`,
      "src/dead.ts": `export const dead = 1;`,
    });
    const store = new GraphStore(path.join(dir, ".agentos", "graph.json"));
    store.update(dir);
    // orphans = files nobody imports; entry points (user.ts) legitimately appear
    const orphans = store.orphans();
    expect(orphans).toContain(path.join("src", "dead.ts").replace(/\\/g, "/"));
    expect(orphans).toContain(path.join("src", "user.ts").replace(/\\/g, "/"));
    expect(orphans).not.toContain(path.join("src", "used.ts").replace(/\\/g, "/"));
    store.close();
  });

  it("incremental update only reprocesses changed files (FR-5.4)", () => {
    proj({ "src/a.ts": `export const a = 1;` });
    const store = new GraphStore(path.join(dir, ".agentos", "graph.json"));
    store.update(dir);
    const second = store.update(dir);
    expect(second.changed).toBe(0);

    writeFileSync(path.join(dir, "src", "b.ts"), `import { a } from "./a";`);
    const third = store.update(dir);
    expect(third.changed).toBe(1);
    expect(store.impact("src/a.ts")).toEqual([path.join("src", "b.ts").replace(/\\/g, "/")]);
    store.close();
  });

  it("removes edges when files are deleted", () => {
    proj({
      "src/a.ts": `export const a = 1;`,
      "src/b.ts": `import { a } from "./a";`,
    });
    const store = new GraphStore(path.join(dir, ".agentos", "graph.json"));
    store.update(dir);
    rmSync(path.join(dir, "src", "b.ts"));
    store.update(dir);
    expect(store.impact("src/a.ts")).toEqual([]);
    store.close();
  });
});
