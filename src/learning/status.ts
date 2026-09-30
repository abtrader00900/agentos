import { createHash } from "node:crypto";
import type { Fact } from "../mcp/memory/store.js";

// a leaf module: the memory store and server import it without pulling in the rest of learning

export type LessonStatus = "auto" | "pending" | "approved";

export const lessonKey = (text: string) =>
  `L-${createHash("sha1").update(text.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex").slice(0, 8)}`;

/**
 * A lesson fact's status. agentos always stores a lesson under lessonKey(text); another key means the text
 * was swapped (memory_store keeps meta on an existing key), so it can never be auto or approved.
 */
export function lessonStatus(f: Fact): LessonStatus {
  const status = (f.meta as { status?: LessonStatus } | undefined)?.status;
  return status && f.key === lessonKey(f.value) ? status : "pending";
}

/** true for a lesson fact that must be shown as unreviewed */
export const isPendingLesson = (f: Fact) => f.topic === "lessons" && lessonStatus(f) === "pending";
