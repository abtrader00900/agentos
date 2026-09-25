import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";

/**
 * FR-3.x: persistent project memory.
 * SQLite (WAL, crash-safe) at <project>/.agentos/memory.db
 * Facts are timestamped + source-tagged (FR-3.2) and exportable to markdown (FR-3.4).
 */

export interface Fact {
  id: number;
  topic: string;
  key: string;
  value: string;
  source: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
}

export interface FactInput {
  topic: string;
  key: string;
  value: string;
  source?: string;
  pinned?: boolean;
}

export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        source TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(topic, key)
      );
      CREATE INDEX IF NOT EXISTS idx_facts_topic ON facts(topic);
    `);
  }

  private upsert = () =>
    this.db.prepare(`
      INSERT INTO facts (topic, key, value, source, pinned)
      VALUES (@topic, @key, @value, @source, @pinned)
      ON CONFLICT(topic, key) DO UPDATE SET
        value = excluded.value,
        source = excluded.source,
        pinned = excluded.pinned,
        updated_at = datetime('now')
    `);

  private select = () =>
    this.db.prepare(`SELECT * FROM facts WHERE id = ?`);

  store(input: FactInput): Fact {
    const info = this.upsert().run({
      topic: input.topic,
      key: input.key,
      value: input.value,
      source: input.source ?? null,
      pinned: input.pinned ? 1 : 0,
    });
    return this.select().get(info.lastInsertRowid) as Fact;
  }

  /** FR-3.5: recall by topic / key substring / free text in value */
  recall(query: { topic?: string; key?: string; text?: string; limit?: number } = {}): Fact[] {
    const cond: string[] = [];
    const params: Record<string, unknown> = { limit: query.limit ?? 20 };
    if (query.topic) { cond.push("topic = @topic"); params.topic = query.topic; }
    if (query.key) { cond.push("key LIKE @key"); params.key = `%${query.key}%`; }
    if (query.text) { cond.push("value LIKE @text"); params.text = `%${query.text}%`; }
    const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
    return this.db
      .prepare(`SELECT * FROM facts ${where} ORDER BY pinned DESC, updated_at DESC LIMIT @limit`)
      .all(params) as Fact[];
  }

  get(topic: string, key: string): Fact | undefined {
    return this.db.prepare(`SELECT * FROM facts WHERE topic = ? AND key = ?`).get(topic, key) as Fact | undefined;
  }

  forget(topic: string, key: string): boolean {
    return this.db.prepare(`DELETE FROM facts WHERE topic = ? AND key = ?`).run(topic, key).changes > 0;
  }

  topics(): string[] {
    return (this.db.prepare(`SELECT DISTINCT topic FROM facts ORDER BY topic`).all() as { topic: string }[]).map((r) => r.topic);
  }

  /** FR-3.4: git-diffable markdown export */
  exportMarkdown(): string {
    const facts = this.db
      .prepare(`SELECT * FROM facts ORDER BY topic, key`)
      .all() as Fact[];
    const lines = ["# AgentOS Memory Export", ""];
    let currentTopic = "";
    for (const f of facts) {
      if (f.topic !== currentTopic) {
        currentTopic = f.topic;
        lines.push(`## ${currentTopic}`, "");
      }
      const pin = f.pinned ? " 📌" : "";
      const src = f.source ? ` _(source: ${f.source})_` : "";
      lines.push(`- **${f.key}**${pin}: ${f.value}${src}`);
    }
    return lines.join("\n") + "\n";
  }

  stats(): { facts: number; topics: number } {
    const facts = (this.db.prepare(`SELECT COUNT(*) AS c FROM facts`).get() as { c: number }).c;
    const topics = (this.db.prepare(`SELECT COUNT(DISTINCT topic) AS c FROM facts`).get() as { c: number }).c;
    return { facts, topics };
  }

  close(): void {
    this.db.close();
  }
}
