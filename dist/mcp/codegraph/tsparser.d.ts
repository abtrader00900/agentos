import type { ImportRef } from "./graph.js";
/** Load the runtime + all available grammars. Safe to call repeatedly. */
export declare function initTreeSitter(): Promise<boolean>;
export declare function treeSitterActive(): boolean;
/**
 * Extract import refs via tree-sitter. Returns null when the engine is
 * unavailable or the file has no grammar — caller falls back to regex.
 */
export declare function extractWithTreeSitter(filePath: string, content: string): ImportRef[] | null;
