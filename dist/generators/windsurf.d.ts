import type { HarnessGenerator } from "./types.js";
/**
 * Windsurf target (FR-1.8): .windsurf/rules/*.md with `trigger: always_on`
 * (without frontmatter a rule is manual-only). Windsurf has no project-level
 * MCP file — servers are registered in its global mcp_config.json — so the
 * rule says so instead of promising tools that may not be there.
 */
export declare const windsurfGenerator: HarnessGenerator;
