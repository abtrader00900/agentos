import type { Questions } from "./client.js";

// Wordings picked by the eval in bench/decider-e2e.md: jevos is very sensitive to phrasing
// (the first auto-quick wording scored small tasks 0.31–0.73, this one 0.89–0.97).

/** P(yes) ≥ quickAbove → run with --quick */
export const AUTO_QUICK: Questions = {
  small: "Does this task ask for exactly one small change, not several features or screens?",
};

/** asked about the added lines of a run's diff; P(yes) ≥ riskAbove → a ⚠️ flag, never a block */
export const CONTENT_RISK: Questions = {
  money: "Does this code calculate or change an amount of money, such as a price, a total, a discount, a payment, an invoice or a balance?",
  "data-loss": "Does this change delete or overwrite stored data, or drop database tables or columns?",
  access: "Does this change alter who can log in or what a user is allowed to do?",
};
