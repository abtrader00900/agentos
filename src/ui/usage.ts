import { readFileSync } from "node:fs";
import path from "node:path";
import { runDir } from "../orchestrator/run.js";

export interface Usage { costUsd?: number; inputTokens: number; outputTokens: number }

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function usageFromLine(line: string): Usage | null {
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    if (!event || typeof event !== "object" || !event.usage || typeof event.usage !== "object") return null;
    const usage = event.usage as Record<string, unknown>;
    if (!finite(usage.input_tokens) || !finite(usage.output_tokens)) return null;

    if (event.type === "result") {
      if (!finite(event.total_cost_usd)) return null;
      const cacheCreation = usage.cache_creation_input_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;
      if (!finite(cacheCreation) || !finite(cacheRead)) return null;
      return {
        costUsd: event.total_cost_usd,
        inputTokens: usage.input_tokens + cacheCreation + cacheRead,
        outputTokens: usage.output_tokens,
      };
    }

    if (event.type === "turn.completed") {
      return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
    }
    return null;
  } catch {
    return null;
  }
}

export function runUsage(root: string, runId: string): Usage & { byAgent: Record<string, Usage> } {
  const total: Usage & { byAgent: Record<string, Usage> } = { inputTokens: 0, outputTokens: 0, byAgent: {} };
  try {
    const lines = readFileSync(path.join(runDir(root, runId), "events.jsonl"), "utf8").split("\n");
    const events: Record<string, unknown>[] = [];
    let hasUsageEvent = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (!event || typeof event !== "object") continue;
        events.push(event);
        if (event.type === "usage") hasUsageEvent = true;
      } catch { /* malformed event lines are ignored */ }
    }

    for (const event of events) {
      let usage: Usage | null = null;
      if (hasUsageEvent && event.type === "usage") {
        if (finite(event.inputTokens) && finite(event.outputTokens)) {
          usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
          if (finite(event.costUsd)) usage.costUsd = event.costUsd;
        }
      } else if (!hasUsageEvent && event.type === "agent" && typeof event.line === "string") {
        usage = usageFromLine(event.line);
      }
      if (!usage || typeof event.agent !== "string") continue;

      total.inputTokens += usage.inputTokens;
      total.outputTokens += usage.outputTokens;
      const agent = total.byAgent[event.agent] ?? { inputTokens: 0, outputTokens: 0 };
      agent.inputTokens += usage.inputTokens;
      agent.outputTokens += usage.outputTokens;
      if (usage.costUsd !== undefined) {
        total.costUsd = (total.costUsd ?? 0) + usage.costUsd;
        agent.costUsd = (agent.costUsd ?? 0) + usage.costUsd;
      }
      total.byAgent[event.agent] = agent;
    }
  } catch { /* missing, unreadable, or invalid run data has zero usage */ }
  return total;
}
