import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { doctor } from "../src/commands/doctor.js";
import { install } from "../src/commands/install.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agentos-doc-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const configYaml = `project: { name: doc, description: "" }
skills:
  - name: tdd-laravel
mcpServers:
  - name: memory
    command: npx
    args: ["tsx", "server.ts"]
`;

describe("doctor (FR-2.4)", () => {
  it("flags missing config as fail with fix", () => {
    const { checks, ok } = doctor({ cwd: dir, quiet: true });
    expect(ok).toBe(false);
    const c = checks.find((x) => x.name === "config")!;
    expect(c.status).toBe("fail");
    expect(c.fix).toContain("agentos init");
  });

  it("passes after install; warns on hand-edited config (drift)", () => {
    writeFileSync(path.join(dir, "agent.config.yaml"), configYaml);
    install({ cwd: dir, quiet: true });
    const first = doctor({ cwd: dir, quiet: true });
    expect(first.ok).toBe(true);
    expect(first.checks.filter((c) => c.status === "fail")).toHaveLength(0);

    // hand-edit a generated file → drift warn with actionable fix
    const claudePath = path.join(dir, "CLAUDE.md");
    writeFileSync(claudePath, readFileSync(claudePath, "utf8") + "\nedited\n");
    const second = doctor({ cwd: dir, quiet: true });
    const drift = second.checks.find((c) => c.name === "drift")!;
    expect(drift.status).toBe("warn");
    expect(drift.fix).toContain("agentos sync --force");
  });

  it("flags unknown MCP command as fail", () => {
    writeFileSync(
      path.join(dir, "agent.config.yaml"),
      `project: { name: x }
mcpServers:
  - name: bogus
    command: definitely-not-a-real-command-xyz
    args: []
`,
    );
    const { checks, ok } = doctor({ cwd: dir, quiet: true });
    expect(ok).toBe(false);
    expect(checks.find((c) => c.name === "mcp:bogus")?.status).toBe("fail");
  });
});
