/** Run fn, retrying transient Windows file-sharing errors for up to ~1s. */
export declare function retrying<T>(fn: () => T): T;
/**
 * Remove the lock file, but only the one `mine` recognises.
 *
 * Checking the file and then unlinking the path is racy: a lock can change hands
 * in between and the wrong one gets deleted. rename has exactly one winner, so
 * moving the file to a path only this caller knows hands us the file itself —
 * and whatever we then inspect is the thing we delete. A lock that turns out to
 * belong to someone else goes back by link, not rename: rename would replace a
 * lock somebody acquired in the meantime, link fails instead — and a lock path
 * that is occupied again makes the file we took obsolete, so it just goes.
 */
export declare function dropLock(lock: string, to: string, mine: (taken: string) => boolean): void;
/**
 * Run fn while holding `${file}.lock`, so concurrent processes serialise a
 * read-modify-write instead of overwriting each other. A lock left behind by a
 * process that died mid-write is cleared once it goes stale — so the lock file
 * carries a token identifying its holder, and is only removed while it still
 * holds ours (a slow holder must not delete the lock that took its place).
 */
export declare function withLock<T>(file: string, fn: () => T): T;
export declare class JsonStore {
    private data;
    private file;
    /** what the file looked like when we last read or wrote it */
    private seen;
    constructor(file: string);
    private stamp;
    private load;
    /** Pick up writes made by another process since we last read or wrote. */
    private reloadIfChanged;
    table<T>(name: string): T[];
    save(): void;
    /**
     * Read-modify-write under a cross-process lock: the file is re-read inside the
     * lock (a same-size write within one mtime tick cannot be missed), fn mutates
     * this.table(...), and the result is saved before the lock is released.
     */
    update<R>(fn: () => R): R;
    /** Every mutation already saves; closing must not rewrite the file on a read-only open. */
    close(): void;
}
