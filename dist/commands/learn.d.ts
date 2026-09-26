/**
 * Phase 5: config auto-improvement loop.
 * `agentos learn` reads git history and suggests rules learned from how the
 * project actually evolves. Suggestions are written to
 * agent.config.local.yaml (never touches the committed config) — the human
 * reviews and promotes them into agent.config.yaml.
 */
export interface LearnedRule {
    id: string;
    text: string;
    evidence: string;
}
export interface LearnResult {
    rules: LearnedRule[];
    applied: number;
    commitCount: number;
}
/** Parse `git log --name-only` into per-commit file lists */
export declare function commitFileSets(cwd: string, maxCommits?: number): string[][];
export declare function learnFromHistory(cwd: string): LearnResult;
/** Append learned rules to agent.config.local.yaml (review-then-promote flow) */
export declare function applyLearnedRules(cwd: string, rules: LearnedRule[]): number;
export declare function learn(options?: {
    cwd?: string;
    apply?: boolean;
}): LearnResult;
