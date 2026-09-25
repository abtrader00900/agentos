import type { HarnessName } from "../core/schema.js";
import type { HarnessGenerator } from "./types.js";
import { claudeGenerator } from "./claude.js";
import { codexGenerator } from "./codex.js";
import { antigravityGenerator } from "./antigravity.js";
import { cursorGenerator } from "./cursor.js";
import { windsurfGenerator } from "./windsurf.js";

export const generators: Record<HarnessName, HarnessGenerator> = {
  "claude-code": claudeGenerator,
  codex: codexGenerator,
  antigravity: antigravityGenerator,
  cursor: cursorGenerator,
  windsurf: windsurfGenerator,
};

export type { GeneratedFile, HarnessGenerator } from "./types.js";
