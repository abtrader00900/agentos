import { claudeGenerator } from "./claude.js";
import { codexGenerator } from "./codex.js";
import { antigravityGenerator } from "./antigravity.js";
import { cursorGenerator } from "./cursor.js";
import { windsurfGenerator } from "./windsurf.js";
export const generators = {
    "claude-code": claudeGenerator,
    codex: codexGenerator,
    antigravity: antigravityGenerator,
    cursor: cursorGenerator,
    windsurf: windsurfGenerator,
};
/** The file each harness reads first — what status/doctor/handoff look for. */
export const HARNESS_MARKER = {
    "claude-code": "CLAUDE.md",
    codex: "AGENTS.md",
    antigravity: ".agents/rules/agentos.md",
    cursor: ".cursor/rules/agentos.mdc",
    windsurf: ".windsurf/rules/agentos.md",
};
//# sourceMappingURL=index.js.map