export declare const lockFile: (home?: string) => string;
export declare const logFile: (home?: string) => string;
export declare const cliPath: () => string;
/**
 * Who the daemon is. A PID alone is no proof: after a crash Windows can hand the same number
 * to another program. So the lock holds a random token, and "is it running?" is answered by
 * the daemon itself (a ping file, answered with its token). Nothing is ever killed by PID:
 * stop is a file holding the daemon's token, which the daemon reads and obeys.
 */
export interface DaemonLock {
    pid: number;
    token: string;
}
export declare function readLock(home?: string): DaemonLock | undefined;
/** the lock of a daemon that answers a ping within waitMs, else undefined (none, dead, or a reused PID) */
export declare function answering(home?: string, waitMs?: number): Promise<DaemonLock | undefined>;
/**
 * The daemon's side, run every half second: answer pings with its token, obey a stop request
 * addressed to it, and step down when its lock was taken over (after a long sleep, say).
 */
export declare function controlTick(home: string, token: string): "run" | "stop";
/** Take the lock only if it still holds what we saw (nothing, or a lock whose holder did not answer). */
export declare function claimLock(home: string, seen: DaemonLock | undefined, mine: DaemonLock): boolean;
/** for display only (dashboard, status line): a lock, a live PID and a recent tick; nothing is decided on it */
export declare function daemonStatus(home?: string): {
    running: boolean;
    pid: number | undefined;
    lastTick: string | undefined;
    pauseUntil: string | undefined;
    today: number;
    maxRunsPerDay: number;
};
type Spawn = (cli: string) => number;
/**
 * `daemon start`: refuse if a daemon answers, else spawn the loop detached and hidden; the loop
 * claims the lock itself, so wait until it holds it. Of two starts at once, the loser says who won.
 */
export declare function startDaemon(home?: string, cli?: string, launch?: Spawn, waitMs?: number, claimMs?: number): Promise<number>;
/**
 * Asks the daemon to stop after its current tick (a run in flight keeps going; the next daemon
 * adopts it). "asked": it has not let go of its lock yet; "replaced": another daemon holds it now.
 */
export declare function stopDaemon(home?: string, waitMs?: number, graceMs?: number): Promise<"stopped" | "asked" | "replaced" | "not-running">;
/** `daemon run`: the foreground loop (what `start` and the logon task run) */
export declare function runDaemon(home?: string): Promise<void>;
export declare const taskArgs: (node: string, cli: string) => string[];
type Exec = (cmd: string, args: string[]) => string;
/** a Task Scheduler task that starts the daemon at logon, as this user, not elevated */
export declare function installTask(cli?: string, exec?: Exec, platform?: NodeJS.Platform): void;
export declare function uninstallTask(exec?: Exec): void;
/** minutes before Windows sleeps on AC power (0 = never), from `powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE` */
export declare function parseStandbyMinutes(out: string): number | undefined;
export declare const isInstalled: (exec?: Exec) => boolean;
/** whether the daemon has written a log yet (status prints its path) */
export declare const hasLog: (home?: string) => boolean;
export {};
