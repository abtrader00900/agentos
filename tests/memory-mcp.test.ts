import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMemoryServer } from "../src/mcp/memory/server.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agentos-mcp-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("memory MCP server (FR-3.x, e2e via InMemory transport)", () => {
  it("store → new session → recall (M1 acceptance criterion)", async () => {
    // Session 1: store
    const server1 = createMemoryServer(path.join(dir, "memory.json"));
    const [c1s, s1c] = InMemoryTransport.createLinkedPair();
    const client1 = new Client({ name: "t", version: "0" });
    await Promise.all([client1.connect(c1s), server1.connect(s1c)]);
    const storeRes = await client1.callTool({
      name: "memory_store",
      arguments: { topic: "architecture", key: "auth", value: "Sanctum tokens" },
    });
    expect((storeRes.content as { text: string }[])[0].text).toContain("Stored");
    await client1.close();

    // Session 2: recall (agent restarted — memory must survive)
    const server2 = createMemoryServer(path.join(dir, "memory.json"));
    const [c2s, s2c] = InMemoryTransport.createLinkedPair();
    const client2 = new Client({ name: "t", version: "0" });
    await Promise.all([client2.connect(c2s), server2.connect(s2c)]);
    const recallRes = await client2.callTool({
      name: "memory_recall",
      arguments: { topic: "architecture" },
    });
    const text = (recallRes.content as { text: string }[])[0].text;
    expect(text).toContain("Sanctum tokens");
    await client2.close();
  });

  it("exposes all required tools", async () => {
    const server = createMemoryServer(path.join(dir, "memory.json"));
    const [cs, sc] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([client.connect(cs), server.connect(sc)]);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "memory_export",
      "memory_forget",
      "memory_get",
      "memory_recall",
      "memory_stats",
      "memory_store",
      "memory_topics",
    ]);
    await client.close();
  });
});
