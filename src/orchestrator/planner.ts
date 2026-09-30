import type { AgentName, Plan, Runner } from "./types.js";
import { validatePlan } from "./plan.js";
import { finalText } from "./runners.js";

export interface PlannerInput {
  task: string;
  /** relevant project memory, "[topic/key] value" */
  facts: string[];
  files: string[];
  workers: AgentName[];
  /** lessons block from earlier runs ("" = none) */
  notes?: string;
}

export function plannerPrompt(input: PlannerInput): string {
  return [
    "You are the planner for a team of coding agents. Do not edit any files; read whatever you need.",
    `Task: ${input.task}`,
    input.facts.length ? `Project memory:\n${input.facts.map((f) => `- ${f}`).join("\n")}` : "",
    `Files in the repository (first ${input.files.length}):\n${input.files.join("\n")}`,
    input.notes ?? "",
    [
      `Split the task into 1-8 subtasks for these agents: ${input.workers.join(", ")}.`,
      "A small task is ONE subtask. Split only when parts are truly independent.",
      "Subtasks that run in parallel must change different files; if two subtasks touch the same file, chain them with dependsOn.",
      "Each prompt must stand alone: a worker sees only its prompt and the plan summary.",
      "Workers edit files only; agentos commits and runs the tests.",
    ].join("\n"),
    'Reply with ONLY this JSON: {"summary":"...","subtasks":[{"id":"kebab-id","title":"...","prompt":"...","files":["path"],"dependsOn":[],"agent":"claude"}]}',
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** the JSON object in an agent's reply: first "{" to last "}" */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object in the reply");
  return JSON.parse(text.slice(start, end + 1));
}

/** Ask for a plan; one retry that quotes the validation error. */
export async function makePlan(
  runner: Runner,
  input: PlannerInput,
  cwd: string,
  timeoutMs: number,
): Promise<{ plan?: Plan; error?: string; rateLimited?: boolean; rejected?: string }> {
  let prompt = plannerPrompt(input);
  let error = "";
  let firstError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await runner({ prompt, cwd, timeoutMs });
    if (res.rateLimited) return { rateLimited: true };
    if (!res.ok) {
      error = `the planner failed${res.timedOut ? " (timeout)" : ""}: ${res.output.slice(-500)}`;
      if (attempt === 0) firstError = error;
      continue;
    }
    try {
      const v = validatePlan(extractJson(finalText(res.output)), input.workers);
      if (v.plan) return { plan: v.plan, ...(attempt > 0 ? { rejected: firstError } : {}) };
      error = v.error!;
    } catch (e) {
      error = (e as Error).message;
    }
    if (attempt === 0) firstError = error;
    prompt = `${plannerPrompt(input)}\n\nYour previous plan was rejected: ${error}\nReturn the corrected JSON only.`;
  }
  return { error };
}
