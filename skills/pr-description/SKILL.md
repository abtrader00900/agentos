---
name: pr-description
description: PR description draft from a branch diff. Use when asked to write or improve a pull request description.
---

# PR Description Skill

## Workflow

1. Gather context: branch vs base diff, linked issue/ticket, commit history.
2. Draft the sections below. Delete ones that don't apply — never leave template filler unfilled.
3. Verify every claim: tests you say pass must actually pass (run them).

## Template

```markdown
## Summary
<!-- 1-3 sentences: what + why. A reviewer should understand the intent without opening the diff. -->

## Changes
<!-- Bullet list, one logical change each, with file paths for non-obvious ones. -->

## Test plan
<!-- Exact commands run + results. -->

## Screenshots / recordings
<!-- UI changes only. Delete section otherwise. -->

## Risk & rollout
<!-- Migration, feature flag, rollback plan — delete if none. -->

Refs #<issue>
```

## Rules

- Summary leads with the user-visible outcome, not the implementation.
- "Test plan" never says "tests pass" without naming the command.
- If the diff is large (>400 lines), suggest splitting the PR.
