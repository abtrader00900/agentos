import type { IncomingMessage, ServerResponse } from "node:http";
import type { UiOptions } from "./server.js";
export declare function liveEvents(projectId: string, runId: string, opts: UiOptions, url: URL, req: IncomingMessage, res: ServerResponse, sec: Record<string, string>): {
    status: number;
    json: unknown;
} | null;
