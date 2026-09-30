export interface Usage {
    costUsd?: number;
    inputTokens: number;
    outputTokens: number;
}
export declare function usageFromLine(line: string): Usage | null;
export declare function runUsage(root: string, runId: string): Usage & {
    byAgent: Record<string, Usage>;
};
