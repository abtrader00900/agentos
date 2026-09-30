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
/**
 * Resolve a command on PATH *without running it*.
 *
 * doctor reads mcpServers straight out of agent.config.yaml, which is a
 * committed, shared file -- probing with `cmd --version` meant whoever wrote
 * that config got arbitrary code execution out of a health check. Scanning PATH
 * also fixes Windows, where the old `which` fallback does not exist and
 * executables are resolved through PATHEXT (.cmd shims for npx/npm).
 */
export declare function isCommandOnPath(cmd: string): boolean;
export {};
