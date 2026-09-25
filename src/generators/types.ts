import type { AgentConfig, HarnessName } from "../core/schema.js";

export interface GeneratedFile {
  /** Path relative to project root */
  path: string;
  content: string;
}

export interface HarnessGenerator {
  harness: HarnessName;
  generate(config: AgentConfig): GeneratedFile[];
}
