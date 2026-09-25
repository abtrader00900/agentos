import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoryStore } from "../src/mcp/memory/store.js";

let dir: string;
let store: MemoryStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agentos-mem-"));
  store = new MemoryStore(path.join(dir, "memory.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("MemoryStore (FR-3.x)", () => {
  it("stores and recalls a fact", () => {
    store.store({ topic: "architecture", key: "auth", value: "Sanctum tokens, guards: web + api" });
    const facts = store.recall({ topic: "architecture" });
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toContain("Sanctum");
  });

  it("upserts on same topic+key instead of duplicating", () => {
    store.store({ topic: "t", key: "k", value: "v1" });
    store.store({ topic: "t", key: "k", value: "v2" });
    expect(store.recall({ topic: "t" })).toHaveLength(1);
    expect(store.get("t", "k")?.value).toBe("v2");
  });

  it("recalls by key substring and free text", () => {
    store.store({ topic: "entities", key: "InvoiceModel", value: "app/Models/Invoice.php" });
    expect(store.recall({ key: "Invoice" })).toHaveLength(1);
    expect(store.recall({ text: "Models/Invoice" })).toHaveLength(1);
    expect(store.recall({ text: "nothing-matches" })).toHaveLength(0);
  });

  it("tags source and pins facts", () => {
    store.store({ topic: "t", key: "k", value: "v", source: "app/Models/User.php", pinned: true });
    const f = store.get("t", "k")!;
    expect(f.source).toBe("app/Models/User.php");
    expect(f.pinned).toBe(1);
  });

  it("forgets facts", () => {
    store.store({ topic: "t", key: "k", value: "v" });
    expect(store.forget("t", "k")).toBe(true);
    expect(store.forget("t", "k")).toBe(false);
  });

  it("exports markdown (FR-3.4)", () => {
    store.store({ topic: "architecture", key: "auth", value: "Sanctum", source: "docs/auth.md" });
    const md = store.exportMarkdown();
    expect(md).toContain("## architecture");
    expect(md).toContain("**auth**");
    expect(md).toContain("Sanctum");
    expect(md).toContain("docs/auth.md");
  });

  it("persists across store instances (new session = new agent session)", () => {
    store.store({ topic: "t", key: "k", value: "survives restart" });
    store.close();
    const store2 = new MemoryStore(path.join(dir, "memory.db"));
    expect(store2.get("t", "k")?.value).toBe("survives restart");
    store2.close();
  });
});
