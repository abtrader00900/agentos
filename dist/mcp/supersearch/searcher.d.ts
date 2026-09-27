/**
 * FR-4.1/4.5/4.6: text search.
 * Uses ripgrep when available on PATH; falls back to a built-in scanner.
 * Both honor .gitignore, skip hidden and binary files, and return the same shape.
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
/**
 * glob → regex source: `**` spans directories, `*` and `?` stay inside one path
 * segment, `[abc]` is a character class, `{a,b}` an alternation.
 */
export declare function globToRegex(glob: string): string;
export declare function searchTextBuiltin(opts: TextSearchOptions): SearchMatch[];
export declare function searchText(opts: TextSearchOptions): SearchMatch[];
