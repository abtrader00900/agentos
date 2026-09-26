/** FR-2.6: agentos skill list / install / test */
export interface SkillListItem {
    name: string;
    description: string;
    installed: boolean;
}
export declare function skillListData(options?: {
    cwd?: string;
}): SkillListItem[];
export declare function skillList(options?: {
    cwd?: string;
    json?: boolean;
}): string;
export declare function skillInstall(name: string, options?: {
    cwd?: string;
}): Promise<void>;
export declare function skillSearch(query: string, options?: {
    cwd?: string;
}): Promise<void>;
export declare function skillTest(options?: {
    cwd?: string;
}): void;
