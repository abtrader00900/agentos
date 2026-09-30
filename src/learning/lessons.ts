import path from "node:path";
import { MemoryStore, oneLine, type Fact } from "../mcp/memory/store.js";
import { secretHits, redact } from "../orchestrator/safety.js";
import { applyLearnedRules } from "../commands/learn.js";
import { lessonKey, lessonStatus, type LessonStatus } from "./status.js";

export { lessonKey, lessonStatus, type LessonStatus };
export type Role = "planner" | "worker" | "reviewer" | "fixer";
export const ROLES: readonly Role[] = ["planner", "worker", "reviewer", "fixer"];

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

/** longer text is rejected unchecked: several safety regexes backtrack quadratically on hostile input */
export const MAX_CHECKED = 20_000;

const INTERP = "(?:sh|bash|zsh|pwsh|powershell|python\\d*|node|perl|ruby)";
const RISKY = [
  /https?:\/\//i, /\bwww\./i, /\biex\b/i, /invoke-expression/i, /base64\s+(-d|--decode)/i,
  // a pipe or chain into an interpreter, also via sudo (with flags), env or a path: `| sudo -E /bin/bash`
  new RegExp(`(?:\\||&&|;)\\s*(?:sudo(?:\\s+-\\S+)*\\s+)?(?:env\\s+)?(?:\\S*[\\/])?${INTERP}\\b`, "i"),
  /\b(ba)?sh\s+-c\b/i,
  /\b(?:pwsh|powershell)(?:\.exe)?\b.*\s-e(?:nc|ncodedcommand)?\b/i,
  /\b(?:zsh|python\d*|node|perl|ruby)\s+-(?:c|e)\b/i,
  /\b(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b/i,
  /rm\s+-[a-z]*(rf|fr)/i,
];

/**
 * Lessons are written by a model that read repo content, so they can carry an injection. A secret is
 * dropped ("reject"). A URL, a pipe into a shell and the like can never be auto ("pending").
 */
export function safetyCheck(text: string): "ok" | "pending" | "reject" {
  if (text.length > MAX_CHECKED || secretHits(text).length || redact(text) !== text) return "reject";
  return RISKY.some((r) => r.test(text)) ? "pending" : "ok";
}

function toLesson(f: Fact): Lesson {
  const m = (f.meta ?? {}) as Partial<LessonMeta>;
  return {
    key: f.key,
    text: f.value,
    meta: {
      status: lessonStatus(f), roles: m.roles ?? [...ROLES], kind: m.kind, evidence: m.evidence ?? [],
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
    // check the whole text first: a secret straddling the 300-char cut must never be stored partially.
    // Over MAX_CHECKED it is rejected before any regex (oneLine's included) runs on it.
    const full = d.text.length > MAX_CHECKED ? "" : oneLine(d.text);
    const safety = full ? safetyCheck(full) : "reject";
    if (safety === "reject") continue;
    const text = full.slice(0, 300);
    // evidence is a fact about the run, but its text can still carry a secret from a failing command's output
    const evidence = d.evidence.filter((e) => safetyCheck(e) !== "reject").map((e) => e.slice(0, 200));
    const status: LessonStatus = evidence.length && safety === "ok" ? "auto" : "pending";
    const roles = d.roles.length ? d.roles : ROLES;
    const shares = (l: Lesson) => l.meta.roles.some((r) => roles.includes(r));
    let same = d.sameAs ? existing.find((l) => l.key === d.sameAs && shares(l)) : undefined;
    if (!same) {
      // best match among lessons for the same roles; a safe evidenced lesson is never absorbed into a risky one
      let best = 0.6;
      for (const l of existing) {
        if (!shares(l) || (safety === "ok" && safetyCheck(l.text) !== "ok")) continue;
        const j = jaccard(l.text, text);
        if (j >= best) { same = l; best = j; }
      }
    }
    same ??= existing.find((l) => l.key === lessonKey(text)); // identical text always merges: a fresh store would overwrite it
    if (same) {
      // a merge adds evidence, never changes the status: sameAs is model-chosen, so it could attach real
      // evidence to any pending lesson. It works on the fact as it is now, not on the snapshot above.
      const merged = store.patch(TOPIC, same.key, (f) => {
        const m = toLesson(f).meta;
        return {
          meta: {
            ...f.meta,
            evidence: mergeEvidence(m.evidence, evidence),
            runs: [...new Set([...m.runs, runId])].slice(-20),
            seen: m.seen + 1,
          },
        };
      });
      if (merged) { // undefined: forgotten meanwhile, and a merge never brings it back
        same.meta = toLesson(merged).meta;
        touched.push(same.key);
      }
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

/** evidence ids and failure excerpts differ between runs; the fact they describe does not */
const evidenceKey = (e: string) => e.replace(/^E\d+:\s*/, "").replace(/\. Failure: [\s\S]*$/, "");

function mergeEvidence(a: string[], b: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const e of [...a, ...b]) if (!byKey.has(evidenceKey(e))) byKey.set(evidenceKey(e), e);
  return [...byKey.values()].slice(-10);
}

function find(root: string, key: string): Lesson {
  const l = listLessons(root).find((x) => x.key === key);
  if (!l) throw new Error(`No lesson "${key}"`);
  return l;
}

/** The owner approves the text they see; a swapped text is re-keyed so the approval sticks. */
export function approveLesson(root: string, key: string): Lesson {
  find(root, key);
  // one locked write: the approval keeps runs merged meanwhile, and the re-key cannot resurrect a forgotten lesson
  const f = new MemoryStore(memoryFile(root)).patch(TOPIC, key, (cur) => ({
    key: lessonKey(cur.value),
    meta: { ...toLesson(cur).meta, status: "approved" },
  }));
  if (!f) throw new Error(`No lesson "${key}"`);
  return toLesson(f);
}

export const forgetLesson = (root: string, key: string) => new MemoryStore(memoryFile(root)).forget(TOPIC, key);

/** Append the lesson as a rule to agent.config.local.yaml (review, then move it to agent.config.yaml). */
export function promoteLesson(root: string, key: string): number {
  const l = find(root, key);
  if (l.meta.status === "pending") throw new Error(`lesson ${key} is pending — approve it first`);
  return applyLearnedRules(root, [{ id: `lesson-${key.slice(2)}`, text: l.text, evidence: l.meta.evidence.join("; ") }]);
}
