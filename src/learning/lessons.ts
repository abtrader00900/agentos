import { createHash } from "node:crypto";
import path from "node:path";
import { MemoryStore, oneLine, type Fact } from "../mcp/memory/store.js";
import { scanDiff, redact } from "../orchestrator/safety.js";
import { applyLearnedRules } from "../commands/learn.js";

export type Role = "planner" | "worker" | "reviewer" | "fixer";
export const ROLES: readonly Role[] = ["planner", "worker", "reviewer", "fixer"];
export type LessonStatus = "auto" | "pending" | "approved";

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
export interface Lesson { key: string; text: string; meta: LessonMeta }
export interface LessonDraft { text: string; roles: Role[]; evidence: string[]; sameAs?: string }

const TOPIC = "lessons";
export const MAX_ACTIVE = 200;
const PER_RUN = 3;
export const memoryFile = (root: string) => path.join(root, ".agentos", "memory.json");

export const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));

export function jaccard(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

export const lessonKey = (text: string) =>
  `L-${createHash("sha1").update(text.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex").slice(0, 8)}`;

const RISKY = [
  /https?:\/\//i, /\bwww\./i, /\|\s*(sh|bash|zsh|pwsh|powershell)\b/i, /\biex\b/i, /invoke-expression/i,
  /rm\s+-rf/i, /base64\s+(-d|--decode)/i,
];

/**
 * Lessons are written by a model that read repo content, so they can carry an injection. A secret is
 * dropped ("reject"). A URL, a pipe into a shell and the like can never be auto ("pending").
 */
export function safetyCheck(text: string): "ok" | "pending" | "reject" {
  // every line is an "added" line, so a secret on line 2+ of a skill draft is seen too
  const asDiff = `+++ b/lesson\n${text.split("\n").map((l) => `+${l}`).join("\n")}`;
  if (scanDiff(asDiff).length || redact(text) !== text) return "reject";
  return RISKY.some((r) => r.test(text)) ? "pending" : "ok";
}

function toLesson(f: Fact): Lesson {
  const m = (f.meta ?? {}) as Partial<LessonMeta>;
  return {
    key: f.key,
    text: f.value,
    meta: {
      status: m.status ?? "pending", roles: m.roles ?? [...ROLES], kind: m.kind, evidence: m.evidence ?? [],
      runs: m.runs ?? [], seen: m.seen ?? 1, uses: m.uses ?? 0, lastUsed: m.lastUsed,
    },
  };
}

export function listLessons(root: string, opts: { status?: LessonStatus[] } = {}): Lesson[] {
  return new MemoryStore(memoryFile(root))
    .recall({ topic: TOPIC, limit: Number.MAX_SAFE_INTEGER })
    .map(toLesson)
    .filter((l) => !opts.status || opts.status.includes(l.meta.status));
}

/** Store one run's lessons: safety filter, the status rule, and merging into an existing lesson. Returns the keys touched. */
export function saveLessons(root: string, runId: string, kind: string | undefined, drafts: LessonDraft[]): string[] {
  const store = new MemoryStore(memoryFile(root));
  const existing = listLessons(root);
  const touched: string[] = [];
  for (const d of drafts.slice(0, PER_RUN)) {
    const text = oneLine(d.text).slice(0, 300);
    const safety = text ? safetyCheck(text) : "reject";
    if (safety === "reject") continue;
    const evidence = d.evidence.map((e) => e.slice(0, 200));
    const status: LessonStatus = evidence.length && safety === "ok" ? "auto" : "pending";
    const same =
      (d.sameAs ? existing.find((l) => l.key === d.sameAs) : undefined) ??
      existing.find((l) => l.meta.roles.some((r) => d.roles.includes(r)) && jaccard(l.text, text) >= 0.6);
    if (same) {
      const m = same.meta;
      // upgrade only when the stored text is itself safe: a risky lesson never turns auto through a safe twin
      const upgraded = m.status === "pending" && status === "auto" && safetyCheck(same.text) === "ok" ? "auto" : m.status;
      const meta: LessonMeta = {
        ...m, status: upgraded,
        evidence: [...new Set([...m.evidence, ...evidence])].slice(-10),
        runs: [...new Set([...m.runs, runId])].slice(-20),
        seen: m.seen + 1,
      };
      store.store({ topic: TOPIC, key: same.key, value: same.text, meta: { ...meta } });
      same.meta = meta;
      touched.push(same.key);
      continue;
    }
    const key = lessonKey(text);
    const meta: LessonMeta = { status, roles: d.roles.length ? d.roles : [...ROLES], kind, evidence, runs: [runId], seen: 1, uses: 0 };
    store.store({ topic: TOPIC, key, value: text, source: `agentos run ${runId}`, meta: { ...meta } });
    existing.push({ key, text, meta });
    touched.push(key);
  }
  return touched;
}

function find(root: string, key: string): Lesson {
  const l = listLessons(root).find((x) => x.key === key);
  if (!l) throw new Error(`No lesson "${key}"`);
  return l;
}

export function approveLesson(root: string, key: string): Lesson {
  const l = find(root, key);
  const meta = { ...l.meta, status: "approved" as const };
  new MemoryStore(memoryFile(root)).store({ topic: TOPIC, key, value: l.text, meta: { ...meta } });
  return { ...l, meta };
}

export const forgetLesson = (root: string, key: string) => new MemoryStore(memoryFile(root)).forget(TOPIC, key);

/** Append the lesson as a rule to agent.config.local.yaml (review, then move it to agent.config.yaml). */
export function promoteLesson(root: string, key: string): number {
  const l = find(root, key);
  return applyLearnedRules(root, [{ id: `lesson-${key.slice(2)}`, text: l.text, evidence: l.meta.evidence.join("; ") }]);
}
