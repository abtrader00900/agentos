import type { HarnessGenerator } from "./types.js";
/**
 * Cursor target (FR-1.8): .cursor/rules/*.mdc + .cursor/mcp.json.
 * Cursor loads rule files from .cursor/rules/ (.mdc frontmatter: description,
 * globs, alwaysApply) and project MCP servers from .cursor/mcp.json
 * (https://cursor.com/docs/context/mcp) — without it the rule's "Local Tools"
 * would point at tools Cursor never started.
 */
export declare const cursorGenerator: HarnessGenerator;
