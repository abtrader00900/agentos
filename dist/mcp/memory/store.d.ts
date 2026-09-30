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
    /** structured extras (lessons: status, roles, evidence …); absent on plain facts */
    meta?: Record<string, unknown>;
}
export interface FactInput {
    topic: string;
    key: string;
    value: string;
    source?: string;
    pinned?: boolean;
    meta?: Record<string, unknown>;
}
/** a fact is one list item: newlines in it would start new headings/items in the export */
export declare const oneLine: (s: string) => string;
export declare class MemoryStore {
    private db;
    constructor(dbPath: string);
    store(input: FactInput): Fact;
    /**
     * Read-modify-write one fact under the store lock: fn sees the fact as it is on disk now, and returns the
     * changes. A different key moves the fact (source and pinned kept) in the same write. Returns undefined,
     * changing nothing, when the fact no longer exists: a forgotten fact is never re-created.
     */
    patch(topic: string, key: string, fn: (f: Fact) => {
        key?: string;
        value?: string;
        meta?: Record<string, unknown>;
    }): Fact | undefined;
    private upsert;
    /** FR-3.5: recall by topic / key substring / free text in value */
    recall(query?: {
        topic?: string;
        key?: string;
        text?: string;
        limit?: number;
    }): Fact[];
    get(topic: string, key: string): Fact | undefined;
    forget(topic: string, key: string): boolean;
    topics(): string[];
    /** FR-3.4: git-diffable markdown export */
    exportMarkdown(): string;
    stats(): {
        facts: number;
        topics: number;
    };
    close(): void;
}
