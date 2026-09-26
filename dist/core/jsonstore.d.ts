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
    /** Every mutation already save()s; closing must not rewrite the file on a read-only open. */
    close(): void;
}
