import { readManifest, detectDrift } from "../core/manifest.js";
import type { HarnessName } from "../core/schema.js";
export interface SyncOptions {
    cwd?: string;
    /** Only sync these harnesses */
    only?: HarnessName[];
    /** Overwrite drifted (hand-edited) and pre-existing files; the previous version is kept as <file>.bak */
    force?: boolean;
    quiet?: boolean;
}
export declare function sync(options?: SyncOptions): void;
export { detectDrift, readManifest };
