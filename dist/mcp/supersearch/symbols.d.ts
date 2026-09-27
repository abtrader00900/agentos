/**
 * FR-4.2: symbol search via ast-grep (prebuilt binary, no API).
 * Resolves the platform binary shipped with @ast-grep/cli.
 */
export interface SymbolMatch {
    file: string;
    line: number;
    kind: "function" | "class" | "method" | "interface" | "struct";
    name: string;
    signature: string;
}
export declare function astGrepBinary(): string | null;
export interface SymbolSearchOptions {
    cwd: string;
    name?: string;
    kind?: SymbolMatch["kind"];
    file?: string;
    maxResults?: number;
}
export declare function searchSymbols(opts: SymbolSearchOptions): SymbolMatch[];
