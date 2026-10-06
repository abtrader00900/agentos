import { readFileSync } from "node:fs";
import path from "node:path";
import { runDir } from "../orchestrator/run.js";
const finite = (value) => typeof value === "number" && Number.isFinite(value);
export function usageFromLine(line) {
    try {
        const event = JSON.parse(line);
        if (!event || typeof event !== "object")
            return null;
        // agy nests usage under result and discriminates on `event`, not `type`
        const agyResult = event.event === "result" && typeof event.result === "object" ? event.result : null;
        const usage = (event.usage ?? agyResult?.usage);
        if (!usage || typeof usage !== "object")
            return null;
        if (!finite(usage.input_tokens) || !finite(usage.output_tokens))
            return null;
        if (event.type === "result") {
            if (!finite(event.total_cost_usd))
                return null;
            const cacheCreation = usage.cache_creation_input_tokens ?? 0;
            const cacheRead = usage.cache_read_input_tokens ?? 0;
            if (!finite(cacheCreation) || !finite(cacheRead))
                return null;
            return {
                costUsd: event.total_cost_usd,
                inputTokens: usage.input_tokens + cacheCreation + cacheRead,
                outputTokens: usage.output_tokens,
            };
        }
        if (event.type === "turn.completed" || agyResult) {
            return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
        }
        return null;
    }
    catch {
        return null;
    }
}
export function runUsage(root, runId) {
    const total = { inputTokens: 0, outputTokens: 0, byAgent: {} };
    try {
        const lines = readFileSync(path.join(runDir(root, runId), "events.jsonl"), "utf8").split("\n");
        let previousUsageAgent = null;
        for (const line of lines) {
            if (!line.trim())
                continue;
            try {
                const event = JSON.parse(line);
                if (!event || typeof event !== "object")
                    continue;
                let usage = null;
                const agent = typeof event.agent === "string" ? event.agent : null;
                if (event.type === "usage" && agent && finite(event.inputTokens) && finite(event.outputTokens)) {
                    usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
                    if (finite(event.costUsd))
                        usage.costUsd = event.costUsd;
                }
                else if (event.type === "agent" && agent && agent !== previousUsageAgent && typeof event.line === "string") {
                    usage = usageFromLine(event.line);
                }
                previousUsageAgent = event.type === "usage" && usage && agent ? agent : null;
                if (!usage || !agent)
                    continue;
                total.inputTokens += usage.inputTokens;
                total.outputTokens += usage.outputTokens;
                const agentUsage = total.byAgent[agent] ?? { inputTokens: 0, outputTokens: 0 };
                agentUsage.inputTokens += usage.inputTokens;
                agentUsage.outputTokens += usage.outputTokens;
                if (usage.costUsd !== undefined) {
                    total.costUsd = (total.costUsd ?? 0) + usage.costUsd;
                    agentUsage.costUsd = (agentUsage.costUsd ?? 0) + usage.costUsd;
                }
                total.byAgent[agent] = agentUsage;
            }
            catch {
                previousUsageAgent = null;
            }
        }
    }
    catch { /* missing, unreadable, or invalid run data has zero usage */ }
    return total;
}
//# sourceMappingURL=usage.js.map