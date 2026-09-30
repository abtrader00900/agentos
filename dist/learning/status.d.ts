import type { Fact } from "../mcp/memory/store.js";
export type LessonStatus = "auto" | "pending" | "approved";
export declare const lessonKey: (text: string) => string;
/**
 * A lesson fact's status. agentos always stores a lesson under lessonKey(text); another key means the text
 * was swapped (memory_store keeps meta on an existing key), so it can never be auto or approved.
 */
export declare function lessonStatus(f: Fact): LessonStatus;
/** true for a lesson fact that must be shown as unreviewed */
export declare const isPendingLesson: (f: Fact) => boolean;
