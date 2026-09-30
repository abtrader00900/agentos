import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryStore } from "../../src/mcp/memory/store.js";
import { createMemoryServer } from "../../src/mcp/memory/server.js";
import { lessonKey } from "../../src/learning/lessons.js";

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

  it("memory_recall, memory_get and memory_export mark pending lessons by the engine's rule", async () => {
    const file = path.join(dir, "memory.json");
    const s = new MemoryStore(file);
    const AUTO = "auto lesson with its own key";
    const GUESS = "guessed lesson";
    const SWAPPED = "swapped text under an auto key";
    const swappedKey = lessonKey("the text that was approved");
    s.store({ topic: "lessons", key: lessonKey(AUTO), value: AUTO, meta: { status: "auto" } });
    s.store({ topic: "lessons", key: lessonKey(GUESS), value: GUESS, meta: { status: "pending" } });
    s.store({ topic: "lessons", key: swappedKey, value: SWAPPED, meta: { status: "auto" } }); // key ≠ lessonKey(value)
    const server = createMemoryServer(file);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([client.connect(a), server.connect(b)]);
    const call = async (name: string, args: Record<string, unknown> = {}) =>
      ((await client.callTool({ name, arguments: args })).content as { text: string }[])[0].text;

    const recall = await call("memory_recall", { topic: "lessons" });
    expect(recall).toContain(`[lessons/${lessonKey(GUESS)}] [pending] ${GUESS}`);
    expect(recall).toContain(`[lessons/${swappedKey}] [pending] ${SWAPPED}`);
    expect(recall).toContain(`[lessons/${lessonKey(AUTO)}] ${AUTO}`);

    expect(await call("memory_get", { topic: "lessons", key: swappedKey })).toBe(`[pending] ${SWAPPED}`);
    expect(await call("memory_get", { topic: "lessons", key: lessonKey(AUTO) })).toBe(AUTO);

    const md = await call("memory_export");
    expect(md).toContain(`- **${swappedKey}** [pending]: ${SWAPPED}`);
    expect(md).toContain(`- **${lessonKey(GUESS)}** [pending]: ${GUESS}`);
    expect(md).toContain(`- **${lessonKey(AUTO)}**: ${AUTO}`);
    await client.close();
  });
});
