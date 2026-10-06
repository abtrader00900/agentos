import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { quotaReport, clearQuotaCmd } from "../../src/commands/quota.js";
import { fileQuota } from "../../src/orchestrator/quota.js";

const home = () => mkdtempSync(path.join(tmpdir(), "q-"));

describe("agentos quota", () => {
  it("prints limited agents and clears them", async () => {
    const h = home();
    fileQuota(h).mark("claude", new Date(Date.now() + 3_600_000));
    expect(quotaReport(h, new Date())).toMatch(/claude: limited until/);
    clearQuotaCmd(h, "claude");
    expect(quotaReport(h, new Date())).toMatch(/no agent is limited/);
  });

  it("a mark already in the past is not a limit", () => {
    const h = home();
    fileQuota(h).mark("codex", new Date(Date.now() - 1_000));
    expect(quotaReport(h, new Date())).toBe("no agent is limited");
  });

  it("rejects an unknown agent and clears every one without an argument", () => {
    const h = home();
    const q = fileQuota(h);
    q.mark("claude", new Date(Date.now() + 3_600_000));
    q.mark("codex", new Date(Date.now() + 3_600_000));
    expect(() => clearQuotaCmd(h, "nope")).toThrow(/nope/);
    expect(quotaReport(h, new Date()).split("\n")).toHaveLength(2);
    clearQuotaCmd(h);
    expect(quotaReport(h, new Date())).toBe("no agent is limited");
  });
});
