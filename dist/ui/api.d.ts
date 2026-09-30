import type { RouteHandler } from "./server.js";
/** Anchored patterns: /runs/:id must not swallow /runs/:id/diff. */
export declare const readRoutes: Array<{
    method: string;
    pattern: RegExp;
    handler: RouteHandler;
}>;
