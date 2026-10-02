/** P(yes) ≥ quickAbove → run with --quick */
export const AUTO_QUICK = {
    small: "Can one developer finish this whole task as a single focused change, without splitting it into separate parts?",
};
/** asked about the added lines of a run's diff; P(yes) ≥ riskAbove → a ⚠️ flag, never a block */
export const CONTENT_RISK = {
    money: "Does this change touch money: prices, payments, invoices, balances or billing?",
    "data-loss": "Does this change delete or overwrite stored data, or drop database tables or columns?",
    access: "Does this change alter who can log in or what a user is allowed to do?",
};
//# sourceMappingURL=questions.js.map