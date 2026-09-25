import { JsonStore } from "../../core/jsonstore.js";

/**
 * FR-3.x: persistent project memory.
 * Zero-dependency JSON store at <project>/.agentos/memory.json (atomic writes).
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
  private db: JsonStore;
  private nextId: number;

  constructor(dbPath: string) {
    this.db = new JsonStore(dbPath);
    const facts = this.db.table<Fact>("facts");
    this.nextId = facts.reduce((max, f) => Math.max(max, f.id), 0) + 1;
  }

  store(input: FactInput): Fact {
    const facts = this.db.table<Fact>("facts");
    const now = new Date().toISOString();
    const existing = facts.find((f) => f.topic === input.topic && f.key === input.key);
    if (existing) {
      existing.value = input.value;
      existing.source = input.source ?? null;
      existing.pinned = input.pinned ? 1 : 0;
      existing.updated_at = now;
      this.db.save();
      return { ...existing };
    }
    const fact: Fact = {
      id: this.nextId++,
      topic: input.topic,
      key: input.key,
      value: input.value,
      source: input.source ?? null,
      pinned: input.pinned ? 1 : 0,
      created_at: now,
      updated_at: now,
    };
    facts.push(fact);
    this.db.save();
    return { ...fact };
  }

  /** FR-3.5: recall by topic / key substring / free text in value */
  recall(query: { topic?: string; key?: string; text?: string; limit?: number } = {}): Fact[] {
    const limit = query.limit ?? 20;
    let facts = this.db.table<Fact>("facts");
    if (query.topic) facts = facts.filter((f) => f.topic === query.topic);
    if (query.key) {
      const k = query.key.toLowerCase();
      facts = facts.filter((f) => f.key.toLowerCase().includes(k));
    }
    if (query.text) {
      const t = query.text.toLowerCase();
      facts = facts.filter((f) => f.value.toLowerCase().includes(t));
    }
    return facts
      .sort((a, b) => (b.pinned - a.pinned) || b.updated_at.localeCompare(a.updated_at))
      .slice(0, limit)
      .map((f) => ({ ...f }));
  }

  get(topic: string, key: string): Fact | undefined {
    const f = this.db.table<Fact>("facts").find((x) => x.topic === topic && x.key === key);
    return f ? { ...f } : undefined;
  }

  forget(topic: string, key: string): boolean {
    const facts = this.db.table<Fact>("facts");
    const i = facts.findIndex((f) => f.topic === topic && f.key === key);
    if (i < 0) return false;
    facts.splice(i, 1);
    this.db.save();
    return true;
  }

  topics(): string[] {
    return [...new Set(this.db.table<Fact>("facts").map((f) => f.topic))].sort();
  }

  /** FR-3.4: git-diffable markdown export */
  exportMarkdown(): string {
    const facts = this.db.table<Fact>("facts")
      .slice()
      .sort((a, b) => a.topic.localeCompare(b.topic) || a.key.localeCompare(b.key));
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
    const facts = this.db.table<Fact>("facts");
    return { facts: facts.length, topics: new Set(facts.map((f) => f.topic)).size };
  }

  close(): void {
    this.db.close();
  }
}
