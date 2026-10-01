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
6. **No secrets in code or logs.** Config comes from environment variables, documented (names only) in `.env.example`.
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
- Agents miss: editing the database by hand, no migrations, floats for money, no tenant/owner column, no indexes for the obvious queries, no backup.
- Owner decides: database, ID style, money representation (integer minor units), retention and backup schedule.
- Done when: every change is a migration; money is integer; each tenant-owned table has the owner key and an index; backups run automatically and **one restore has been tested**.

**4. Authentication and permissions**
- Goal: the right person sees the right data, always.
- Agents miss: checking "logged in" but not "allowed"; permission checks scattered per page; no test that user A cannot read user B's record.
- Owner decides: auth provider or framework auth, roles, password/2FA policy, session length.
- Done when: one central authorization layer (policy/guard) is used by every endpoint; there is a test per role and a cross-tenant "cannot see" test; login and reset are rate-limited.

**5. Backend and APIs**
- Goal: endpoints that validate, authorize and fail predictably.
- Agents miss: trusting input, leaking stack traces, non-idempotent webhooks, N+1 queries, inconsistent error shapes.
- Owner decides: REST vs RPC, versioning, error format, which actions need an audit trail.
- Done when: every endpoint has input validation, an authz check and tests; errors share one shape; webhooks verify signatures and are safe to receive twice.

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
- Done when: deploy is one documented command or automatic from the main branch; migrations run as part of it; there is a staging environment or a written reason why not.

### Harden

**10. Security**
- Goal: no easy way in.
- Agents miss: missing security headers, open CORS, unescaped output, outdated dependencies, debug mode on in production.
- Owner decides: compliance needs (e.g. GDPR), data that must be encrypted, who gets production access.
- Done when: headers set, CORS restricted, debug off, dependency audit clean or triaged, secrets only in the host's env store; a review by a fresh session or second model — and a professional audit before handling sensitive data.

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
- Done when: unhandled errors reach a tracker with alerts; logs go to persistent storage with request IDs; no secrets or passwords in logs.

**14. Monitoring and alerts**
- Goal: you know the app is up and healthy.
- Agents miss: a health endpoint that checks nothing, no uptime alerts, no backup monitoring.
- Owner decides: who gets alerted and how (email, phone), what counts as an incident.
- Done when: an external uptime check hits a health endpoint that touches the database; alerts reach a person; failed backups alert too.

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
- [ ] All schema changes are migrations; money is integer; backups automatic **and a restore was tested**
- [ ] Central authorization; per-role tests; cross-tenant "cannot see" test passes
- [ ] Every endpoint validates input and checks permission; webhooks verified and idempotent
- [ ] Every screen has loading/empty/error states and works on a phone
- [ ] CI blocks merges on lint/typecheck/test failure; default branch protected
- [ ] Core journeys have end-to-end tests; no skipped tests
- [ ] Staging exists; deploys and migrations are automatic or one documented command
- [ ] Security headers, restricted CORS, debug off, dependency audit triaged, secrets only in env
- [ ] Login/reset/signup and expensive endpoints rate-limited; AI spend capped
- [ ] Errors go to a tracker with alerts; logs persistent and free of secrets
- [ ] Uptime check on a real health endpoint; alerts reach a person
- [ ] Privacy policy, terms, data export/delete path

## How to use with agentos

- Starting a product: put the scope (layer 1) and ground rules in `agent.config.yaml`, run `agentos sync`, then work one layer at a time with `agentos run "<layer goal + its Done-when list>"`.
- Reviewing an existing app: go through the pre-launch checklist and turn each unchecked item into one `agentos run` task (or a queued daemon job).
- Each layer's "Done when" list is the acceptance criteria to paste into the task, so the reviewer agent checks against it.
