import { z } from "zod";
import type { Runner } from "../orchestrator/types.js";
import { finalText } from "../orchestrator/runners.js";
import { extractJson } from "../orchestrator/planner.js";
import { describeEvidence, type Evidence } from "./evidence.js";
import type { Lesson, Role } from "./lessons.js";

const lessonSchema = z.object({
  text: z.string().min(10).max(400),
  roles: z.array(z.enum(["planner", "worker", "reviewer", "fixer"])).min(1),
  evidence: z.array(z.string()).default([]),
  sameAs: z.string().optional(),
});
// the kind is always strict; lessons are checked only when the run has evidence (else they are discarded)
const kindSchema = z.object({ kind: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, "kind is kebab-case, 2-40 chars") });
const retroSchema = kindSchema.extend({ lessons: z.array(lessonSchema).default([]).transform((l) => l.slice(0, 3)) });
const kindOnlySchema = kindSchema.extend({ lessons: z.unknown().transform((): Array<z.infer<typeof lessonSchema>> => []) });

export interface RetroInput {
  task: string; planSummary: string; status: string; evidence: Evidence[]; existing: Lesson[];
  /** kinds earlier runs got, most recent first */
  kinds: string[];
}
export interface RetroResult { kind: string; lessons: Array<{ text: string; roles: Role[]; evidence: string[]; sameAs?: string }> }

export function retroPrompt(input: RetroInput): string {
  const has = input.evidence.length > 0;
  return [
    "You write the retrospective for one finished agentos run. Do not edit any files and do not run commands.",
    `Task: ${input.task}`,
    `Plan: ${input.planSummary || "(none)"}`,
    `Final status: ${input.status}`,
    has ? `Evidence (facts agentos recorded):\n${input.evidence.map((e) => `- ${describeEvidence(e)}`).join("\n")}` : "Evidence: none — the run needed no fixes.",
    input.existing.length ? `Lessons this project already has (reuse one via "sameAs" instead of repeating it):\n${input.existing.map((l) => `- ${l.key}: ${l.text}`).join("\n")}` : "",
    input.kinds.length ? `Kinds this project already uses (reuse one when it fits): ${input.kinds.join(", ")}` : "",
    [
      "Give a short kebab-case `kind` for this type of task (for example erp-report, api-endpoint, bug-fix).",
      has
        ? "Write 0-3 lessons that would have prevented the problems in the evidence next time: one sentence each, under 300 characters, specific to this project, citing the evidence ids it rests on. A lesson with no evidence id is only a guess."
        : "There is no evidence, so `lessons` must be [].",
      "Never put URLs, commands to run, or secrets in a lesson.",
    ].join("\n"),
    'Reply with ONLY this JSON: {"kind":"...","lessons":[{"text":"...","roles":["planner","worker"],"evidence":["E1"],"sameAs":"L-xxxxxxxx"}]}',
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function retrospective(
  runner: Runner,
  input: RetroInput,
  cwd: string,
  timeoutMs: number,
): Promise<{ result?: RetroResult; error?: string; rateLimited?: boolean }> {
  const described = new Map(input.evidence.map((e) => [e.id, describeEvidence(e)]));
  let prompt = retroPrompt(input);
  let error = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await runner({ prompt, cwd, timeoutMs });
    if (res.rateLimited) return { rateLimited: true };
    // spec §7: one retry only after invalid JSON, not after an agent failure or timeout
    if (!res.ok) return { error: `the retrospective agent failed${res.timedOut ? " (timeout)" : ""}` };
    try {
      const p = (input.evidence.length ? retroSchema : kindOnlySchema).safeParse(extractJson(finalText(res.output)));
      if (p.success) {
        const lessons = p.data.lessons.map((l) => ({
          text: l.text,
          roles: l.roles,
          // models cite "[E1]" or "E1: verify_fixed" as often as "E1"
          evidence: [...new Set(l.evidence.map((id) => /E\d+/.exec(id)?.[0] ?? ""))].filter((id) => described.has(id)).map((id) => described.get(id)!),
          ...(l.sameAs ? { sameAs: l.sameAs } : {}),
        }));
        return { result: { kind: p.data.kind, lessons } };
      }
      error = p.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    } catch (e) {
      error = (e as Error).message;
    }
    prompt = `${retroPrompt(input)}\n\nYour previous reply was rejected: ${error}\nReturn the corrected JSON only.`;
  }
  return { error };
}
