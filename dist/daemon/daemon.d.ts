import { type Gh } from "./ci.js";
import { type Job } from "./queue.js";
export interface DaemonDeps {
    home: string;
    now(): Date;
    freeMemMb(): number;
    gh: Gh;
    /** runs `agentos <args>` in the project root; resolves with its exit code when it ends */
    launch(root: string, args: string[]): Promise<number>;
    log(line: string): void;
    /** whether this daemon still holds its lock (absent: always) */
    owns?(): boolean;
    /** how often an adopted run's lock is checked (default 5 s) */
    pollMs?: number;
}
export interface DaemonState {
    pid?: number;
    startedAt?: string;
    lastTick?: string;
    lastCiCheck?: string;
    /** a rate limit was hit: nothing new starts before this */
    pauseUntil?: string;
    lastFired: Record<string, string>;
}
export declare const stateFile: (home?: string) => string;
export declare function readState(home?: string): DaemonState;
/** one writer (the daemon), so a plain atomic rename is enough */
export declare function writeState(home: string, s: DaemonState): void;
export declare class Daemon {
    private d;
    private current?;
    constructor(d: DaemonDeps);
    get running(): Job | undefined;
    /** resolves when the job in flight (if any) has finished and been recorded */
    idle(): Promise<void>;
    /** At startup: adopt a run whose engine still lives, re-queue (as paused) one whose engine died. */
    recover(): void;
    tick(): Promise<void>;
    private enabledProjects;
    private start;
    private track;
    private waitForEngine;
    private finish;
    private fail;
}
