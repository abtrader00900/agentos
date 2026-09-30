import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { actionRoutes, readRoutes } from "./api.js";
import { liveEvents } from "./live.js";

/**
 * The dashboard's HTTP server.
 *
 * It is a local tool, but it can start and cancel real runs, so the browser is
 * treated as hostile: it listens on loopback only, every byte it serves sits
 * behind a token, and the Host/Origin checks stop a page on any other origin
 * (or a rebound DNS name pointing at 127.0.0.1) from reaching it.
 */

export interface UiOptions {
  token: string;
  home?: string;                                   // registry home (tests)
  staticDir?: string;                              // default: <package>/ui (works from src/ and dist/)
  // injection points for Tasks 3-5 (defaults are the real implementations)
  spawnRun?: (root: string, id: string, task: string) => void;
  spawnResume?: (root: string, id: string) => void;
  preflight?: (root: string) => void;              // throws the reason
}

export type ApiHandler = (req: http.IncomingMessage, url: URL, body: unknown) => Promise<{ status: number; json: unknown }>;

/** `routes` is module-global, so per-request options travel as an argument, not a closure. */
export type RouteHandler = (m: RegExpMatchArray, url: URL, body: unknown, opts: UiOptions) => Promise<{ status: number; json: unknown }>;

const COOKIE = "agentos_ui";
const MAX_BODY = 16 * 1024;

/** No inline anything and no framing: the frontend is plain files from ui/. */
const SEC = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

const LIVE = /^\/api\/p\/([^/]+)\/runs\/([^/]+)\/events$/;

const routes: Array<{ method: string; pattern: RegExp; handler: RouteHandler }> = [];

/** Tasks 3-5 add their endpoints here so the security pipeline stays in one place. */
export function route(method: string, pattern: RegExp, handler: RouteHandler): void {
  routes.push({ method: method.toUpperCase(), pattern, handler });
}

for (const r of readRoutes) route(r.method, r.pattern, r.handler);
for (const r of actionRoutes) route(r.method, r.pattern, r.handler);

/** Constant-time for equal lengths; timingSafeEqual throws on a length mismatch. */
function sameToken(given: string, token: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Buffer the body up to the cap, then stop keeping it — but keep draining, so the
 * client reliably reads our 413 instead of a reset connection. `null` means
 * "too large".
 */
function readBody(req: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (c: Buffer) => {
      if (over) return;
      size += c.length;
      if (size > MAX_BODY) {
        over = true;
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => { if (!over) resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

const inside = (dir: string, file: string): boolean => file === dir || file.startsWith(dir + path.sep);

export function createUiServer(opts: UiOptions): http.Server {
  const staticDir = path.resolve(opts.staticDir ?? fileURLToPath(new URL("../../ui/", import.meta.url)));
  const server: http.Server = http.createServer((req, res) => {
    handle(opts, staticDir, server, req, res).catch(() => {
      if (res.writableEnded) return;
      if (!res.headersSent) res.writeHead(500, { ...SEC, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "internal error" }));
    });
  });
  return server;
}

async function handle(opts: UiOptions, staticDir: string, server: http.Server, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const isApi = (req.url ?? "").startsWith("/api/");
  const send = (status: number, type: string, payload: string | Buffer, extra: http.OutgoingHttpHeaders = {}): void => {
    res.writeHead(status, { ...SEC, "content-type": type, ...(isApi ? { "cache-control": "no-store" } : {}), ...extra });
    res.end(payload);
  };
  const sendJson = (status: number, json: unknown): void => send(status, "application/json; charset=utf-8", JSON.stringify(json));
  const notFound = (): void => (isApi ? sendJson(404, { error: `no such endpoint: ${req.url}` }) : send(404, "text/plain; charset=utf-8", "not found\n"));
  const deny = (): void => (isApi ? sendJson(401, { error: "unauthorized" }) : send(401, "text/plain; charset=utf-8", "agentos dashboard: open the URL printed by `agentos ui`.\n"));

  // 1. Host: the port is read live so a port-0 test server works too.
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
    return send(403, "text/plain; charset=utf-8", "forbidden\n");
  }
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const method = req.method ?? "GET";

  // 2. Bootstrap: the token arrives once in the URL we printed, then moves into a
  //    cookie and the redirect drops it from the address bar, history and Referer.
  const query = url.searchParams.get("t");
  if (method === "GET" && url.pathname === "/" && query !== null) {
    if (!sameToken(query, opts.token)) return deny();
    res.writeHead(303, { ...SEC, location: "/", "cache-control": "no-store", "set-cookie": `${COOKIE}=${opts.token}; HttpOnly; SameSite=Strict; Path=/` });
    res.end();
    return;
  }

  // 3. Auth: the session cookie, or a bearer token for scripts and curl.
  const cookie = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]*)`).exec(req.headers.cookie ?? "")?.[1];
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
  if (!(cookie && sameToken(cookie, opts.token)) && !(bearer && sameToken(bearer, opts.token))) return deny();

  // 4. State-changing requests: same-origin, JSON, and small.
  let body: unknown;
  if (method === "POST" || method === "DELETE") {
    const origin = req.headers.origin;
    if (origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return sendJson(403, { error: "bad Origin" });
    if (!/^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? "")) return sendJson(415, { error: "expected application/json" });
    const text = await readBody(req);
    if (text === null) return sendJson(413, { error: `body larger than ${MAX_BODY} bytes` });
    try {
      body = text === "" ? undefined : JSON.parse(text);
    } catch {
      return sendJson(400, { error: "invalid JSON body" });
    }
  }

  // 5. API. The event stream owns its response, so it cannot be a route() handler,
  //    but it still sits behind the Host check and the token like everything else.
  if (isApi) {
    const live = method === "GET" ? LIVE.exec(url.pathname) : null;
    if (live) {
      const out = liveEvents(live[1], live[2], opts, url, req, res, SEC);
      if (out) return sendJson(out.status, out.json);
      return;
    }
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      const out = await r.handler(m, url, body, opts);
      return sendJson(out.status, out.json);
    }
    return notFound();
  }

  // 6. Static files. A percent-encoded path can still climb out once decoded
  //    (`..%2f..`), so containment is checked on the resolved path, not the URL.
  //    A malformed escape or a NUL byte is a 404, not a crash.
  let file: string;
  try {
    const decoded = decodeURIComponent(url.pathname);
    file = path.resolve(staticDir, (decoded === "/" ? "/index.html" : decoded).replace(/^[/\\]+/, ""));
  } catch {
    return notFound();
  }
  if (!inside(staticDir, file)) return notFound();
  let data: Buffer;
  try {
    data = readFileSync(file);
  } catch {
    return notFound();
  }
  send(200, TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream", data);
}

export function startUi(opts: UiOptions & { port: number }): Promise<{ server: http.Server; port: number; url: string }> {
  const server = createUiServer(opts);
  return new Promise((resolve, reject) => {
    server.once("error", (e: Error) => {
      server.close();
      const busy = (e as NodeJS.ErrnoException).code === "EADDRINUSE";
      reject(busy ? new Error(`port ${opts.port} is in use — pass --port to choose another`) : e);
    });
    // 127.0.0.1 only: nothing else on the network can reach the dashboard.
    server.listen(opts.port, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : opts.port; // port 0 means "any free port"
      resolve({ server, port, url: `http://127.0.0.1:${port}/?t=${opts.token}` });
    });
  });
}
