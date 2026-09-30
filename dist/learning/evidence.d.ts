/** Facts agentos recorded about a finished run. They are data, not a model's opinion. */
export type Evidence = {
    id: string;
    type: "verify_fixed";
    command: string;
    failedTail: string;
    files: string[];
    round: number;
} | {
    id: string;
    type: "finding_fixed";
    severity: "high" | "medium";
    file: string;
    issue: string;
} | {
    id: string;
    type: "fallback";
    from: string;
    to: string;
    why: string;
    error: string;
} | {
    id: string;
    type: "conflict_resolved";
    files: string[];
} | {
    id: string;
    type: "needs_human";
    reason: string;
} | {
    id: string;
    type: "planner_retry";
    error: string;
};
export declare function readEvents(root: string, id: string): Array<Record<string, any>>;
export declare function collectEvidence(root: string, id: string): Evidence[];
/** one line for prompts and for a lesson's meta.evidence */
export declare function describeEvidence(e: Evidence): string;
