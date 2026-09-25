---
name: api-contract
description: Laravel API consistency and versioning review. Use when adding or changing API endpoints, resources, or validation rules.
---

# API Contract Skill

## Workflow

1. Identify the endpoint(s) changed and their consumers (supersearch_text for route names).
2. Check consistency against the checklist.
3. Flag any response-shape change to existing consumers as BREAKING.

## Checklist

- **Validation** — Form Request class per endpoint; rules match documented types; `422` responses consistent.
- **Response shape** — API Resources for every model response; `data` wrapper convention consistent project-wide; pagination envelope uniform.
- **Status codes** — `201` on create, `204` on empty delete, `404` vs `403` distinction correct.
- **Versioning** — Breaking changes go to a new version prefix or are explicitly flagged — never silently mutate a live shape.
- **Docs** — OpenAPI/Scribe annotations updated in the same change.
- **Auth** — Route behind the correct middleware; scope/policy checked (see security-scan).

## Output

Per endpoint: `OK | FINDING(file:line, issue, fix)`. End with `CONTRACT STABLE` or `BREAKING CHANGES: <list>`.

## Rules

- Never change a live response field name/type without versioning.
- New endpoints ship with validation tests (see tdd-laravel skill).
