import { readFileSync, writeFileSync, writeSync, renameSync, linkSync, mkdirSync, statSync, openSync, closeSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * Zero-dependency persistent JSON store.
 *
 * v0.1 deliberately avoids native modules (better-sqlite3 etc.) so that
 * `npm install` never compiles anything — install friction is zero on any
 * machine, which matters for a local-first tool. Storage is atomic
 * (write tmp + rename) and the whole dataset lives in memory, which is
 * more than fast enough for project-scale memory/graphs.
 *
 * Several harness processes may hold the same store open at once (Claude Code
 * and Codex both running the memory server on one project):
 *   - reads re-load the file when another process changed it;
 *   - writes go through update(), which holds a lock file across
 *     re-read → modify → write, so concurrent writers never drop each other's facts;
 *   - on Windows a rename onto a file another process has open fails with
 *     EPERM/EBUSY for a moment — writes and reads retry briefly.
 *
 * A SQLite backend can be added later behind the same interface if a
 * project ever outgrows this (100K+ facts).
 */

let tmpCounter = 0;
const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES", "EEXIST"]);
const LOCK_TIMEOUT_MS = 5_000;
/** a lock older than this belongs to a process that died mid-write */
const STALE_LOCK_MS = 10_000;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run fn, retrying transient Windows file-sharing errors for up to ~1s. */
export function retrying<T>(fn: () => T): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (attempt >= 20 || !RETRYABLE.has(code) || code === "EEXIST") throw e;
      sleep(10 + attempt * 5);
    }
  }
}

/**
 * Remove the lock file, but only the one `mine` recognises.
 *
 * Checking the file and then unlinking the path is racy: a lock can change hands
 * in between and the wrong one gets deleted. rename has exactly one winner, so
 * moving the file to a path only this caller knows hands us the file itself —
 * and whatever we then inspect is the thing we delete. A lock that turns out to
 * belong to someone else goes back by link, not rename: rename would replace a
 * lock somebody acquired in the meantime, link fails instead — and a lock path
 * that is occupied again makes the file we took obsolete, so it just goes.
 */
export function dropLock(lock: string, to: string, mine: (taken: string) => boolean): void {
  try { renameSync(lock, to); } catch { return; } // already gone, or another process won it
  let ours = false;
  try { ours = mine(to); } catch { /* unreadable: treat as someone else's */ }
  if (!ours) {
    try {
      retrying(() => linkSync(to, lock));
    } catch (e) {
      // EEXIST means the path holds a live lock again, so the file we took is obsolete.
      // Any other failure (no hard links on this filesystem, I/O error) means we could
      // not give the lock back — keep the file rather than delete another holder's lock.
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") return;
    }
  }
  try { unlinkSync(to); } catch { /* best effort */ }
}

/**
 * Run fn while holding `${file}.lock`, so concurrent processes serialise a
 * read-modify-write instead of overwriting each other. A lock left behind by a
 * process that died mid-write is cleared once it goes stale — so the lock file
 * carries a token identifying its holder, and is only removed while it still
 * holds ours (a slow holder must not delete the lock that took its place).
 */
export function withLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`;
  const token = randomUUID();
  const taken = `${lock}.${token}`; // no other holder ever touches this path
  const stale = (p: string) => {
    try { return Date.now() - statSync(p).mtimeMs > STALE_LOCK_MS; } catch { return false; }
  };
  mkdirSync(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd: number | undefined;
  for (let attempt = 0; fd === undefined; attempt++) {
    try {
      const opened = openSync(lock, "wx");
      try {
        writeSync(opened, token); // stamped before we count as the holder
      } catch (e) {
        // an unstamped lock is ours and nobody else's business: take it with us
        closeSync(opened);
        try { unlinkSync(lock); } catch { /* best effort */ }
        throw e;
      }
      fd = opened;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (!RETRYABLE.has(code)) throw e;
      if (stale(lock)) dropLock(lock, taken, stale); // re-checked on the file we took
      if (Date.now() > deadline) throw new Error(`${file} is locked by another process (${lock})`);
      sleep(Math.min(50, 2 + attempt));
    }
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    // a lock already taken over is left alone entirely; dropLock settles the rest
    try {
      if (readFileSync(lock, "utf8") === token) {
        dropLock(lock, taken, p => readFileSync(p, "utf8") === token);
      }
    } catch { /* gone or unreadable: nothing of ours to clean up */ }
  }
}

interface Stamp { mtimeMs: number; size: number }

export class JsonStore {
  private data: Record<string, unknown[]> = {};
  private file: string;
  /** what the file looked like when we last read or wrote it */
  private seen: Stamp | null = null;

  constructor(file: string) {
    this.file = file;
    mkdirSync(path.dirname(file), { recursive: true });
    this.load();
  }

  private stamp(): Stamp | null {
    try {
      const s = statSync(this.file);
      return { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return null;
    }
  }

  private load(): void {
    const stamp = this.stamp();
    if (!stamp) {
      this.data = {};
      this.seen = null;
      return;
    }
    // an I/O error (file held open by another process, permissions) is NOT corruption:
    // let it surface instead of quarantining a healthy store
    const text = retrying(() => readFileSync(this.file, "utf8"));
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      this.data = parsed as Record<string, unknown[]>;
      this.seen = stamp;
    } catch {
      // corrupt store: keep the bytes for recovery and start empty rather than
      // crash the host harness (or overwrite the only copy on the next save)
      try { renameSync(this.file, `${this.file}.corrupt-${Date.now()}-${process.pid}`); } catch { /* best effort */ }
      this.data = {};
      this.seen = null;
    }
  }

  /** Pick up writes made by another process since we last read or wrote. */
  private reloadIfChanged(): void {
    const now = this.stamp();
    const same =
      (!now && !this.seen) ||
      (!!now && !!this.seen && now.mtimeMs === this.seen.mtimeMs && now.size === this.seen.size);
    if (!same) this.load();
  }

  table<T>(name: string): T[] {
    this.reloadIfChanged();
    if (!this.data[name]) this.data[name] = [];
    return this.data[name] as T[];
  }

  save(): void {
    const tmp = `${this.file}.${process.pid}.${++tmpCounter}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    try {
      retrying(() => renameSync(tmp, this.file));
    } catch (e) {
      try { unlinkSync(tmp); } catch { /* already gone */ }
      throw e;
    }
    this.seen = this.stamp();
  }

  /**
   * Read-modify-write under a cross-process lock: the file is re-read inside the
   * lock (a same-size write within one mtime tick cannot be missed), fn mutates
   * this.table(...), and the result is saved before the lock is released.
   */
  update<R>(fn: () => R): R {
    return withLock(this.file, () => {
      this.load();
      const result = fn();
      this.save();
      return result;
    });
  }

  /** Every mutation already saves; closing must not rewrite the file on a read-only open. */
  close(): void {}
}
