// src/learning/learn-run.ts
import type { LearningConfig } from "../core/schema.js";
import type { AgentName, Runner } from "../orchestrator/types.js";
import { loadRun, saveRun, logEvent, listRuns, type RunState } from "../orchestrator/run.js";
import { collectEvidence } from "./evidence.js";
import { retrospective } from "./retro.js";
import { listLessons, saveLessons, jaccard } from "./lessons.js";
import { skillDue, draftSkill } from "./skilldraft.js";
import { redact } from "../orchestrator/safety.js";

const LEARNABLE: RunState["status"][] = ["pr_open", "needs_human", "failed"];

/**
 * Learn from one finished run. It never throws: the outcome lands in state.learned and the event log.
 * budgetMs is one deadline for every agent call it makes (the retrospective, its retry, the skill draft).
 */
export async function learnFromRun(
  root: string,
  runId: string,
  learning: LearningConfig,
  runners: Record<AgentName, { read: Runner; write: Runner }>,
  budgetMs: number,
  now: () => number = Date.now,
): Promise<"done" | "skipped" | "failed"> {
  const end = now() + budgetMs;
  const record = (learned: "done" | "skipped" | "failed", extra: Partial<RunState> & { reason?: string; lessons?: string[] } = {}) => {
    try {
      const cur = loadRun(root, runId);
      const { reason, lessons, ...fields } = extra;
      Object.assign(cur, { learned }, fields);
      saveRun(root, cur);
      logEvent(root, runId, { type: learned === "failed" ? "learn-failed" : "learn", learned, ...fields, ...(reason ? { reason: redact(reason).slice(0, 300) } : {}), ...(lessons ? { lessons } : {}) });
    } catch { /* the run record itself is unreadable: nothing to note */ }
    return learned;
  };
  try {
    const s = loadRun(root, runId);
    if (!LEARNABLE.includes(s.status)) return record("skipped", { reason: `status ${s.status}` });
    if (!learning.retro) return record("skipped", { reason: "learning.retro is false" });
    const evidence = collectEvidence(root, runId);
    const existing = listLessons(root, { status: ["auto", "approved"] }) // pending text never reaches a prompt
      .map((l) => ({ l, score: jaccard(l.text, s.task) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map((x) => x.l);
    // reusing a kind keeps skillDue counting; listRuns is most recent first
    const kinds = [...new Set(listRuns(root).map((r) => r.kind).filter((k): k is string => !!k))].slice(0, 30);
    const r = await retrospective(runners[learning.retroAgent].read, { task: s.task, planSummary: s.plan?.summary ?? "", status: s.status, evidence, existing, kinds }, root, end - now(), now);
    if (!r.result) return record("failed", { reason: r.rateLimited ? "rate limit" : r.error });
    const kind = r.result.kind;
    const cur = loadRun(root, runId);
    cur.kind = kind;
    saveRun(root, cur); // skillDue counts this run by its kind
    const lessons = saveLessons(root, runId, kind, r.result.lessons);
    let draft: string | undefined;
    if (s.status === "pr_open") {
      // the lessons are saved already: a draft error is logged, never turned into learned: "failed"
      try {
        const runs = skillDue(root, kind, learning.skillAfterRuns);
        const left = end - now();
        if (runs && left < 60_000) {
          // not a rejection: no tombstone, so a later run drafts it
          logEvent(root, runId, { type: "skill-draft-rejected", kind, reason: "no time left for the draft" });
        } else if (runs) {
          const d = await draftSkill(root, kind, runs, runners[learning.retroAgent].read, left);
          if (d.ok) draft = kind;
          else logEvent(root, runId, { type: "skill-draft-rejected", kind, reason: d.reason });
        }
      } catch (e) {
        logEvent(root, runId, { type: "skill-draft-rejected", kind, reason: (e as Error).message });
      }
    }
    return record("done", { kind, lessons, ...(draft ? { draft } : {}) });
  } catch (e) {
    return record("failed", { reason: (e as Error).message });
  }
}
