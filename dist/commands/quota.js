import { agentNameSchema } from "../core/schema.js";
import { fileQuota } from "../orchestrator/quota.js";
/** Why a run paused or fell back, in one glance — the store is a JSON file nobody should have to read. */
export function quotaReport(home, now) {
    const q = fileQuota(home);
    const lines = agentNameSchema.options.flatMap((a) => {
        const until = q.until(a, now);
        return until ? [`${a}: limited until ${until.toISOString()}`] : [];
    });
    return lines.length ? lines.join("\n") : "no agent is limited";
}
/** Clear a mark the agent's own CLI has already forgotten. Validated here, so every caller rejects a typo. */
export function clearQuotaCmd(home, agent) {
    const known = agentNameSchema.options;
    const name = known.find((a) => a === agent);
    if (agent !== undefined && !name)
        throw new Error(`Unknown agent "${agent}" — known agents: ${known.join(", ")}`);
    fileQuota(home).clear(name);
    console.log(`✓ cleared the quota mark for ${name ?? "every agent"}`);
}
//# sourceMappingURL=quota.js.map