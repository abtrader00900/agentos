/** Why a run paused or fell back, in one glance — the store is a JSON file nobody should have to read. */
export declare function quotaReport(home: string, now: Date): string;
/** Clear a mark the agent's own CLI has already forgotten. Validated here, so every caller rejects a typo. */
export declare function clearQuotaCmd(home: string, agent?: string): void;
