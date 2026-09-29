/**
 * FR-2.4: doctor — health checks with actionable fixes.
 * Exits 1 if any BLOCKER found.
 */
interface Check {
    name: string;
    status: "pass" | "warn" | "fail";
    detail: string;
    fix?: string;
}
export declare function doctor(options?: {
    cwd?: string;
    quiet?: boolean;
}): {
    checks: Check[];
    ok: boolean;
};
/** project paths with trust_level = "trusted" in Codex's config.toml ([projects.'<path>'] or [projects."<path>"] tables) */
export declare function trustedCodexProjects(toml: string): string[];
/** Codex lower-cases project keys on Windows (d:\madina electric yasir\…); elsewhere paths compare exactly */
export declare function sameCodexPath(a: string, b: string, platform?: string): boolean;
export {};
