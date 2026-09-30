import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dropLock, withLock } from "../src/core/jsonstore.js";

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

describe("dropLock", () => {
  let lock = "";
  let taken = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "agentos-lock-"));
    lock = path.join(dir, "store.json.lock");
    taken = `${lock}.mine`;
  });

  it("deletes the file it took, never whatever holds the path by then", () => {
    writeFileSync(lock, "mine");

    // the interleaving a plain check-then-unlink gets wrong: while we are deciding,
    // another process finds the path free and installs its own lock there
    dropLock(lock, taken, p => {
      writeFileSync(lock, "other-process-token");
      return readFileSync(p, "utf8") === "mine";
    });

    expect(readFileSync(lock, "utf8")).toBe("other-process-token");
    expect(existsSync(taken)).toBe(false);
  });

  it("never hands a lock back onto a path someone else has claimed", () => {
    writeFileSync(lock, "stale-token");

    dropLock(lock, taken, () => {
      writeFileSync(lock, "other-process-token"); // acquired while we were deciding
      return false;
    });

    expect(readFileSync(lock, "utf8")).toBe("other-process-token");
    expect(existsSync(taken)).toBe(false);
  });

  it("keeps a lock it could not hand back instead of deleting it", () => {
    // link back fails for a reason other than the path being taken: the lock's own
    // directory is gone, so the file we took is all that is left of a live lock
    const held = path.join(dir, "held");
    const kept = path.join(dir, "store.json.lock.mine");
    mkdirSync(held);
    writeFileSync(path.join(held, "store.json.lock"), "other-process-token");

    dropLock(path.join(held, "store.json.lock"), kept, () => {
      rmSync(held, { recursive: true, force: true });
      return false;
    });

    expect(readFileSync(kept, "utf8")).toBe("other-process-token");
  });

  it("hands back a lock that turns out to be someone else's", () => {
    writeFileSync(lock, "other-process-token");

    dropLock(lock, taken, p => readFileSync(p, "utf8") === "mine");

    expect(readFileSync(lock, "utf8")).toBe("other-process-token");
    expect(existsSync(taken)).toBe(false);
  });
});
