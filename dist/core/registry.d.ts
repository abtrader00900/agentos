/**
 * Validate and copy every skill directory found under `root` into the project.
 * Returns the installed skill names. `label` is what error messages call the source.
 */
export declare function installSkillsFromDir(root: string, projectDir: string, label?: string): string[];
/**
 * Clone a git source and install every valid skill from it into the project.
 * Returns the installed skill names.
 */
export declare function installSkillsFromGit(source: string, projectDir: string): string[];
export declare function looksLikeGitSource(name: string): boolean;
export interface RegistryEntry {
    name: string;
    description: string;
    repo?: string;
    path?: string;
}
export interface RegistryIndex {
    version: number;
    skills: RegistryEntry[];
}
/** Load the index: local path / file:// direct read, http(s) with a 5-min disk cache. */
export declare function loadRegistryIndex(registryUrl: string): Promise<RegistryIndex>;
export interface SearchResult extends RegistryEntry {
    origin: "bundled" | "registry";
}
/** Search bundled skills + configured registry index by name/description substring. */
export declare function searchSkills(query: string, cwd: string): Promise<SearchResult[]>;
/** Look a skill name up in the configured registry (`skill install <name>` for a non-bundled skill). */
export declare function resolveRegistryEntry(name: string, cwd: string): Promise<RegistryEntry | null>;
