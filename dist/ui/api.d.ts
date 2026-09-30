import { type RunState } from "../orchestrator/run.js";
import type { RouteHandler } from "./server.js";
/** a status the handler wants instead of 200 */
export declare class Http extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
/** An id runDir rejects never reaches the filesystem; a run that is not there is a 404. */
export declare function runOf(root: string, id: string): RunState;
/** Anchored patterns: /runs/:id must not swallow /runs/:id/diff. */
export declare const readRoutes: Array<{
    method: string;
    pattern: RegExp;
    handler: RouteHandler;
}>;
/** `agentos run --resume <id>` as a detached process, the way spawnDetachedRun starts a new run. */
export declare function spawnDetachedResume(root: string, id: string): void;
/** Anchored patterns: /runs/:id must not swallow /runs/:id/cancel. */
export declare const actionRoutes: Array<{
    method: string;
    pattern: RegExp;
    handler: RouteHandler;
}>;
