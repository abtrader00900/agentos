import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withLock } from "../src/core/jsonstore.js";

let dir: string;

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("withLock", () => {
  it("leaves a lock another process took over in place", () => {
    dir = mkdtempSync(path.join(tmpdir(), "agentos-lock-"));
    const file = path.join(dir, "store.json");
    const lock = `${file}.lock`;

    withLock(file, () => {
      // as if our lock had gone stale and another process claimed it
      writeFileSync(lock, "other-process-token");
    });

    expect(existsSync(lock)).toBe(true);
    expect(readFileSync(lock, "utf8")).toBe("other-process-token");
  });

  it("removes its own lock on the normal path", () => {
    dir = mkdtempSync(path.join(tmpdir(), "agentos-lock-"));
    const file = path.join(dir, "store.json");

    expect(withLock(file, () => 42)).toBe(42);
    expect(existsSync(`${file}.lock`)).toBe(false);
  });
});
