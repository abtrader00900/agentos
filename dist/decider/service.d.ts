type Spawn = (bin: string, args: string[], env: Record<string, string | undefined>, cwd: string, log: string) => number;
type Health = (url: string) => Promise<boolean>;
/** the executable a pid runs, or undefined when it is gone or this system cannot say */
export declare function processPath(pid: number): string | undefined;
export declare function startDecider(o: {
    home?: string;
    url?: string;
    force?: boolean;
    freeMb?: () => number;
    spawnFn?: Spawn;
    health?: Health;
    waitMs?: number;
    pollMs?: number;
}): Promise<number>;
/**
 * Stops jevos only when its /health answers and the recorded pid runs the jev binary agentos installed.
 * A stale or reused pid is never killed; its files are removed either way.
 */
export declare function stopDecider(o: {
    home?: string;
    url?: string;
    health?: Health;
    kill?: (pid: number) => unknown;
    processPath?: (pid: number) => string | undefined;
}): Promise<"stopped" | "not-running">;
export declare function deciderStatus(o: {
    home?: string;
    url?: string;
    health?: Health;
}): Promise<{
    installed: boolean;
    running: boolean;
    pid?: number;
}>;
export {};
