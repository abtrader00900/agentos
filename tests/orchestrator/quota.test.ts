import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileQuota, memoryQuota, resetFrom } from "../../src/orchestrator/quota.js";

const now = new Date("2026-10-06T10:00:00Z");
const later = (min: number) => new Date(now.getTime() + min * 60_000);

describe("quota store", () => {
  for (const [name, make] of [["memory", () => memoryQuota()], ["file", () => fileQuota(mkdtempSync(path.join(tmpdir(), "quota-")))]] as const) {
    it(`${name}: marks, reads back, expires and clears`, () => {
      const q = make();
      expect(q.until("claude", now)).toBeUndefined();
      q.mark("claude", later(30));
      expect(q.until("claude", now)?.toISOString()).toBe(later(30).toISOString());
      expect(q.until("claude", later(31))).toBeUndefined();
      q.mark("codex", later(10));
      q.clear("codex");
      expect(q.until("codex", now)).toBeUndefined();
    });
  }

  it("file: two stores on the same home see each other's marks", () => {
    const home = mkdtempSync(path.join(tmpdir(), "quota-"));
    fileQuota(home).mark("codex", later(5));
    expect(fileQuota(home).until("codex", now)).toBeDefined();
  });
});

describe("resetFrom", () => {
  it("uses the wait the CLI states, else the cooldown", () => {
    expect(resetFrom("Usage limit reached. Try again in 45 minutes.", now, 60)).toEqual(later(45));
    expect(resetFrom("quota exceeded, resets in 2 hours", now, 60)).toEqual(later(120));
    expect(resetFrom("429 too many requests", now, 60)).toEqual(later(60));
  });
});
