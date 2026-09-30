import type { RunState } from "./run.js";
export declare function prBody(s: RunState): string;
/** one line per run for `agentos runs`, with the reason under it when the run did not open a PR */
export declare function runLine(s: RunState): string;
