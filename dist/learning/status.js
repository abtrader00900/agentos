import { createHash } from "node:crypto";
export const lessonKey = (text) => `L-${createHash("sha1").update(text.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex").slice(0, 8)}`;
/**
 * A lesson fact's status. agentos always stores a lesson under lessonKey(text); another key means the text
 * was swapped (memory_store keeps meta on an existing key), so it can never be auto or approved.
 */
export function lessonStatus(f) {
    const status = f.meta?.status;
    return status && f.key === lessonKey(f.value) ? status : "pending";
}
/** true for a lesson fact that must be shown as unreviewed */
export const isPendingLesson = (f) => f.topic === "lessons" && lessonStatus(f) === "pending";
//# sourceMappingURL=status.js.map