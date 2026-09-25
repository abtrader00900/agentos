---
name: code-review
description: Structured code review pass with severity-ranked findings. Use when asked to review a diff, PR, or changeset before merge.
---

# Code Review Skill

## Workflow

1. **Scope** — Identify exactly what changed (use `git diff` / supersearch_history). Review only the diff plus directly related code.
2. **Correctness** — Logic errors, edge cases (null/empty/overflow), error handling, off-by-one.
3. **Security** — Injection, authz checks, secrets, unvalidated input. See `security-scan` skill for the full checklist.
4. **Performance** — N+1 queries, unnecessary renders, unbounded loops, missing indexes.
5. **Maintainability** — Naming, duplication, dead code, test coverage of new paths.
6. **Verify** — Run the test suite yourself. Never approve on reading alone.

## Output Format

Rank every finding by severity:

```
🔴 BLOCKER — breaks correctness/security; must fix
🟡 MAJOR   — should fix; technical debt or risky pattern
🟢 MINOR   — nice to have; style/naming
```

End with a verdict: `APPROVE`, `APPROVE WITH NITS`, or `REQUEST CHANGES`, each finding referencing file:line.

## Rules

- Never comment on code outside the diff unless it directly interacts.
- Every 🔴/🟡 must cite file:line and explain the failure scenario.
- If tests don't exist for new behavior, that itself is a 🟡.
