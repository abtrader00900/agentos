import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from "node:fs";
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
 * and Codex both running the memory server on one project), so every table()
 * access re-reads the file when another process changed it, and temp files are
 * per-process. ponytail: no file lock — two writes inside the same millisecond
 * can still race; add proper-lockfile if that ever shows up in practice.
 *
 * A SQLite backend can be added later behind the same interface if a
 * project ever outgrows this (100K+ facts).
 */

let tmpCounter = 0;

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
    this.seen = this.stamp();
    if (!this.seen) {
      this.data = {};
      return;
    }
    try {
      this.data = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, unknown[]>;
    } catch {
      // corrupt store: keep the bytes for recovery and start empty rather than
      // crash the host harness (or overwrite the only copy on the next save)
      try { renameSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch { /* best effort */ }
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
    renameSync(tmp, this.file);
    this.seen = this.stamp();
  }

  /** Every mutation already save()s; closing must not rewrite the file on a read-only open. */
  close(): void {}
}
