import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { runVerify, parseFindings, blocking, reviewPrompt, excerpt } from "../../src/orchestrator/verify.js";
import type { Finding } from "../../src/orchestrator/types.js";

describe("runVerify", () => {
  it("runs commands in order and stops at the first failure", () => {
    const r = runVerify(tmpdir(), [`node -e "console.log('first-ran')"`, `node -e "process.exit(3)"`, `node -e "console.log('third-ran')"`], 30_000);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("first-ran\n");
    expect(r.output).toContain("FAILED");
    expect(r.output).not.toContain("third-ran\n");
  });

  it("passes with no commands", () => {
    expect(runVerify(tmpdir(), [], 1000)).toEqual({ ok: true, output: "" });
  });
});

describe("parseFindings", () => {
  const high: Finding = { severity: "high", file: "a.ts", line: 3, issue: "crash" };

  it("reads a fenced JSON array inside prose", () => {
    expect(parseFindings(`Here you go:\n\`\`\`json\n${JSON.stringify([high])}\n\`\`\`\nDone.`)).toEqual([high]);
  });

  it("handles [] and nested arrays, and fills defaults", () => {
    expect(parseFindings("[]")).toEqual([]);
    expect(parseFindings('[{"severity":"low","issue":"x","extra":[1,2]}]')).toEqual([{ severity: "low", file: "", line: 0, issue: "x" }]);
  });

  it("returns null when there is no valid findings array", () => {
    expect(parseFindings("no json here")).toBeNull();
    expect(parseFindings('[{"severity":"urgent","issue":"x"}]')).toBeNull();
  });

  it("only high and medium findings block", () => {
    expect(blocking([high, { severity: "low", file: "", line: 0, issue: "nit" }])).toEqual([high]);
  });
});

describe("reviewPrompt", () => {
  it("carries the task and the diff, truncating huge diffs", () => {
    const p = reviewPrompt("add x", "diff --git a/x b/x\n+x");
    expect(p).toContain("add x");
    expect(p).toContain("+x");
    expect(reviewPrompt("t", "y".repeat(200_000))).toContain("(diff truncated)");
  });
});

describe("excerpt", () => {
  it("keeps short text whole, and the head and tail of long text", () => {
    expect(excerpt("short", 600)).toBe("short");
    const long = ["AssertionError: boom", "x".repeat(3000), "last line"].join("\n");
    const e = excerpt(long, 600);
    expect(e.length).toBeLessThanOrEqual(605);
    expect(e.startsWith("AssertionError: boom")).toBe(true);
    expect(e.endsWith("last line")).toBe(true);
    expect(e).toContain("\n…\n");
  });
});
