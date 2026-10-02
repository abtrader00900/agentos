import { describe, it, expect } from "vitest";
import {
  globToRegExp, matchesGlob, parseNumstat, riskFlags, DEFAULT_RISK, tamperFindings, parseReport, REPORT_INSTRUCTIONS,
} from "../../src/orchestrator/gates.js";
import { orchestratorSchema } from "../../src/core/schema.js";

const diffOf = (file: string, lines: string[], extra = "") =>
  `diff --git a/${file} b/${file}\n${extra}--- a/${file}\n+++ b/${file}\n@@ -1,3 +1,3 @@\n${lines.join("\n")}\n`;

describe("globs", () => {
  it("matches ** across folders, * and ? inside one, and a bare name at any depth", () => {
    expect(globToRegExp("**/migrations/**").test("server/database/migrations/2026_add.php")).toBe(true);
    expect(globToRegExp("**/migrations/**").test("migrations/x.sql")).toBe(true);
    expect(globToRegExp(".github/workflows/**").test(".github/workflows/ci.yml")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
    expect(globToRegExp("file?.txt").test("file1.txt")).toBe(true);
    expect(matchesGlob("packages/app/package-lock.json", "package-lock.json")).toBe(true);
    expect(matchesGlob("src/Dockerfile.ts", "Dockerfile")).toBe(false);
    expect(matchesGlob("app/Policies/UserPolicy.php", "**/*Policy*")).toBe(true);
  });
});

describe("risk flags", () => {
  const changes = parseNumstat("12\t3\tdatabase/migrations/2026_10_02_add.php\n0\t250\tsrc/old.ts\n-\t-\tlogo.png\n1\t1\tpackage-lock.json\n");

  it("reads git diff --numstat, binary files as 0", () => {
    expect(changes).toEqual([
      { path: "database/migrations/2026_10_02_add.php", added: 12, deleted: 3 },
      { path: "src/old.ts", added: 0, deleted: 250 },
      { path: "logo.png", added: 0, deleted: 0 },
      { path: "package-lock.json", added: 1, deleted: 1 },
    ]);
  });

  it("flags by the default rules, including a big deletion", () => {
    const flags = riskFlags(changes, DEFAULT_RISK);
    expect(flags.map((f) => [f.rule, f.action, f.files])).toEqual([
      ["migration", "flag", ["database/migrations/2026_10_02_add.php"]],
      ["lockfile", "flag", ["package-lock.json"]],
      ["big-delete", "flag", ["src/old.ts", "database/migrations/2026_10_02_add.php", "package-lock.json"]],
    ]);
  });

  it("carries a project's block action, and finds nothing on a quiet diff", () => {
    const flags = riskFlags(changes, [{ name: "migration", action: "block", paths: ["**/migrations/**"] }]);
    expect(flags).toEqual([{ rule: "migration", action: "block", files: ["database/migrations/2026_10_02_add.php"] }]);
    expect(riskFlags(parseNumstat("3\t1\tsrc/a.ts\n"), DEFAULT_RISK)).toEqual([]);
  });

  it("validates risk rules in the config", () => {
    expect(orchestratorSchema.parse({ risk: [{ name: "m", action: "block", paths: ["**/*.sql"] }] }).risk).toHaveLength(1);
    expect(() => orchestratorSchema.parse({ risk: [{ name: "m", action: "stop", paths: ["x"] }] })).toThrow();
    expect(() => orchestratorSchema.parse({ risk: [{ name: "m", action: "flag" }] })).toThrow(/exactly one of paths or deletedLines/);
    expect(() => orchestratorSchema.parse({ risk: [{ name: "m", action: "flag", paths: ["x"], deletedLines: 5 }] })).toThrow(/exactly one/);
    expect(orchestratorSchema.parse({}).risk).toBeUndefined();
  });
});

describe("test tampering", () => {
  it("flags a new skip or focus marker in a test file as high", () => {
    const d = diffOf("tests/login.test.ts", [" it('logs in', () => {", "-it('rejects bad password', () => {", "+it.skip('rejects bad password', () => {"]);
    const f = tamperFindings(d, "make login work");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: "high", file: "tests/login.test.ts" });
    expect(f[0].issue).toMatch(/skip/i);
  });

  it("knows the common markers across languages", () => {
    for (const [file, line] of [
      ["src/a.spec.js", "+describe.only('x', () => {"],
      ["tests/Feature/LoginTest.php", "+        $this->markTestSkipped('flaky');"],
      ["tests/test_api.py", "+@pytest.mark.skip(reason='later')"],
      ["pkg/api_test.go", "+\tt.Skip(\"later\")"],
      ["src/__tests__/b.ts", "+xit('works', () => {})"],
    ]) expect(tamperFindings(diffOf(file, [line]), "t").map((x) => x.severity), file).toEqual(["high"]);
  });

  it("flags a deleted test file as high and fewer assertions as medium", () => {
    const deleted = diffOf("tests/old.test.ts", ["-expect(a).toBe(1);"], "deleted file mode 100644\n");
    expect(tamperFindings(deleted, "t")).toEqual([expect.objectContaining({ severity: "high", file: "tests/old.test.ts" })]);
    const weaker = diffOf("tests/math.test.ts", ["-  expect(add(1, 2)).toBe(3);", "-  expect(add(2, 2)).toBe(4);", "+  expect(add(1, 2)).toBeTruthy();"]);
    expect(tamperFindings(weaker, "t")).toEqual([expect.objectContaining({ severity: "medium", file: "tests/math.test.ts" })]);
  });

  it("ignores non-test files and lowers everything to low when the task asks for it", () => {
    expect(tamperFindings(diffOf("src/feature.ts", ["+it.skip('x')"]), "t")).toEqual([]);
    const d = diffOf("tests/old.test.ts", ["-expect(a).toBe(1);"], "deleted file mode 100644\n");
    expect(tamperFindings(d, "Remove the old login test, it covers a deleted page").map((x) => x.severity)).toEqual(["low"]);
    expect(tamperFindings(d, "Fix the bug; all tests must pass").map((x) => x.severity)).toEqual(["high"]);
  });

  it("reports a diff too large to scan instead of scanning it", () => {
    const f = tamperFindings("x".repeat(2_000_001), "t");
    expect(f).toEqual([expect.objectContaining({ severity: "low", issue: expect.stringContaining("too large") })]);
  });
});

describe("agent report", () => {
  it("reads the four parts, with bullets, semicolons and 'none'", () => {
    const r = parseReport(`Done.\n\nCHANGED: src/a.ts; src/b.ts\nNOT DONE:\n- the export button\n- dark mode\nASSUMED: users are logged in\nNOT VERIFIED: none`);
    expect(r).toEqual({ changed: ["src/a.ts", "src/b.ts"], notDone: ["the export button", "dark mode"], assumed: ["users are logged in"], notVerified: [] });
  });

  it("accepts lowercase and markdown bold headings, and returns null without a report", () => {
    expect(parseReport("**Not done:** n/a\n**Assumed**: api v2")).toEqual({ changed: [], notDone: [], assumed: ["api v2"], notVerified: [] });
    expect(parseReport("I fixed it.")).toBeNull();
  });

  it("tells the agent the exact format", () => {
    for (const h of ["CHANGED:", "NOT DONE:", "ASSUMED:", "NOT VERIFIED:"]) expect(REPORT_INSTRUCTIONS).toContain(h);
  });
});
