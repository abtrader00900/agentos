import type { HarnessName } from "../core/schema.js";
import type { HarnessGenerator } from "./types.js";
import { claudeGenerator } from "./claude.js";
import { codexGenerator } from "./codex.js";
import { antigravityGenerator } from "./antigravity.js";

export const generators: Record<HarnessName, HarnessGenerator> = {
  "claude-code": claudeGenerator,
  codex: codexGenerator,
  antigravity: antigravityGenerator,
};

export type { GeneratedFile, HarnessGenerator } from "./types.js";
