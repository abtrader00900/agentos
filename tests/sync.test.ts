import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sync } from "../src/commands/sync.js";
import { detectDrift } from "../src/core/manifest.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agentos-sync-"));
  writeFileSync(
    path.join(dir, "agent.config.yaml"),
    `project:
  name: demo
  description: "test project"
stack: [typescript]
rules:
  - id: r1
    text: rule one
  - id: r2
    text: codex only
    harnesses: [codex]
skills:
  - name: tdd-laravel
mcpServers:
  - name: memory
    command: agentos
    args: ["mcp", "memory"]
`,
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("sync (FR-1.2/1.3/1.4)", () => {
  it("generates all harness configs", () => {
    sync({ cwd: dir, quiet: true });
    for (const f of ["CLAUDE.md", "AGENTS.md", ".antigravity/config.md"]) {
      expect(existsSync(path.join(dir, f))).toBe(true);
    }
  });

  it("respects per-harness rule filtering", () => {
    sync({ cwd: dir, quiet: true });
    const claude = readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
    const codex = readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    expect(claude).toContain("rule one");
    expect(claude).not.toContain("codex only");
    expect(codex).toContain("codex only");
  });

  it("writes .mcp.json for claude + antigravity and config.toml for codex", () => {
    sync({ cwd: dir, quiet: true });
    const mcp = JSON.parse(readFileSync(path.join(dir, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.memory.command).toBe("agentos");
    const toml = readFileSync(path.join(dir, ".codex/config.toml"), "utf8");
    expect(toml).toContain("[mcp_servers.memory]");
  });

  it("is idempotent (FR: sync twice = same output)", () => {
    sync({ cwd: dir, quiet: true });
    const first = readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
    sync({ cwd: dir, quiet: true });
    expect(readFileSync(path.join(dir, "CLAUDE.md"), "utf8")).toBe(first);
  });
});

describe("drift detection (FR-1.6)", () => {
  it("detects hand edits after sync", () => {
    sync({ cwd: dir, quiet: true });
    const claudePath = path.join(dir, "CLAUDE.md");
    writeFileSync(claudePath, readFileSync(claudePath, "utf8") + "\nhand edit\n");
    const drift = detectDrift(dir, new Map());
    expect(drift.drifted).toContain("CLAUDE.md");
  });

  it("sync refuses to overwrite drift without --force", () => {
    sync({ cwd: dir, quiet: true });
    const claudePath = path.join(dir, "CLAUDE.md");
    writeFileSync(claudePath, "tampered");
    expect(() => sync({ cwd: dir, quiet: true })).toThrow(/Drift detected/);
    sync({ cwd: dir, quiet: true, force: true });
    expect(readFileSync(claudePath, "utf8")).toContain("demo");
  });
});
