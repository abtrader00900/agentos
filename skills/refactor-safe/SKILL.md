---
name: refactor-safe
description: Safe refactoring protocol using impact analysis and green tests. Use when restructuring existing code without changing behavior.
---

# Refactor Safe Skill

## Workflow

1. **Baseline** — Run the full test suite. If red, STOP: fix or flag tests first. Refactoring starts from green only.
2. **Impact** — Call `codegraph_impact` on every file you plan to touch. List all transitive dependents.
3. **Catalog** — Find every usage of the symbols being moved/renamed (supersearch_symbol + supersearch_text).
4. **Small steps** — One mechanical change at a time; run tests after each step. Commit after each green step.
5. **Verify** — Full suite + typecheck at the end. `codegraph_cycles` if you changed import structure.

## Rules

- No behavior change, ever, inside a refactor commit — not even "obvious bug fixes".
- Rename = rename everywhere in the SAME commit (partial renames break searchability).
- If a step can't keep tests green, revert to the last green state and replan.
- Behavior changes get their own branch/PR with their own tests.

## Commands

```bash
php artisan test && npm test   # or your project's suite
npm run typecheck
```
