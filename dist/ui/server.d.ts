import http from "node:http";
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
    home?: string;
    staticDir?: string;
    spawnRun?: (root: string, id: string, task: string, quick?: boolean) => void;
    spawnResume?: (root: string, id: string) => void;
    preflight?: (root: string) => void;
}
export type ApiHandler = (req: http.IncomingMessage, url: URL, body: unknown) => Promise<{
    status: number;
    json: unknown;
}>;
/** `routes` is module-global, so per-request options travel as an argument, not a closure. */
export type RouteHandler = (m: RegExpMatchArray, url: URL, body: unknown, opts: UiOptions) => Promise<{
    status: number;
    json: unknown;
}>;
/** Tasks 3-5 add their endpoints here so the security pipeline stays in one place. */
export declare function route(method: string, pattern: RegExp, handler: RouteHandler): void;
export declare function createUiServer(opts: UiOptions): http.Server;
export declare function startUi(opts: UiOptions & {
    port: number;
}): Promise<{
    server: http.Server;
    port: number;
    url: string;
}>;
