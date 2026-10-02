export interface DeciderConfig {
    autoQuick: boolean;
    contentRisk: boolean;
    quickAbove: number;
    riskAbove: number;
    url: string;
}
/** name → a yes/no question */
export type Questions = Record<string, string>;
/** P(yes) per question, or null when no decider answered */
export type Decide = (state: string | object, questions: Questions) => Promise<Record<string, number> | null>;
export declare const deciderDir: (home?: string) => string;
/** the API key `decider start` writes next to the install; undefined when there is none */
export declare function readKey(home?: string): string | undefined;
/** One jevos request. Any failure (down, slow, malformed) is null: the decider is advice, never a dependency. */
export declare function ask(url: string, state: string | object, questions: Questions, opts?: {
    key?: string;
    timeoutMs?: number;
}): Promise<Record<string, number> | null>;
/** the Decide the engine gets: the configured url, with the local key when there is one */
export declare const decider: (cfg: DeciderConfig, home?: string) => Decide;
