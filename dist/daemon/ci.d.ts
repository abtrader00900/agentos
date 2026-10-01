import { type Job } from "./queue.js";
/** the GitHub CLI: stdout, throws on failure */
export type Gh = (cwd: string, args: string[]) => string;
/** agentos PRs (agentos/run-* heads) with a failed check and none still running */
export declare function failingAgentosPrs(json: string): Array<{
    number: number;
    branch: string;
}>;
/** CI output is someone else's text: it goes in fenced, labelled as data, redacted and capped */
export declare function ciFixTask(pr: number, branch: string, log: string): string;
/** CI-fix jobs to queue for one project: one per failing PR, none while one is open, at most maxFixes per PR */
export declare function scanCi(o: {
    projectId: string;
    root: string;
    gh: Gh;
    jobs: Job[];
    maxFixes: number;
}): Array<{
    task: string;
    onto: string;
    dedupeKey: string;
}>;
