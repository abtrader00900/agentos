import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
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
 * A SQLite backend can be added later behind the same interface if a
 * project ever outgrows this (100K+ facts).
 */

export class JsonStore {
  private data: Record<string, unknown[]> = {};
  private file: string;

  constructor(file: string) {
    this.file = file;
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(file)) {
      try {
        this.data = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown[]>;
      } catch {
        // corrupt store: start empty rather than crash the host harness
        this.data = {};
      }
    }
  }

  table<T>(name: string): T[] {
    if (!this.data[name]) this.data[name] = [];
    return this.data[name] as T[];
  }

  save(): void {
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }

  close(): void {
    this.save();
  }
}
