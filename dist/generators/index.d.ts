import type { HarnessName } from "../core/schema.js";
import type { HarnessGenerator } from "./types.js";
export declare const generators: Record<HarnessName, HarnessGenerator>;
export type { GeneratedFile, HarnessGenerator } from "./types.js";
/** The file each harness reads first — what status/doctor/handoff look for. */
export declare const HARNESS_MARKER: Record<HarnessName, string>;
