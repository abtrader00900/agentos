import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOrchestratorServer } from "../../src/mcp/orchestrator/server.js";
import { saveRun, loadRun, type RunState } from "../../src/orchestrator/run.js";

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), "agentos-orch-mcp-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

const seeded = (id: string, status: RunState["status"]): RunState => ({
  id, task: `task ${id}`, status, baseBranch: "main", base: "x", branch: `agentos/run-${id}`, runWorktree: "/nowhere",
  createdAt: new Date().toISOString(), updatedAt: "", subtasks: [], fixRound: 0, findings: [],
});

async function connect(launch = (_r: string, _i: string, _t: string) => {}) {
  const server = createOrchestratorServer(root, launch);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([client.connect(a), server.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    ((await client.callTool({ name, arguments: args })).content as { text: string }[])[0].text;
  return { client, call };
}

describe("orchestrator MCP server", () => {
  it("run_task launches a background run and returns its id at once", async () => {
    const launched: string[][] = [];
    const { call, client } = await connect((r, i, t) => launched.push([r, i, t]));
    const text = await call("run_task", { task: "add a discount field" });
    expect(launched).toHaveLength(1);
    expect(launched[0][0]).toBe(root);
    expect(launched[0][2]).toBe("add a discount field");
    expect(text).toContain(launched[0][1]);
    await client.close();
  });

  it("run_status lists recent runs, or shows one", async () => {
    saveRun(root, seeded("r1", "paused"));
    const { call, client } = await connect();
    expect(await call("run_status")).toContain("r1");
    expect(await call("run_status", { id: "r1" })).toContain("task r1");
    await client.close();
  });

  it("run_cancel cancels a paused run", async () => {
    saveRun(root, seeded("r2", "paused"));
    const { call, client } = await connect();
    await call("run_cancel", { id: "r2" });
    expect(loadRun(root, "r2").status).toBe("cancelled");
    await client.close();
  });
});
