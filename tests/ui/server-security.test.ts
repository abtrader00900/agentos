// tests/ui/server-security.test.ts
import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { startTestServer, req, post, TOKEN } from "./helpers.js";
import { startUi } from "../../src/ui/server.js";

let t: Awaited<ReturnType<typeof startTestServer>>;
afterEach(async () => { await t?.close(); });

describe("ui server security", () => {
  it("rejects requests without the token", async () => {
    t = await startTestServer();
    const api = await req(t.port, { path: "/api/projects", cookie: false });
    expect(api.status).toBe(401);
    expect(JSON.parse(api.body).error).toBeDefined();
    expect((await req(t.port, { path: "/", cookie: false })).status).toBe(401);
  });

  it("bootstraps a cookie from ?t= and drops the token from the URL", async () => {
    t = await startTestServer();
    expect((await req(t.port, { path: "/?t=wrong", cookie: false })).status).toBe(401);
    const r = await req(t.port, { path: `/?t=${TOKEN}`, cookie: false });
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe("/");
    const cookie = String(r.headers["set-cookie"]);
    for (const part of [`agentos_ui=${TOKEN}`, "HttpOnly", "SameSite=Strict", "Path=/"]) expect(cookie).toContain(part);
  });

  it("serves the app with the cookie or a bearer token, with security headers", async () => {
    t = await startTestServer();
    const r = await req(t.port, { path: "/" });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expect(r.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(r.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    const bearer = await req(t.port, { path: "/api/nothing-here", cookie: false, headers: { authorization: `Bearer ${TOKEN}` } });
    expect(bearer.status).toBe(404);
    expect(bearer.headers["cache-control"]).toBe("no-store");
  });

  it("refuses a foreign Host header (DNS rebinding)", async () => {
    t = await startTestServer();
    expect((await req(t.port, { path: "/", host: "evil.example" })).status).toBe(403);
    expect((await req(t.port, { path: "/", host: `localhost:${t.port}` })).status).toBe(200);
  });

  it("guards state-changing requests: Origin, content type, size", async () => {
    t = await startTestServer();
    const p = "/api/nothing-here";
    expect((await req(t.port, { method: "POST", path: p, body: "{}", headers: { "content-type": "application/json" } })).status).toBe(403);
    expect((await post(t.port, p, {}, { origin: "http://evil.example" })).status).toBe(403);
    expect((await req(t.port, { method: "POST", path: p, body: "{}", headers: { origin: `http://127.0.0.1:${t.port}`, "content-type": "text/plain" } })).status).toBe(415);
    expect((await post(t.port, p, { x: "y".repeat(17 * 1024) })).status).toBe(413);
    expect((await post(t.port, p, {})).status).toBe(404); // every check passed; no such route
  });

  it("never serves files outside the ui directory", async () => {
    t = await startTestServer();
    for (const p of ["/../package.json", "/..%2f..%2fpackage.json", "/%2e%2e/%2e%2e/package.json", "/ui/../../package.json"]) {
      expect((await req(t.port, { path: p })).status).toBe(404);
    }
  });

  it("startUi reports a busy port clearly", async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", () => r()));
    const port = (blocker.address() as net.AddressInfo).port;
    await expect(startUi({ token: TOKEN, port })).rejects.toThrow(new RegExp(`port ${port} is in use`));
    await new Promise((r) => blocker.close(() => r(undefined)));
  });
});
