---
name: doc-sync
description: Keep project docs truthful after code changes. Use when a task changes behavior, setup steps, commands, or architecture.
---

# Doc Sync Skill

## Workflow

1. Before finishing a behavior-changing task, list the docs that describe the touched area: README, docs/, .env.example, agent config files, API docs.
2. For each, check: commands still accurate? Config keys still exist? Architecture descriptions still true?
3. Update in the SAME commit as the code change. Docs drift is a defect.

## Rules

- Deleted feature → delete/rename its docs in the same PR.
- New env var/config → `.env.example` + README setup section, same PR.
- Changed command/endpoint → grep the docs for the old string and update every hit.
- If docs and code disagree, code is not "done" until one of them changes.

## Commands

```bash
# find stale references (example: renamed command)
grep -rn "old-command-name" README.md docs/ .env.example 2>/dev/null
```
