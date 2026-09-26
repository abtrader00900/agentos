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
export declare class MemoryStore {
    private db;
    constructor(dbPath: string);
    store(input: FactInput): Fact;
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
