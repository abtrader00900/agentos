import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { searchText } from "../src/mcp/supersearch/searcher.js";
import { searchSymbols, astGrepBinary } from "../src/mcp/supersearch/symbols.js";
import { searchHistory, blameFile } from "../src/mcp/supersearch/gitsearch.js";

let dir: string;

function git(args: string[]) {
  return execFileSync("git", args, {
    cwd: dir,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
      GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    },
  });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agentos-ss-"));
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, ".gitignore"), "node_modules/\ndist/\n");
  writeFileSync(
    path.join(dir, "src", "payment.ts"),
    `import { Invoice } from "./invoice";\nexport function processPayment(amount: number) {\n  return Invoice.total(amount);\n}\n`,
  );
  writeFileSync(
    path.join(dir, "src", "invoice.ts"),
    `export class Invoice {\n  static total(x: number) { return x; }\n}\n`,
  );
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["commit", "-qm", "initial"]);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("searchText (FR-4.1/4.6)", () => {
  it("finds matches with file:line", () => {
    const matches = searchText({ cwd: dir, pattern: "processPayment" });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]).toMatchObject({ file: path.join("src", "payment.ts").replace(/\\/g, "/"), line: 2 });
  });

  it("honors .gitignore (FR-4.6)", () => {
    mkdirSync(path.join(dir, "node_modules"), { recursive: true });
    writeFileSync(path.join(dir, "node_modules", "junk.ts"), "processPayment in dependency\n");
    const matches = searchText({ cwd: dir, pattern: "processPayment" });
    expect(matches.every((m) => !m.file.includes("node_modules"))).toBe(true);
  });

  it("is case-insensitive by default, respects flag", () => {
    expect(searchText({ cwd: dir, pattern: "processpayment" }).length).toBeGreaterThan(0);
    expect(searchText({ cwd: dir, pattern: "processpayment", caseSensitive: true })).toHaveLength(0);
  });

  it("respects glob filter", () => {
    const matches = searchText({ cwd: dir, pattern: "Invoice", glob: "invoice.ts" });
    expect(matches.every((m) => m.file.endsWith("invoice.ts"))).toBe(true);
  });
});

describe("searchSymbols (FR-4.2)", () => {
  it("binary is available", () => {
    expect(astGrepBinary()).toBeTruthy();
  });

  it("finds function definitions", () => {
    const fns = searchSymbols({ cwd: dir, kind: "function" });
    expect(fns.some((f) => f.name === "processPayment")).toBe(true);
  });

  it("finds class definitions by name filter", () => {
    const cls = searchSymbols({ cwd: dir, name: "Invoice", kind: "class" });
    expect(cls).toHaveLength(1);
    expect(cls[0].file).toContain("invoice.ts");
  });
});

describe("git history (FR-4.3)", () => {
  it("pickaxe finds the introducing commit", () => {
    writeFileSync(path.join(dir, "src", "refund.ts"), `export function refund() { return 1; }\n`);
    git(["add", "-A"]);
    git(["commit", "-qm", "add refund feature"]);
    const matches = searchHistory(dir, "refund");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].message).toContain("refund");
  });

  it("blame reports author and line numbers", () => {
    const lines = blameFile(dir, "src/invoice.ts");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatchObject({ author: "t", line: 1 });
    expect(lines[0].commit).toMatch(/^[0-9a-f]{12}$/);
  });
});
