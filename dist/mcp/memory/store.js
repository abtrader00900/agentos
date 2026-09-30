import { JsonStore } from "../../core/jsonstore.js";
import { isPendingLesson } from "../../learning/status.js";
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
    /**
     * Read-modify-write one fact under the store lock: fn sees the fact as it is on disk now, and returns the
     * changes. A different key moves the fact (source and pinned kept) in the same write. Returns undefined,
     * changing nothing, when the fact no longer exists: a forgotten fact is never re-created.
     */
    patch(topic, key, fn) {
        return this.db.update(() => {
            const facts = this.db.table("facts");
            const i = facts.findIndex((f) => f.topic === topic && f.key === key);
            if (i < 0)
                return undefined;
            const cur = facts[i];
            const next = fn(structuredClone(cur));
            const newKey = next.key ?? key;
            if (newKey !== key)
                facts.splice(i, 1);
            return this.upsert({
                topic, key: newKey, value: next.value ?? cur.value, meta: next.meta ?? cur.meta,
                ...(newKey !== key ? { source: cur.source ?? undefined, pinned: !!cur.pinned } : {}),
            });
        });
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
            if (input.meta !== undefined)
                existing.meta = input.meta;
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
            ...(input.meta !== undefined ? { meta: input.meta } : {}),
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
        // free text: a fact matches if any word appears in its topic, key or value; more words matched ranks higher.
        // A whole-phrase match missed natural queries ("dist compiled build" found nothing, bench/RESULTS.md).
        // ponytail: word-count ranking, move to BM25 if stores grow to thousands of facts
        const hits = new Map();
        if (query.text) {
            const all = query.text.toLowerCase().split(/\s+/).filter(Boolean);
            const words = all.some((w) => w.length > 2) ? all.filter((w) => w.length > 2) : all; // skip "is", "a" …
            for (const f of facts) {
                const hay = `${f.topic} ${f.key} ${f.value}`.toLowerCase();
                hits.set(f, words.filter((w) => hay.includes(w)).length);
            }
            facts = facts.filter((f) => hits.get(f) > 0);
        }
        return facts
            .sort((a, b) => (hits.get(b) ?? 0) - (hits.get(a) ?? 0) || (b.pinned - a.pinned) || b.updated_at.localeCompare(a.updated_at))
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
            lines.push(`- **${oneLine(f.key)}**${pin}${isPendingLesson(f) ? " [pending]" : ""}: ${oneLine(f.value)}${src}`);
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