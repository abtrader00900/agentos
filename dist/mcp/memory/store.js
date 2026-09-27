import { JsonStore } from "../../core/jsonstore.js";
/** a fact is one list item: newlines in it would start new headings/items in the export */
export const oneLine = (s) => s.replace(/\s*\r?\n\s*/g, " ").trim();
export class MemoryStore {
    db;
    constructor(dbPath) {
        this.db = new JsonStore(dbPath);
    }
    store(input) {
        // under the store lock: two harnesses writing at once must not drop each other's facts
        return this.db.update(() => this.upsert(input));
    }
    upsert(input) {
        const facts = this.db.table("facts");
        const now = new Date().toISOString();
        const existing = facts.find((f) => f.topic === input.topic && f.key === input.key);
        if (existing) {
            existing.value = input.value;
            // an update that does not mention source/pinned keeps them (re-storing a fact used to unpin it)
            if (input.source !== undefined)
                existing.source = input.source;
            if (input.pinned !== undefined)
                existing.pinned = input.pinned ? 1 : 0;
            existing.updated_at = now;
            return { ...existing };
        }
        const fact = {
            id: facts.reduce((max, f) => Math.max(max, f.id), 0) + 1, // per write: another process may have added facts
            topic: input.topic,
            key: input.key,
            value: input.value,
            source: input.source ?? null,
            pinned: input.pinned ? 1 : 0,
            created_at: now,
            updated_at: now,
        };
        facts.push(fact);
        return { ...fact };
    }
    /** FR-3.5: recall by topic / key substring / free text in value */
    recall(query = {}) {
        const limit = query.limit ?? 20;
        // a copy: sorting the live table would reorder what the next save writes
        let facts = this.db.table("facts").slice();
        if (query.topic)
            facts = facts.filter((f) => f.topic === query.topic);
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
    get(topic, key) {
        const f = this.db.table("facts").find((x) => x.topic === topic && x.key === key);
        return f ? { ...f } : undefined;
    }
    forget(topic, key) {
        return this.db.update(() => {
            const facts = this.db.table("facts");
            const i = facts.findIndex((f) => f.topic === topic && f.key === key);
            if (i < 0)
                return false;
            facts.splice(i, 1);
            return true;
        });
    }
    topics() {
        return [...new Set(this.db.table("facts").map((f) => f.topic))].sort();
    }
    /** FR-3.4: git-diffable markdown export */
    exportMarkdown() {
        const facts = this.db.table("facts")
            .slice()
            .sort((a, b) => a.topic.localeCompare(b.topic) || a.key.localeCompare(b.key));
        const lines = ["# AgentOS Memory Export", ""];
        let currentTopic = "";
        for (const f of facts) {
            if (f.topic !== currentTopic) {
                currentTopic = f.topic;
                lines.push(`## ${oneLine(currentTopic)}`, "");
            }
            const pin = f.pinned ? " 📌" : "";
            const src = f.source ? ` _(source: ${oneLine(f.source)})_` : "";
            lines.push(`- **${oneLine(f.key)}**${pin}: ${oneLine(f.value)}${src}`);
        }
        return lines.join("\n") + "\n";
    }
    stats() {
        const facts = this.db.table("facts");
        return { facts: facts.length, topics: new Set(facts.map((f) => f.topic)).size };
    }
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=store.js.map