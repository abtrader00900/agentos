export declare function daemonCommand(action: string): Promise<void>;
export declare function queueCommand(action: string, words: string[], opts: {
    project?: string;
    quick?: boolean;
    json?: boolean;
    cwd?: string;
}): void;
