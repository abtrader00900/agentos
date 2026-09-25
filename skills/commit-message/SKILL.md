---
name: commit-message
description: Conventional Commits messages from a diff. Use when asked to write or improve a commit message.
---

# Commit Message Skill

## Workflow

1. Read the diff (`git diff` / staged files). Identify the single primary intent.
2. Choose the type from the change, not the filename.
3. Write subject (imperative, ≤72 chars, no period), blank line, then body if needed.

## Format (Conventional Commits)

```
<type>(<optional scope>): <subject>

<body: what + why, wrapped at 72 chars>

<optional footer: BREAKING CHANGE:, Refs #123>
```

## Types

| Type | When |
|---|---|
| feat | new user-facing capability |
| fix | bug fix |
| refactor | behavior-preserving restructuring |
| perf | performance improvement |
| test | adding/fixing tests only |
| docs | documentation only |
| chore | build, deps, tooling |
| revert | reverting a previous commit |

## Rules

- Subject answers "what does this commit do" in imperative mood: "add", "fix", never "added"/"fixes".
- One commit = one logical change. If the diff mixes concerns, say so and suggest splitting.
- Body explains WHY when the reason isn't obvious from the diff.
