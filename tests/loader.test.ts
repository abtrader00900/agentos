import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/core/loader.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agentos-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const baseYaml = (extra = "") => `
project:
  name: proj
rules:
  - id: base-rule
    text: from project
${extra}`;

describe("loadConfig layer merging (FR-1.5)", () => {
  it("merges local over project (override by rule id)", () => {
    writeFileSync(path.join(dir, "agent.config.yaml"), baseYaml());
    writeFileSync(
      path.join(dir, "agent.config.local.yaml"),
      `project: { name: proj }
rules:
  - id: base-rule
    text: overridden locally
`,
    );
    const { config } = loadConfig(dir, "/nonexistent-home");
    const rule = config.rules.find((r) => r.id === "base-rule");
    expect(rule?.text).toBe("overridden locally");
  });

  it("throws readable error when no config exists anywhere", () => {
    expect(() => loadConfig(dir, "/nonexistent-home")).toThrow(/No agent.config.yaml found/);
  });

  it("throws with field path on schema violation", () => {
    writeFileSync(path.join(dir, "agent.config.yaml"), "project: { name: 5 }");
    expect(() => loadConfig(dir, "/nonexistent-home")).toThrow(/validation failed/);
  });

  it("merges global + project + local layers", () => {
    const home = mkdtempSync(path.join(tmpdir(), "agentos-home-"));
    mkdirSync(path.join(home, ".agentos"));
    writeFileSync(path.join(home, ".agentos", "agent.config.yaml"), "project: { name: global }\nrules:\n  - { id: g, text: global }\n");
    writeFileSync(path.join(dir, "agent.config.yaml"), "project: { name: proj }\nrules:\n  - { id: p, text: project }\n");
    writeFileSync(path.join(dir, "agent.config.local.yaml"), "project: { name: proj }\nrules:\n  - { id: l, text: local }\n");
    const { config, sources } = loadConfig(dir, home);
    expect(config.rules.map((r) => r.id)).toEqual(["g", "p", "l"]);
    expect(sources).toHaveLength(3);
    rmSync(home, { recursive: true, force: true });
  });
});
