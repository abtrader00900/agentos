import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ask, decider, deciderDir, readKey } from "../../src/decider/client.js";
import { AUTO_QUICK, CONTENT_RISK } from "../../src/decider/questions.js";
import { agentConfigSchema } from "../../src/core/schema.js";

let server: http.Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

/** a fake jevos: answers each question with the given probability, after delayMs */
async function fake(answer: (q: string) => unknown, delayMs = 0) {
  const seen: { auth?: string; body?: any }[] = [];
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => setTimeout(() => {
      const body = JSON.parse(raw);
      seen.push({ auth: req.headers.authorization, body });
      const answers = Object.fromEntries(Object.keys(body.questions).map((k) => [k, { type: "noul", noul: answer(k) }]));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ model: "jevos-v2", answers }));
    }, delayMs));
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, seen };
}

describe("decider client", () => {
  it("sends the jevos wire format and returns P(yes) per question", async () => {
    const f = await fake((k) => (k === "money" ? 0.82 : 0.1));
    const r = await ask(f.url, "diff text", CONTENT_RISK, { key: "k1" });
    expect(r).toEqual({ money: 0.82, "data-loss": 0.1, access: 0.1 });
    expect(f.seen[0].auth).toBe("Bearer k1");
    expect(f.seen[0].body).toMatchObject({ model: "jev-latest", state: "diff text" });
    expect(f.seen[0].body.questions.money).toEqual({ type: "noul", instructions: CONTENT_RISK.money });
  });

  it("returns null when the server is missing, slow, or answers nonsense", async () => {
    expect(await ask("http://127.0.0.1:9", "t", AUTO_QUICK)).toBeNull();
    const slow = await fake(() => 0.9, 400);
    expect(await ask(slow.url, "t", AUTO_QUICK, { timeoutMs: 100 })).toBeNull();
    await new Promise<void>((r) => server!.close(() => r()));
    const bad = await fake(() => "yes");
    expect(await ask(bad.url, "t", AUTO_QUICK)).toBeNull();
  });

  it("reads the key written next to the install and uses it", async () => {
    const home = realpathSync.native(mkdtempSync(path.join(tmpdir(), "agentos-dec-")));
    expect(readKey(home)).toBeUndefined();
    mkdirSync(deciderDir(home), { recursive: true });
    writeFileSync(path.join(deciderDir(home), "key"), "secret\n");
    expect(readKey(home)).toBe("secret");
    const f = await fake(() => 0.95);
    const cfg = agentConfigSchema.parse({ project: { name: "x" }, decider: { url: f.url } }).decider!;
    expect(await decider(cfg, home)("small task", AUTO_QUICK)).toEqual({ small: 0.95 });
    expect(f.seen[0].auth).toBe("Bearer secret");
  });

  it("has safe defaults and refuses a non-loopback url", () => {
    const d = agentConfigSchema.parse({ project: { name: "x" }, decider: {} }).decider;
    expect(d).toEqual({ autoQuick: true, contentRisk: true, quickAbove: 0.8, riskAbove: 0.6, url: "http://127.0.0.1:8017" });
    expect(() => agentConfigSchema.parse({ project: { name: "x" }, decider: { url: "https://api.example.com" } })).toThrow(/loopback/);
    expect(() => agentConfigSchema.parse({ project: { name: "x" }, decider: { quickAbove: 2 } })).toThrow();
    expect(agentConfigSchema.parse({ project: { name: "x" }, decider: { url: "http://localhost:9000" } }).decider!.url).toBe("http://localhost:9000");
  });
});
