import { z } from "zod";
import type { Runner } from "../orchestrator/types.js";
import { finalText } from "../orchestrator/runners.js";
import { extractJson } from "../orchestrator/planner.js";
import { describeEvidence, type Evidence } from "./evidence.js";
import type { Lesson, Role } from "./lessons.js";

const retroSchema = z.object({
  kind: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, "kind is kebab-case, 2-40 chars"),
  lessons: z
    .array(
      z.object({
        text: z.string().min(10).max(400),
        roles: z.array(z.enum(["planner", "worker", "reviewer", "fixer"])).min(1),
        evidence: z.array(z.string()).default([]),
        sameAs: z.string().optional(),
      }),
    )
    .max(3)
    .default([]),
});

export interface RetroInput { task: string; planSummary: string; status: string; evidence: Evidence[]; existing: Lesson[] }
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
      const p = retroSchema.safeParse(extractJson(finalText(res.output)));
      if (p.success) {
        const lessons = input.evidence.length
          ? p.data.lessons.map((l) => ({
              text: l.text,
              roles: l.roles,
              evidence: l.evidence.filter((id) => described.has(id)).map((id) => described.get(id)!),
              ...(l.sameAs ? { sameAs: l.sameAs } : {}),
            }))
          : [];
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
