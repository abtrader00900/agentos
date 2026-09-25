---
name: tdd-laravel
description: Red-green-refactor TDD workflow for Laravel features. Use when implementing a new feature or fixing a bug in a Laravel project.
---

# TDD Laravel Skill

## Workflow

1. **Red** — Write a failing feature test first (tests/Feature/). Run `php artisan test --filter=<name>` and confirm it FAILS for the right reason.
2. **Green** — Write the minimum code to pass. No extra abstractions.
3. **Refactor** — Clean up while keeping tests green. Run the full suite: `php artisan test`.
4. **Repeat** for the next behavior.

## Rules

- Tests use RefreshDatabase by default.
- Factories over fixtures. `$this->actingAs($user)` for auth.
- Assert status + database state, not just 200.
- Never write a feature without a failing test first.

## Commands

```bash
php artisan make:test <Name>Test
php artisan test --filter=<Name>Test
php artisan test
```
