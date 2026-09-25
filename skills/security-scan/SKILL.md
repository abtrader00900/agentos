---
name: security-scan
description: Security checklist sweep for Laravel + React codebases. Use when reviewing changes touching auth, input, queries, files, or config.
---

# Security Scan Skill

## Workflow

Scan the diff (or requested scope) against this checklist. Use supersearch_text to sweep the whole repo for each pattern — don't rely on reading alone.

## Backend (Laravel)

- **Mass assignment** — `fill()`/`create()` with unvalidated input? Every `$fillable` change is a red flag.
- **Raw queries** — `DB::raw`, `whereRaw`, `selectRaw` with any interpolated variable → SQL injection risk.
- **Authz** — Every controller action checks ownership/role, including API routes behind `auth:sanctum`.
- **Secrets** — No keys/tokens in code or committed `.env`. Search for `api_key`, `password`, `secret` assignments.
- **File upload** — Validate mime + size, store outside public dir, random filenames.

## Frontend (React)

- **XSS** — No `dangerouslySetInnerHTML` with unsanitized data.
- **Tokens** — Never in localStorage for sensitive apps; check what this project uses before flagging.
- **Env leakage** — No `VITE_*` secrets; anything prefixed is bundled into public JS.

## Output

Table per finding: `severity | file:line | issue | fix`. Then one-line verdict: `CLEAN` or `N ISSUES FOUND`.

## Rules

- Cite file:line for every finding — no vague warnings.
- Distinguish "confirmed vulnerable" from "needs human check".
