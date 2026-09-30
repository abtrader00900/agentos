import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryStore } from "../../src/mcp/memory/store.js";
import { createMemoryServer } from "../../src/mcp/memory/server.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "agentos-meta-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("fact meta", () => {
  it("stores meta, and keeps it when an update omits it", () => {
    const s = new MemoryStore(path.join(dir, "memory.json"));
    s.store({ topic: "lessons", key: "L-1", value: "v1", meta: { status: "auto", seen: 1 } });
    s.store({ topic: "lessons", key: "L-1", value: "v2" });
    expect(s.get("lessons", "L-1")).toMatchObject({ value: "v2", meta: { status: "auto", seen: 1 } });
    s.store({ topic: "lessons", key: "L-1", value: "v2", meta: { status: "approved" } });
    expect(s.get("lessons", "L-1")?.meta).toEqual({ status: "approved" });
  });

  it("loads a 0.3 memory file that has no meta", () => {
    const file = path.join(dir, "memory.json");
    writeFileSync(file, JSON.stringify({ facts: [{ id: 1, topic: "t", key: "k", value: "old", source: null, pinned: 0, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" }] }));
    const s = new MemoryStore(file);
    expect(s.get("t", "k")?.value).toBe("old");
    expect(s.get("t", "k")?.meta).toBeUndefined();
  });

  it("memory_recall marks pending lessons", async () => {
    const file = path.join(dir, "memory.json");
    const s = new MemoryStore(file);
    s.store({ topic: "lessons", key: "L-a", value: "approved lesson", meta: { status: "auto" } });
    s.store({ topic: "lessons", key: "L-b", value: "guessed lesson", meta: { status: "pending" } });
    const server = createMemoryServer(file);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([client.connect(a), server.connect(b)]);
    const text = ((await client.callTool({ name: "memory_recall", arguments: { topic: "lessons" } })).content as { text: string }[])[0].text;
    expect(text).toContain("[lessons/L-b] [pending] guessed lesson");
    expect(text).not.toContain("[lessons/L-a] [pending]");
    await client.close();
  });
});
