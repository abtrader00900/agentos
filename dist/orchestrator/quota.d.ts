import type { AgentName } from "./types.js";
/** When each agent's quota frees up again. One file, so every run and the daemon agree. */
export interface QuotaStore {
    until(agent: AgentName, now: Date): Date | undefined;
    mark(agent: AgentName, until: Date): void;
    clear(agent?: AgentName): void;
}
/** Every call re-reads the file, so a run never works from a copy the daemon has moved on from. */
export declare function fileQuota(home: string): QuotaStore;
/** Same semantics with no I/O, for tests. */
export declare function memoryQuota(): QuotaStore;
/** When an agent may be tried again: the wait its message states, else the configured cooldown. */
export declare function resetFrom(output: string, now: Date, cooldownMin: number): Date;
