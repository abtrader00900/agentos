---
name: db-migration-check
description: Laravel migration safety review. Use when writing, reviewing, or running database migrations.
---

# DB Migration Check Skill

## Workflow

1. Read the migration and its surrounding schema history (`supersearch_history` for the table).
2. Check each item below. Classify: `SAFE`, `RISKY` (data loss/lock), or `BLOCKER`.
3. For RISKY/BLOCKER: propose the safe alternative (usually: new migration, backfill, then swap).

## Checklist

- **Reversible** — `down()` restores the exact prior state. Dropped columns/tables can't be restored in `down()` → mark RISKY.
- **Never edited after deploy** — a migrated migration must stay immutable; new change = new migration file.
- **Data safety** — `->change()` on populated columns, column drops, `NOT NULL` without default → RISKY.
- **Locks** — Adding index on a huge table: use `->concurrently()` (Postgres) or off-peak plan.
- **Foreign keys** — Named explicitly (`->name()`) so rollback doesn't guess. Cascade behavior intentional?
- **Tested** — `php artisan migrate:fresh --seed` passes, plus `migrate:rollback` round-trip.

## Output

```
<status> <migration-file>
  - finding + recommended fix (per item)
```

## Rules

- Always run the rollback round-trip yourself before approving.
- Production data questions → mark "needs human decision", never guess.
