import { lessonKey, lessonStatus, type LessonStatus } from "./status.js";
export { lessonKey, lessonStatus, type LessonStatus };
export type Role = "planner" | "worker" | "reviewer" | "fixer";
export declare const ROLES: readonly Role[];
export interface LessonMeta {
    status: LessonStatus;
    roles: Role[];
    kind?: string;
    /** evidence descriptions ("E1: verify_fixed: …") */
    evidence: string[];
    runs: string[];
    seen: number;
    uses: number;
    lastUsed?: string;
}
export interface Lesson {
    key: string;
    text: string;
    meta: LessonMeta;
}
export interface LessonDraft {
    text: string;
    roles: Role[];
    evidence: string[];
    sameAs?: string;
}
export declare const MAX_ACTIVE = 200;
export declare const memoryFile: (root: string) => string;
export declare const words: (s: string) => Set<string>;
export declare function jaccard(a: string, b: string): number;
/** longer text is rejected unchecked: several safety regexes backtrack quadratically on hostile input */
export declare const MAX_CHECKED = 20000;
/**
 * Lessons are written by a model that read repo content, so they can carry an injection. A secret is
 * dropped ("reject"). A URL, a pipe into a shell and the like can never be auto ("pending").
 */
export declare function safetyCheck(text: string): "ok" | "pending" | "reject";
export declare function listLessons(root: string, opts?: {
    status?: LessonStatus[];
}): Lesson[];
/** Store one run's lessons: safety filter, the status rule, and merging into an existing lesson. Returns the keys touched. */
export declare function saveLessons(root: string, runId: string, kind: string | undefined, drafts: LessonDraft[]): string[];
/** The owner approves the text they see; a swapped text is re-keyed so the approval sticks. */
export declare function approveLesson(root: string, key: string): Lesson;
export declare const forgetLesson: (root: string, key: string) => boolean;
/** Append the lesson as a rule to agent.config.local.yaml (review, then move it to agent.config.yaml). */
export declare function promoteLesson(root: string, key: string): number;
