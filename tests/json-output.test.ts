import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { statusData } from "../src/commands/status.js";
import { skillListData } from "../src/commands/skill.js";
import { doctor } from "../src/commands/doctor.js";
import { install } from "../src/commands/install.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "agentos-json-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const configYaml = `project: { name: jsonproj, description: "" }
skills:
  - name: tdd-laravel
mcpServers:
  - name: memory
    command: npx
    args: ["tsx", "server.ts"]
`;

describe("--json data shapes (FR-8.1)", () => {
  it("statusData reports configError when no config", () => {
    const d = statusData({ cwd: dir });
    expect(d.configError).toBeTruthy();
    expect(d.project).toBeNull();
    expect(d.harnesses.length).toBe(5);
    expect(d.drift.available).toBe(false);
    expect(d.memory.initialized).toBe(false);
  });

  it("statusData reports project + harnesses after install", () => {
    // write config at project root so install() picks it up
    process.chdir(dir);
    writeFileSync(path.join(dir, "agent.config.yaml"), configYaml);
    install();
    const d = statusData({ cwd: dir });
    expect(d.configError).toBeNull();
    expect(d.project?.name).toBe("jsonproj");
    expect(d.harnesses.find((h) => h.name === "claude-code")?.present).toBe(true);
    expect(d.drift.available).toBe(true);
    process.chdir(path.resolve(__dirname, ".."));
  });

  it("skillListData marks installed skills", () => {
    process.chdir(dir);
    writeFileSync(path.join(dir, "agent.config.yaml"), configYaml);
    install();
    const skills = skillListData({ cwd: dir });
    expect(skills.length).toBeGreaterThanOrEqual(10);
    const tdd = skills.find((s) => s.name === "tdd-laravel");
    expect(tdd?.installed).toBe(true);
    process.chdir(path.resolve(__dirname, ".."));
  });

  it("doctor quiet returns structured checks", () => {
    const { checks, ok } = doctor({ cwd: dir, quiet: true });
    expect(ok).toBe(false);
    expect(checks.find((c) => c.name === "config")?.status).toBe("fail");
  });
});
