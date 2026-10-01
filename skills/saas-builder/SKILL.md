---
name: saas-builder
description: How to take a web app from "it runs on my machine" to a SaaS you can sell, layer by layer, with checks an agent cannot fake. Use when starting a new product, adding a major feature, preparing a launch, or reviewing whether an app is production-ready (auth, data, payments, hosting, security, monitoring, scaling).
---

# SaaS Builder

A prompt can produce a working demo. A product people pay for needs a dozen layers under the demo that nobody sees until one breaks. Agents left alone build for "it runs locally". This skill tells you what to build, in what order, what to ask the owner, and how to prove each layer is done.

## Ground rules (every task, every layer)

1. **Plan before code.** State the plan: files you will touch, migrations, new dependencies, risks. Wait for approval on anything that changes the data model, auth, money or infrastructure.
2. **Small steps on a branch.** One feature per branch/PR. Never push to the default branch, never force-push.
3. **Prove it, don't claim it.** "Done" means lint, typecheck and tests ran and you show the output. Not "should work".
4. **Never weaken a test to make it pass.** Do not skip, delete, loosen an assertion, or mock away the thing under test. If a test is wrong, say why and ask.
5. **Report honestly at the end:** what changed (files), what you stubbed or left out, what you assumed, what you could not verify.
6. **No secrets in code or logs.** Secrets come from the host's secret store or environment, never the repo; document the names (not values) in `.env.example`. Prefer a managed secret store with rotation once there are paying users.
7. **Ask before adding a dependency.** Prefer the standard library and what the project already uses.
8. **Write the decision down.** Any choice that is hard to reverse (database, auth provider, tenancy model, hosting) gets a short record in `docs/decisions/NNNN-title.md`: context, options, choice, why.

## Before layer one: project memory

The project's agent memory (`agent.config.yaml`, turned into every harness's instruction file by `agentos sync`) must hold:
- what the product does and for whom (2–3 sentences)
- the stack, marked "do not change without asking"
- the commands: dev, test, lint/typecheck, migrate, build
- the ground rules above, plus any project rules
- a pointer to `docs/decisions/`

Without it every session re-decides the stack and drifts.

## The layers, in build order

For each layer: **Goal** · **Agents miss** · **Owner decides** · **Done when**.

### Plan

**1. Product scope**
- Goal: the smallest set of user journeys worth paying for.
- Agents miss: they jump to screens before naming who the user is and what "success" means.
- Owner decides: target customer, the 3–5 core journeys, what is explicitly out of scope, pricing shape.
- Done when: a one-page scope lists users, journeys, non-goals and the first paid plan.

**2. Architecture**
- Goal: a simple shape that will survive the first thousand customers.
- Agents miss: picking microservices, queues or caches before there is load; mixing tenant data.
- Owner decides: monolith vs services (default: monolith), single vs multi-tenant, where background work runs.
- Done when: a diagram or short doc names the components, data flow, and the tenancy model, recorded as a decision.

### Foundation

**3. Data and storage**
- Goal: a schema that keeps data correct and each customer's data separate.
- Agents miss: editing the database by hand, no migrations, floats for money, no tenant/owner column, no indexes for the obvious queries, no backup, schema changes that break the running version during a deploy.
- Owner decides: database, ID style, money representation (integer minor units, or exact fixed-precision decimals where the currency or domain needs it — never floats), retention and backup schedule.
- Done when: every change is a migration, and risky ones go in compatible steps (add new, migrate data, then remove old); money is exact (never float); each tenant-owned table has the owner key and an index, and every query on it is scoped by an authorization rule (row-level security where the database supports it); backups run automatically and **one restore has been tested**.

**4. Authentication and permissions**
- Goal: the right person sees the right data, always.
- Agents miss: checking "logged in" but not "allowed"; permission checks scattered per page; no test that user A cannot read user B's record.
- Owner decides: auth provider or framework auth, roles, password/2FA policy, session length.
- Done when: one central authorization layer (policy/guard) is used by every endpoint; there is a test per role and a cross-tenant "cannot see" test; login and reset are rate-limited.

**5. Backend and APIs**
- Goal: endpoints that validate, authorize and fail predictably.
- Agents miss: trusting input, leaking stack traces, non-idempotent webhooks, N+1 queries, inconsistent error shapes.
- Owner decides: REST vs RPC, versioning, error format, which actions need an audit trail.
- Done when: routes are classified public or protected, and protected ones deny by default; every endpoint validates input and has tests; errors share one shape; webhooks verify signatures and are safe to receive twice.

### Product

**6. Frontend**
- Goal: screens that work for real people on real devices.
- Agents miss: only the happy path; no loading, empty and error states; no mobile layout; inaccessible forms.
- Owner decides: design system, supported browsers/devices, languages.
- Done when: every screen has loading, empty, error and success states; it works at phone width; forms have labels and keyboard access (WCAG 2.2 AA as the target).

### Ship

**7. Version control and CI**
- Goal: every change is tested by a machine before it lands.
- Agents miss: no pipeline, or one that does not fail on errors; secrets in the repo.
- Owner decides: branch rules, who merges, required checks.
- Done when: CI runs lint, typecheck and tests on every PR and blocks merging on failure; the default branch is protected.

**8. Testing**
- Goal: tests that catch the bugs customers would hit.
- Agents miss: testing implementation details, mocking the thing under test, no tests for permissions and money paths.
- Owner decides: which flows must never break (checkout, login, data export).
- Done when: unit tests for logic, integration tests for each endpoint's auth and validation, one end-to-end test per core journey; none skipped.

**9. Hosting and environments**
- Goal: repeatable deploys with a place to try changes before customers see them.
- Agents miss: deploying from a laptop, no staging, config baked into images, migrations run by hand.
- Owner decides: provider, region, budget, staging yes/no (default yes once there are paying users).
- Done when: deploy is one documented command or automatic from the main branch; migrations run as a controlled step of it and are backward-compatible with the version still running; there is a staging environment or a written reason why not.

### Harden

**10. Security**
- Goal: no easy way in.
- Agents miss: missing security headers, open CORS, unescaped output, outdated dependencies, debug mode on in production.
- Owner decides: compliance needs (e.g. GDPR), data that must be encrypted, who gets production access.
- Done when: headers set, CORS restricted, debug off, dependency audit clean or triaged, secrets only in the host's secret store; a short threat model of the app exists; an independent review (a fresh session or second model helps, but does not replace it) — and a professional security test before handling sensitive data.

**11. Rate limiting and abuse**
- Goal: one bad client cannot hurt everyone else or run up your bill.
- Agents miss: no limits on login, signup, password reset, expensive endpoints, or AI calls.
- Owner decides: limits per plan, what happens when exceeded.
- Done when: auth endpoints and costly endpoints are limited and return a clear 429; AI/third-party spend has a cap.

**12. Caching and assets**
- Goal: fast pages without stale or leaked data.
- Agents miss: caching per-user data publicly, no cache headers on static files.
- Owner decides: whether a CDN is worth it yet (often not on day one).
- Done when: static assets are fingerprinted and cached long; nothing user-specific is publicly cached.

### Operate

**13. Errors and logs**
- Goal: you learn about a failure before the customer emails you.
- Agents miss: logging to a container file that disappears on redeploy, logging secrets or personal data, no error tracker.
- Owner decides: error tracking service, log retention, what is personal data.
- Done when: unhandled errors reach a tracker with alerts; structured logs with request IDs go to central, access-controlled storage with a retention period; no secrets, passwords or unneeded personal data in logs.

**14. Monitoring and alerts**
- Goal: you know the app is up and healthy.
- Agents miss: a health endpoint that checks nothing (or one so deep that a database blip restarts every server), no uptime alerts, no backup monitoring.
- Owner decides: who gets alerted and how (email, phone), what counts as an incident.
- Done when: a shallow liveness check (the process answers) is separate from a readiness/health check that touches the database; an external uptime check watches the readiness one; alerts reach a person; failed backups alert too.

### Grow

**15. Scaling**
- Goal: handle growth by measurement, not by guesswork.
- Agents miss: premature sharding/queues; or, the opposite, no indexes and synchronous heavy jobs.
- Owner decides: the expected load in 6–12 months, budget for it.
- Done when: slow queries are found from real metrics and indexed; heavy work runs in background jobs; there is a simple load test of the core journey.

## Beyond the 15 (add when the product needs them)

Transactional email (with SPF/DKIM), payments and invoices, analytics, feature flags, audit log, data export and deletion (privacy requests), terms/privacy pages, onboarding, admin tools, support inbox.

## Pre-launch checklist

- [ ] Scope, architecture and tenancy decisions recorded in `docs/decisions/`
- [ ] All schema changes are migrations (risky ones in compatible steps); money is exact, never float; backups automatic **and a restore was tested**
- [ ] Central authorization; per-role tests; cross-tenant "cannot see" test passes
- [ ] Routes classified public/protected, protected ones deny by default; every endpoint validates input; webhooks verified and idempotent
- [ ] Every screen has loading/empty/error states and works on a phone
- [ ] CI blocks merges on lint/typecheck/test failure; default branch protected
- [ ] Core journeys have end-to-end tests; no skipped tests
- [ ] Staging exists; deploys and migrations are automatic or one documented command
- [ ] Security headers, restricted CORS, debug off, dependency audit triaged, secrets only in the host's secret store, threat model written
- [ ] Login/reset/signup and expensive endpoints rate-limited; AI spend capped
- [ ] Errors go to a tracker with alerts; logs persistent and free of secrets
- [ ] Separate liveness and readiness checks; uptime monitoring on readiness; alerts reach a person
- [ ] Privacy policy, terms, data export/delete path

## How to use with agentos

- Starting a product: put the scope (layer 1) and ground rules in `agent.config.yaml`, run `agentos sync`, then work one layer at a time with `agentos run "<layer goal + its Done-when list>"`.
- Reviewing an existing app: go through the pre-launch checklist and turn each unchecked item into one `agentos run` task (or a queued daemon job).
- Each layer's "Done when" list is the acceptance criteria to paste into the task, so the reviewer agent checks against it.
