import { createHash } from "node:crypto";
import path from "node:path";
import { MemoryStore, oneLine } from "../mcp/memory/store.js";
import { secretHits, redact } from "../orchestrator/safety.js";
import { applyLearnedRules } from "../commands/learn.js";
export const ROLES = ["planner", "worker", "reviewer", "fixer"];
const TOPIC = "lessons";
export const MAX_ACTIVE = 200;
const PER_RUN = 3;
export const memoryFile = (root) => path.join(root, ".agentos", "memory.json");
export const words = (s) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
export function jaccard(a, b) {
    const A = words(a);
    const B = words(b);
    if (!A.size || !B.size)
        return 0;
    let both = 0;
    for (const w of A)
        if (B.has(w))
            both++;
    return both / (A.size + B.size - both);
}
export const lessonKey = (text) => `L-${createHash("sha1").update(text.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex").slice(0, 8)}`;
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
export function safetyCheck(text) {
    if (secretHits(text).length || redact(text) !== text)
        return "reject";
    return RISKY.some((r) => r.test(text)) ? "pending" : "ok";
}
/**
 * A lesson fact's status. agentos always stores a lesson under lessonKey(text); another key means the text
 * was swapped (memory_store keeps meta on an existing key), so it can never be auto or approved.
 */
export function lessonStatus(f) {
    const status = f.meta?.status;
    return status && f.key === lessonKey(f.value) ? status : "pending";
}
function toLesson(f) {
    const m = (f.meta ?? {});
    return {
        key: f.key,
        text: f.value,
        meta: {
            status: lessonStatus(f), roles: m.roles ?? [...ROLES], kind: m.kind, evidence: m.evidence ?? [],
            runs: m.runs ?? [], seen: m.seen ?? 1, uses: m.uses ?? 0, lastUsed: m.lastUsed,
        },
    };
}
export function listLessons(root, opts = {}) {
    return new MemoryStore(memoryFile(root))
        .recall({ topic: TOPIC, limit: Number.MAX_SAFE_INTEGER })
        .map(toLesson)
        .filter((l) => !opts.status || opts.status.includes(l.meta.status));
}
/** Store one run's lessons: safety filter, the status rule, and merging into an existing lesson. Returns the keys touched. */
export function saveLessons(root, runId, kind, drafts) {
    const store = new MemoryStore(memoryFile(root));
    const existing = listLessons(root);
    const touched = [];
    // ponytail: read-modify-write outside the store lock, so a concurrent `uses` bump (made when a lesson goes
    // into a prompt) can be lost; upgrade path: do the whole merge inside one MemoryStore update.
    for (const d of drafts.slice(0, PER_RUN)) {
        // check the whole text first: a secret straddling the 300-char cut must never be stored partially
        const full = oneLine(d.text);
        const safety = full ? safetyCheck(full) : "reject";
        if (safety === "reject")
            continue;
        const text = full.slice(0, 300);
        // evidence is a fact about the run, but its text can still carry a secret from a failing command's output
        const evidence = d.evidence.filter((e) => safetyCheck(e) !== "reject").map((e) => e.slice(0, 200));
        const status = evidence.length && safety === "ok" ? "auto" : "pending";
        const roles = d.roles.length ? d.roles : ROLES;
        const shares = (l) => l.meta.roles.some((r) => roles.includes(r));
        let same = d.sameAs ? existing.find((l) => l.key === d.sameAs && shares(l)) : undefined;
        if (!same) {
            // best match among lessons for the same roles; a safe evidenced lesson is never absorbed into a risky one
            let best = 0.6;
            for (const l of existing) {
                if (!shares(l) || (safety === "ok" && safetyCheck(l.text) !== "ok"))
                    continue;
                const j = jaccard(l.text, text);
                if (j >= best) {
                    same = l;
                    best = j;
                }
            }
        }
        same ??= existing.find((l) => l.key === lessonKey(text)); // identical text always merges: a fresh store would overwrite it
        if (same) {
            const m = same.meta;
            // upgrade only when the stored text is itself safe: a risky lesson never turns auto through a safe twin
            const upgraded = m.status === "pending" && status === "auto" && safetyCheck(same.text) === "ok" ? "auto" : m.status;
            const meta = {
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
        const meta = { status, roles: d.roles.length ? d.roles : [...ROLES], kind, evidence, runs: [runId], seen: 1, uses: 0 };
        store.store({ topic: TOPIC, key, value: text, source: `agentos run ${runId}`, meta: { ...meta } });
        existing.push({ key, text, meta });
        touched.push(key);
    }
    return touched;
}
function find(root, key) {
    const l = listLessons(root).find((x) => x.key === key);
    if (!l)
        throw new Error(`No lesson "${key}"`);
    return l;
}
/** The owner approves the text they see; a swapped text is re-keyed so the approval sticks. */
export function approveLesson(root, key) {
    const l = find(root, key);
    const meta = { ...l.meta, status: "approved" };
    const store = new MemoryStore(memoryFile(root));
    const newKey = lessonKey(l.text);
    store.store({ topic: TOPIC, key: newKey, value: l.text, meta: { ...meta } });
    if (newKey !== key)
        store.forget(TOPIC, key);
    return { key: newKey, text: l.text, meta };
}
export const forgetLesson = (root, key) => new MemoryStore(memoryFile(root)).forget(TOPIC, key);
/** Append the lesson as a rule to agent.config.local.yaml (review, then move it to agent.config.yaml). */
export function promoteLesson(root, key) {
    const l = find(root, key);
    return applyLearnedRules(root, [{ id: `lesson-${key.slice(2)}`, text: l.text, evidence: l.meta.evidence.join("; ") }]);
}
//# sourceMappingURL=lessons.js.map