import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings } from "../../src/daemon/settings.js";
import { agentConfigSchema } from "../../src/core/schema.js";

const home = () => realpathSync.native(mkdtempSync(path.join(tmpdir(), "agentos-set-")));

describe("daemon settings", () => {
  it("uses the agreed defaults when there is no daemon.yaml", () => {
    expect(loadSettings(home())).toEqual({ maxRunsPerDay: 6, maxCiFixesPerPr: 2, tickSeconds: 30, ciEverySeconds: 300, pauseMinutesOnLimit: 30 });
  });

  it("reads overrides and rejects unknown keys", () => {
    const h = home();
    mkdirSync(path.join(h, ".agentos"));
    writeFileSync(path.join(h, ".agentos", "daemon.yaml"), "maxRunsPerDay: 3\n");
    expect(loadSettings(h).maxRunsPerDay).toBe(3);
    writeFileSync(path.join(h, ".agentos", "daemon.yaml"), "maxRunsPerDya: 3\n");
    expect(() => loadSettings(h)).toThrow(/daemon\.yaml/);
  });

  it("parses the per-project daemon block with safe defaults", () => {
    const c = agentConfigSchema.parse({ project: { name: "x" }, daemon: { schedules: [{ cron: "0 2 * * *", task: "nightly chores" }] } });
    expect(c.daemon).toEqual({ enabled: false, ciFix: false, schedules: [{ cron: "0 2 * * *", task: "nightly chores", quick: false }] });
  });
});
