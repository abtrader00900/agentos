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
export {};
