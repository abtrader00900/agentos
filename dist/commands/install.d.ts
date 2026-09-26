export interface InstallOptions {
    cwd?: string;
    quiet?: boolean;
    /** passed through to sync: overwrite hand-edited / pre-existing harness files (backed up as .bak) */
    force?: boolean;
}
/**
 * FR-2.1: setup project — configs via sync, .agentos/ dirs, .gitignore, skills.
 */
export declare function install(options?: InstallOptions): void;
