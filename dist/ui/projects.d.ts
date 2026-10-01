/**
 * The folders the dashboard knows about, kept in ~/.agentos/projects.json.
 *
 * Nothing here is authoritative — it is a list of paths a run has visited, so a
 * broken or missing registry only costs the dashboard a row, never a run.
 */
export interface Project {
    id: string;
    name: string;
    path: string;
    addedAt: string;
    lastSeen: string;
}
export declare const agentosHome: () => string;
export declare const registryFile: (home?: string) => string;
/** readable but unique enough to appear in a URL */
export declare function projectId(root: string): string;
/** Add the folder if it is new, otherwise just refresh lastSeen. Returns the stored entry. */
export declare function registerProject(root: string, home?: string): Project | undefined;
export declare const listProjects: (home?: string) => Array<Project & {
    missing: boolean;
}>;
export declare const getProject: (id: string, home?: string) => Project | undefined;
export declare function removeProject(id: string, home?: string): boolean;
