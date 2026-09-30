// tests/ui/helpers.ts
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createUiServer, type UiOptions } from "../../src/ui/server.js";

export const TOKEN = "a1".repeat(32);

export async function startTestServer(over: Partial<UiOptions> = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "agentos-ui-home-"));
  const server = createUiServer({ token: TOKEN, home, ...over });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  const close = async () => {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(() => r(undefined)));
    rmSync(home, { recursive: true, force: true });
  };
  return { server, port, home, close };
}

export interface Res { status: number; headers: http.IncomingHttpHeaders; body: string }

export function req(port: number, o: { method?: string; path: string; headers?: Record<string, string>; body?: string; cookie?: boolean; host?: string }): Promise<Res> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      host: o.host ?? `127.0.0.1:${port}`,
      ...(o.cookie === false ? {} : { cookie: `agentos_ui=${TOKEN}` }),
      ...(o.body === undefined ? {} : { "content-length": String(Buffer.byteLength(o.body)) }),
      ...(o.headers ?? {}),
    };
    const r = http.request({ host: "127.0.0.1", port, method: o.method ?? "GET", path: o.path, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    r.on("error", reject);
    if (o.body !== undefined) r.write(o.body);
    r.end();
  });
}

export const post = (port: number, p: string, body: unknown, headers: Record<string, string> = {}) =>
  req(port, { method: "POST", path: p, body: JSON.stringify(body), headers: { origin: `http://127.0.0.1:${port}`, "content-type": "application/json", ...headers } });
