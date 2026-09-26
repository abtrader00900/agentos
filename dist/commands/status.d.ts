/**
 * FR-2.3: status — harnesses detected, drift, memory size.
 * FR-8.1: --json machine-readable output for editor integrations (VS Code ext).
 */
export interface StatusData {
    project: {
        name: string;
        stack: string[];
        rules: number;
        skills: string[];
        mcpServers: string[];
    } | null;
    configError: string | null;
    sources: string[];
    harnesses: {
        name: string;
        file: string;
        present: boolean;
    }[];
    drift: {
        available: boolean;
        drifted: string[];
    };
    memory: {
        initialized: boolean;
        sizeKb: number | null;
    };
}
export declare function statusData(options?: {
    cwd?: string;
}): StatusData;
export declare function status(options?: {
    cwd?: string;
    json?: boolean;
}): string;
