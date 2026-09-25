---
name: tdd-react
description: Red-green-refactor TDD for React components and hooks with Vitest + Testing Library. Use when building or fixing React UI logic.
---

# TDD React Skill

## Workflow

1. **Red** — Write a failing test that renders the component/hook and asserts the wanted behavior. Run `npm test -- <name>` and confirm it FAILS.
2. **Green** — Implement the minimum to pass. No premature abstraction, no extra props.
3. **Refactor** — Extract hooks/components with tests green. Run the full suite.
4. **Repeat** per behavior, not per file.

## Rules

- Test behavior, not implementation — query by role/text, never by class or test-id when avoidable.
- User events via `@testing-library/user-event`, not `fireEvent`, unless timing forces it.
- Async assertions must use `findBy*` or `waitFor`.
- Hooks tested via `renderHook` from `@testing-library/react`.
- One component change = at least one new or updated assertion.

## Commands

```bash
npm test -- ComponentName
npm test
npm run typecheck
```
