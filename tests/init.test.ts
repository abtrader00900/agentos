import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { init } from "../src/commands/init.js";
import { agentConfigSchema } from "../src/core/schema.js";
import { DEFAULT_RISK } from "../src/orchestrator/gates.js";

let dir: string;
let logs: string[];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agentos-init-"));
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const read = () => parse(readFileSync(path.join(dir, "agent.config.yaml"), "utf8"));

const RULE_IDS = [
  "plan-first",
  "prove-not-claim",
  "never-weaken-tests",
  "honest-report",
  "secrets-in-env",
  "ask-before-deps",
  "endpoint-checklist",
  "migrations-only",
  "record-decisions",
];

const CASES = [
  {
    name: "laravel",
    setup: () => writeFileSync(path.join(dir, "composer.json"), "{}"),
    stack: ["php", "laravel"],
    verify: ["php artisan test"],
    skills: ["saas-builder", "ponytail", "tdd-laravel"],
  },
  {
    name: "nextjs",
    setup: () => writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { next: "^15.0.0" } })),
    stack: ["typescript", "nextjs", "react"],
    verify: ["npm test", "npx tsc --noEmit"],
    skills: ["saas-builder", "ponytail", "tdd-react"],
  },
  {
    name: "node",
    setup: () => {},
    stack: ["typescript", "node"],
    verify: ["npm test"],
    skills: ["saas-builder", "ponytail"],
  },
];

describe("init --saas", () => {
  for (const c of CASES) {
    it(`detects ${c.name} and writes a valid config`, () => {
      c.setup();
      init({ cwd: dir, saas: true });

      const cfg = agentConfigSchema.parse(read());
      expect(cfg.stack).toEqual(c.stack);
      expect(cfg.orchestrator?.verify).toEqual(c.verify);
      expect(cfg.skills.map((s) => s.name)).toEqual(c.skills);
      expect(cfg.orchestrator?.workers).toEqual(["claude", "codex"]);
      expect(cfg.orchestrator?.reviewer).toBe("codex");
      expect(cfg.rules.map((r) => r.id)).toEqual(RULE_IDS);
      expect(cfg.orchestrator?.risk).toEqual(DEFAULT_RISK);
      expect(cfg.orchestrator?.risk).toHaveLength(6);
      expect(cfg.orchestrator?.risk?.every((r) => r.action === "flag")).toBe(true);
      expect(logs.join("\n")).toContain(`Detected ${c.name} stack`);
    });
  }

  it("detects node when package.json has no next and is unparseable", () => {
    writeFileSync(path.join(dir, "package.json"), "{ not json");
    init({ cwd: dir, saas: true });
    expect(agentConfigSchema.parse(read()).stack).toEqual(["typescript", "node"]);
  });

  it("finds next in devDependencies too", () => {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ devDependencies: { next: "15" } }));
    init({ cwd: dir, saas: true });
    expect(agentConfigSchema.parse(read()).stack).toEqual(["typescript", "nextjs", "react"]);
  });

  it("creates docs/decisions/README.md explaining the format", () => {
    init({ cwd: dir, saas: true });
    const doc = readFileSync(path.join(dir, "docs", "decisions", "README.md"), "utf8");
    for (const part of ["Context", "Options", "Choice", "Why", "Date", "NNNN"]) expect(doc).toContain(part);
  });

  it("does not overwrite an existing docs/decisions/README.md", () => {
    mkdirSync(path.join(dir, "docs", "decisions"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "decisions", "README.md"), "mine");
    init({ cwd: dir, saas: true });
    expect(readFileSync(path.join(dir, "docs", "decisions", "README.md"), "utf8")).toBe("mine");
  });

  it("refuses to overwrite an existing config without --force", () => {
    writeFileSync(path.join(dir, "agent.config.yaml"), "keep: me");
    expect(() => init({ cwd: dir, saas: true })).toThrow(/already exists/);
    expect(readFileSync(path.join(dir, "agent.config.yaml"), "utf8")).toBe("keep: me");
    expect(existsSync(path.join(dir, "docs", "decisions", "README.md"))).toBe(false);
  });

  it("overwrites with --force", () => {
    writeFileSync(path.join(dir, "agent.config.yaml"), "keep: me");
    init({ cwd: dir, saas: true, force: true });
    expect(agentConfigSchema.parse(read()).rules).toHaveLength(9);
  });
});

describe("init (plain)", () => {
  it("still writes the old template", () => {
    writeFileSync(path.join(dir, "composer.json"), "{}");
    init({ cwd: dir });
    const cfg = agentConfigSchema.parse(read());
    expect(cfg.stack).toEqual(["typescript"]);
    expect(cfg.rules.map((r) => r.id)).toEqual(["run-tests-first", "no-guessing-deps"]);
    expect(cfg.orchestrator).toBeUndefined();
    expect(existsSync(path.join(dir, "docs"))).toBe(false);
  });
});
