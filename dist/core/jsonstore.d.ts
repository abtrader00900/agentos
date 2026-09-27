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
