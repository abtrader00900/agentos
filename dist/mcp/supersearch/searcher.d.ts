/**
 * FR-4.1/4.5/4.6: text search.
 * Uses ripgrep when available on PATH; falls back to a built-in scanner.
 * Honors .gitignore basics and skips binary files either way.
 */
export interface TextSearchOptions {
    cwd: string;
    pattern: string;
    glob?: string;
    caseSensitive?: boolean;
    maxResults?: number;
    context?: number;
}
export interface SearchMatch {
    file: string;
    line: number;
    text: string;
}
export declare function searchTextBuiltin(opts: TextSearchOptions): SearchMatch[];
export declare function searchText(opts: TextSearchOptions): SearchMatch[];
