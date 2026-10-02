import type { Questions } from "./client.js";
/** P(yes) ≥ quickAbove → run with --quick */
export declare const AUTO_QUICK: Questions;
/** asked about the added lines of a run's diff; P(yes) ≥ riskAbove → a ⚠️ flag, never a block */
export declare const CONTENT_RISK: Questions;
