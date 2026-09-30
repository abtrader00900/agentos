import { z } from "zod";
import { agentNameSchema } from "../core/schema.js";
import type { Plan } from "./types.js";

const planSchema = z.object({
  summary: z.string().min(1),
  subtasks: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "ids are lowercase letters, digits and dashes"),
        title: z.string().min(1),
        prompt: z.string().min(1),
        files: z.array(z.string()).default([]),
        dependsOn: z.array(z.string()).default([]),
        agent: agentNameSchema,
      }),
    )
    .min(1)
    .max(8),
});

const norm = (f: string) => f.replace(/\\/g, "/").replace(/^\.\//, "");

/** Kahn's algorithm: ids with dependencies first. Throws on a cycle. */
export function topoOrder(plan: Plan): string[] {
  const left = new Map(plan.subtasks.map((s) => [s.id, s.dependsOn.length]));
  const queue = plan.subtasks.filter((s) => s.dependsOn.length === 0).map((s) => s.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of plan.subtasks) {
      if (!s.dependsOn.includes(id)) continue;
      const n = left.get(s.id)! - 1;
      left.set(s.id, n);
      if (n === 0) queue.push(s.id);
    }
  }
  if (order.length !== plan.subtasks.length) {
    const stuck = plan.subtasks.filter((s) => !order.includes(s.id)).map((s) => s.id);
    throw new Error(`dependency cycle between: ${stuck.join(", ")}`);
  }
  return order;
}

/** does `from` depend on `to`, directly or through other subtasks? */
function reaches(plan: Plan, from: string, to: string): boolean {
  const byId = new Map(plan.subtasks.map((s) => [s.id, s]));
  const stack = [...byId.get(from)!.dependsOn];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...byId.get(id)!.dependsOn);
  }
  return false;
}

/**
 * The planner's JSON, checked: schema, unique ids, allowed agents, known
 * dependencies, no cycles, and no two unchained subtasks changing one file
 * (they would run in parallel and conflict).
 */
export function validatePlan(raw: unknown, allowedAgents?: readonly string[]): { plan?: Plan; error?: string } {
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
  }
  const plan: Plan = {
    summary: parsed.data.summary,
    subtasks: parsed.data.subtasks.map((s) => ({ ...s, files: s.files.map(norm), dependsOn: [...new Set(s.dependsOn)] })),
  };
  const ids = new Set<string>();
  for (const s of plan.subtasks) {
    if (ids.has(s.id)) return { error: `duplicate subtask id "${s.id}"` };
    ids.add(s.id);
    if (allowedAgents && !allowedAgents.includes(s.agent)) {
      return { error: `subtask "${s.id}" uses agent "${s.agent}", allowed: ${allowedAgents.join(", ")}` };
    }
  }
  for (const s of plan.subtasks) {
    for (const d of s.dependsOn) if (!ids.has(d)) return { error: `subtask "${s.id}" depends on unknown "${d}"` };
  }
  try {
    topoOrder(plan);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const subs = plan.subtasks;
  for (let i = 0; i < subs.length; i++) {
    for (let j = i + 1; j < subs.length; j++) {
      const shared = subs[i].files.find((f) => subs[j].files.includes(f));
      if (shared && !reaches(plan, subs[i].id, subs[j].id) && !reaches(plan, subs[j].id, subs[i].id)) {
        return { error: `subtasks "${subs[i].id}" and "${subs[j].id}" both change ${shared} — chain them with dependsOn` };
      }
    }
  }
  return { plan };
}
