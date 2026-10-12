# Architecture

Owner: `principal-architect`. Status: Proposed for Gate 0. Binding decisions are in
`docs/decision-log.md` (ADR numbers are referenced below). Data structures are in
`docs/data-model.md`; authorization rules in `docs/permissions-matrix.md`; offline details in
`docs/offline-sync.md`; deployment in `docs/deployment-railway.md`.

## 1. What the system is, in one paragraph

One web application, installable on phones and tablets, that is the single place where
Bryel's Care receives materials, labels and moves stock, plans and runs batches, records the
Batch Manufacturing Record, releases quality, boxes and ships customer orders, imports
attendance, and shows owners what is happening. It is a **modular monolith**: one deployable
codebase with strict internal module boundaries, one PostgreSQL database that holds the
truth, one worker process for slow or scheduled work, and one object store for files. Nothing
is a microservice until there is evidence that it needs to be.

## 2. Architecture options considered

The brief asks for options with cost, complexity, maintainability, offline limits and Railway
fit. Three were weighed.

| Option | Cost (Railway services) | Complexity | Maintainability | Offline fit | Railway fit | Verdict |
|---|---|---|---|---|---|---|
| **A. Modular monolith: Next.js web + worker, one Postgres, one bucket** | 2 compute services + DB + bucket | Low: one repo, one schema, one deploy | High if module boundaries are enforced by lint; risk of "big ball of mud" if not | Good: one API surface for the PWA outbox | Excellent: Railway is built for this shape | **Recommended** |
| B. Separate API (NestJS/Fastify) + SPA + worker | 3 compute services + DB + bucket | Medium: two codebases or a monorepo, duplicated validation unless shared packages are set up | Good; cleaner API contract for the future portal | Good, same API | Good | Defer; Option A's modules can be lifted behind a standalone server later with no schema change |
| C. Domain services (inventory, production, sales, HR/finance as separate deployables) | 6+ services + message broker + DB per service or shared DB | High: distributed transactions for stock + production postings, cross-service traceability queries | Poor at this team size | Hard: offline replay would cross services | Costly | Rejected for this stage (brief: avoid premature microservices) |

Option A is chosen (ADR-001). The portal (Phase 8) will be a second Next.js app or route
group with its own auth boundary that imports the same domain modules read-only through a
narrow façade; the decision between "route group" and "separate app" is taken at Phase 8 with
the security review.

## 3. Component map

```mermaid
flowchart TB
  subgraph Clients
    PWA[PWA on phone / tablet / desktop\nservice worker + IndexedDB outbox]
    Scanner[Keyboard-wedge scanners\nCamera scanning]
    Portal[Customer portal\n(Phase 8, separate auth boundary)]
  end

  subgraph Railway["Railway project (staging / production)"]
    subgraph Web["web service (Next.js)"]
      RSC[Server components\n(reads)]
      Actions[Server actions\n(internal forms)]
      API["/api/v1 route handlers\n(commands, queries, sync, portal)"]
      Health["/api/health, /api/ready"]
    end
    subgraph Worker["worker service (same image)"]
      Jobs[pg-boss consumers:\nPDF/labels, imports, scheduled reports,\nnotifications, balance reconciliation, sync replay]
    end
    subgraph Modules["src/modules (framework-free domain layer)"]
      identity; masterdata; inventory; procurement; production; quality; documents; sales; hr; finance; analytics; platform
    end
    PG[(PostgreSQL 16\nledgers, records, sessions,\naudit, job queue, reporting views)]
    Bucket[(S3-compatible bucket\nPDFs, labels, imports,\nattachments, backups)]
  end

  Email[Email provider\n(adapter)]
  Pay[Payment provider\n(Phase 8, adapter + webhooks)]

  PWA --> RSC & Actions & API
  Scanner --> PWA
  Portal --> API
  RSC & Actions & API --> Modules
  Jobs --> Modules
  Modules --> PG
  Modules --> Bucket
  Jobs --> Email
  API --> Pay
```

## 4. Code layout and module boundaries

```
src/
  app/                      Next.js App Router: layouts, pages, route handlers (thin)
    (app)/...               authenticated application routes
    (auth)/...              sign-in, reset, invitation acceptance
    api/v1/...              versioned JSON API (commands, queries, sync, documents)
    api/health, api/ready   liveness and readiness
  modules/
    identity/               users, roles, permissions, sessions, site assignments, invitations, MFA
    masterdata/             products, SKUs, UOM, materials, suppliers, customers, formulas, routings, sites, locations, lines, equipment, numbering, reason codes
    inventory/              lots, balances, movements, reservations, allocations, containers, counts, labels, FEFO/FIFO
    procurement/            purchase requests, orders, goods receipts, supplier documents, reorder suggestions
    production/             plans, work orders, batches, dispensing, process steps, yield, scrap/rework, BMR data
    quality/                inspections, results, holds, dispositions, deviations, CAPA, change control, complaints, recalls, genealogy
    documents/              templates, versions, generation, reprints, print layouts
    sales/                  quotes, orders, allocations, pick/pack, shipments, delivery receipts, returns, customer requirements
    hr/                     employees, shifts, attendance imports, exceptions, leave, payroll periods (phased)
    finance/                invoices, bills, payments, credit notes, expenses, costing, reconciliation (phased)
    analytics/              KPI definitions, reporting views, scheduled reports, exports
    platform/               audit events, background jobs, notifications, files, imports, settings, feature flags
  db/
    schema/                 Drizzle schema per module (one file per module, exported from index)
    migrations/             generated SQL migrations (reviewed, committed)
    seed/                   fictional seed data scripts (dev/staging only)
  lib/                      cross-cutting infrastructure (not business rules)
    auth/                   session cookie handling, AuthContext builder, require()/requireSite()
    db.ts                   connection, transaction helper
    result.ts               ok/err result type and error codes
    idempotency.ts          idempotency key storage and replay
    audit.ts                audit event writer
    state-machine.ts        typed transition tables
    money.ts, quantity.ts   decimal helpers, UOM conversion
    logging.ts              structured logger with correlation ids
    api/                    typed client, response envelopes
  ui/                       design system components (tokens, primitives, patterns, states)
tests/
  unit/                     pure logic
  integration/<module>/     service tests on real Postgres
  e2e/                      Playwright flows (desktop + 360 px mobile)
```

Each module exposes **one public surface**, `src/modules/<name>/index.ts`, that exports
command and query functions, Zod schemas and types. Other modules and the app layer import
only from that surface; `eslint-plugin-boundaries` fails the build otherwise (ADR-013).
Inside a module:

```
modules/inventory/
  index.ts            public surface
  schemas/            Zod command/query schemas (shared with forms and offline replay)
  commands/           one file per command: validate → authorize → transact → audit → result
  queries/            scoped read functions (list, detail, availability, trace)
  services/           domain rules (FEFO selection, availability maths, container lineage)
  repositories/       Drizzle access, always through scoped helpers
  state/              state machines for this module's records
```

Dependency direction between modules is explicit and acyclic:

```
platform ← identity ← masterdata ← inventory ← procurement
                                 ↑          ↖ production ← quality
                                 ↑                 ↑
                                 sales ← documents ┘        hr   finance   analytics (reads all via views)
```

`inventory` never imports `production`; production posts consumption/output by calling
inventory's `postMovement` command. `analytics` reads through database views, not through
other modules' repositories, so reporting cannot accidentally mutate state.

## 5. Request lifecycle and the authorization contract

Every mutation, whether it arrives as a server action, a `/api/v1` command, an offline
replay or a background job, runs the same pipeline:

1. **Parse** the input with the command's Zod schema (ADR-008). Invalid → `err('validation')`
   with field paths.
2. **Build `AuthContext`** from the session: user id, organization id, roles, flattened
   permission set, allowed site ids (or `all`), request/correlation id, device id for sync.
   Jobs build a system context with an explicit service identity, never a user's.
3. **Authorize**: `ctx.require('inventory.movement.post')` and `ctx.requireSite(siteId)`
   (ADR-005). Separation of duties checks (`submitted_by !== ctx.userId` for approvals) live
   here too. Failure → `err('forbidden')`, logged as an audit event when the action is
   sensitive.
4. **Idempotency**: commands that can be retried (scans, postings, imports, webhooks, sync
   replay) carry an `idempotencyKey`. The key is reserved inside the transaction; a repeat
   returns the stored result and performs nothing (ADR-006).
5. **Transact**: one `db.transaction` for the whole command. Stock and production postings
   lock affected balance rows in a deterministic order. State transitions are validated
   against the record's state machine.
6. **Audit**: an `audit_events` row in the same transaction for auditable actions
   (catalogue in `docs/security.md`).
7. **Result**: `ok(value)` or `err(code, message, details)`. Route handlers map codes to HTTP
   (`validation` 422, `forbidden` 403, `not_found` 404, `conflict` 409, `state` 409,
   `rate_limited` 429); server actions map them to form state.

Reads go through server components or `/api/v1` queries, always through scoped repository
helpers (`repo.forSites(ctx.allowedSiteIds)`) that fail closed if the site set is empty.
Exports use the same scoped queries, so a CSV can never contain another site's rows.

## 6. API conventions (`/api/v1`)

- JSON only; `Content-Type: application/json`; responses wrapped as
  `{ ok: true, data }` or `{ ok: false, error: { code, message, details } }`.
- Commands are `POST /api/v1/<module>/<entity>/<verb>` (e.g. `POST /api/v1/inventory/movements/post`), queries are `GET` with filters. Verbs mirror the permission action where possible.
- Idempotency: `Idempotency-Key` header (UUID) or body field; required for postings.
- Versioning: path version; breaking changes create `/api/v2` routes that coexist for one
  release cycle; non-breaking additions do not bump.
- Pagination: cursor-based (`?cursor=&limit=`), stable ordering by `(created_at, id)`.
- Site context: explicit `siteId` in each request; never inferred from a cookie alone, so
  tests can prove cross-site denial by changing the parameter.
- Correlation: `X-Request-Id` accepted or generated, echoed in responses and logs.
- CSRF: cookie is `SameSite=Lax`; mutating requests must carry `Origin` matching the app
  origin; non-JSON form posts carry an anti-CSRF token (ADR-004).
- Rate limits on auth, scan and export routes (per user and per IP) with 429.
- Sync endpoints (Phase 7): `POST /api/v1/sync/commands` (batch of queued commands, each
  with client UUID, idempotency key, client timestamp, device id) and
  `GET /api/v1/sync/reference?since=` for cached reference data.

## 7. Security boundaries

| Boundary | Inside | Outside | Control |
|---|---|---|---|
| Browser ↔ web | Rendered pages, scoped data | Session cookie only | HttpOnly/Secure/SameSite cookie, Origin check, CSP, HSTS |
| App ↔ domain modules | AuthContext-bearing calls | Raw table access | Only module public surfaces; scoped repositories |
| Site ↔ site | Assigned sites | Every other site | `requireSite`, `forSites`, negative tests per module |
| Internal app ↔ customer portal | Internal records | Portal users | Separate auth table and session namespace, façade queries that expose only approved fields (Phase 8) |
| App ↔ files | Signed, short-lived URLs | Public bucket access | Private bucket, server-side signing, type/size checks on upload |
| App ↔ providers | Adapters with verified webhooks | Direct provider calls from UI | Provider adapter interfaces in `platform`, secrets in environment |
| Runtime ↔ database | Runtime role (DML only) | Schema changes | Separate migration role; RLS evaluated later (ADR-022) |

## 8. Background work

pg-boss (ADR-015) runs in the worker service against the same database. Job classes:

| Job | Trigger | Idempotency | Phase |
|---|---|---|---|
| Generate document PDF (BMR, dispensing sheet, DR, pick list, labels) | command enqueues after posting | keyed by (document id, template version) | 3 |
| Label batch print job | user request | keyed by label job id | 2 |
| Import processing (attendance, master data) | upload completes | keyed by import job id; row-level results | 5 |
| Scheduled reports | cron | keyed by (report id, period) | 5 |
| Notifications (in-app, email) | domain events | keyed by event id | 2 |
| Balance reconciliation (ledger vs projection) | nightly + on demand | read-only; writes a reconciliation report | 2 |
| Expiry and FEFO risk scan | nightly | idempotent recompute | 2 |
| Sync replay (optional server-side ordering) | sync endpoint | per command idempotency key | 7 |
| Backup dump to bucket | daily cron | dated object key | 1 |

Jobs run with a system `AuthContext` and still write audit events. Failed jobs are visible
in the admin diagnostics view with retry controls (`docs/operations-runbook.md`).

## 9. Documents and printing

Templates are versioned records (`document_template_versions`) holding an HTML/CSS layout
and a data binding. Generation (ADR-016, proposed) renders the template with a frozen
snapshot of the source record revision, stores the PDF in the bucket, and records
`generated_documents` (who, when, template version, source revision, reprint reason). On-screen
preview uses the same template. Labels share the pipeline with label-sized page settings and
barcode rendering (ADR-017). Controlled reprint writes an audit event.

## 10. Offline strategy (summary)

The server is authoritative. The PWA caches the app shell and approved reference data and
keeps a durable outbox of commands for the workflows allowed offline (scan-and-move request,
dispensing capture on a managed device with a pre-assigned batch, task and instruction
viewing). Each queued command carries a client-generated UUIDv7, an idempotency key and the
device id; the server re-validates everything on replay and routes conflicts to a review
queue. Online-only: QA release, financial posting, payroll approval, permission changes.
Details, cached data policy, conflict rules and device security are in
`docs/offline-sync.md` (ADR-018). Phase 2 designs the command API for replay even though the
service worker ships in Phase 7.

## 11. Observability and operations

- Structured JSON logs with `requestId`, `userId`, `siteId`, `module`, `command`, duration
  and outcome; no secrets or personal data in logs.
- `/api/health` (process alive) and `/api/ready` (database reachable, migrations current,
  queue reachable) for Railway health checks.
- Error reporting hook (provider adapter; Sentry-compatible) with release tagging.
- Admin diagnostics page: failed jobs, sync backlog, import failures, reconciliation
  differences, last backup, migration version; no secrets shown.
- Alerts: failed job rate, error rate, p95 latency, database size, backup age, sync backlog
  (`docs/deployment-railway.md`).

## 12. Environments and configuration

| Setting | Source | Notes |
|---|---|---|
| `DATABASE_URL`, `DATABASE_MIGRATION_URL` | Railway Postgres | runtime vs migration role |
| `SESSION_SECRET`, `APP_ORIGIN` | Railway variables | cookie signing, Origin checks |
| `S3_*` | bucket credentials | private bucket |
| `EMAIL_*` | provider | adapter, optional in dev |
| `LOG_LEVEL`, `NODE_ENV`, `RAILWAY_ENVIRONMENT` | platform | |
| Business configuration (timezone, currency, numbering, approval rules, FEFO rules, attendance rules) | `settings` and rule tables in the database, editable by `system_admin` | never environment variables |

## 13. Cross-cutting patterns

- **State machines**: a transition table per record type (`state/<record>.ts`), checked in
  the command, recorded in `*_state_transitions`. No free-form status strings.
- **Versioned master data**: effective-dated revisions with approval; operational records
  reference revision ids and store a frozen snapshot of what they used.
- **Numbering**: `numbering_rules` allocate human-readable numbers inside the posting
  transaction (ADR-009).
- **Quantities and money**: `decimal.js` and `numeric` columns; entered and base units
  stored (ADR-010).
- **Result type**: no thrown exceptions for expected failures; typed error codes map to HTTP
  and to form errors.
- **Feature flags**: `platform.settings` flags gate integrations; unconfigured integrations
  render a "setup required" state, never a fake success.

## 14. Major decisions and their status

See `docs/decision-log.md`. Decisions needing owner approval at Gate 0: ADR-001 to 014 and
ADR-019 to 021. Decisions deferred to later phases: ADR-015 to 018, ADR-022.

## 15. Risks specific to this architecture

| Risk | Mitigation |
|---|---|
| Module boundaries erode inside one codebase | lint-enforced boundaries, public surfaces only, architect review on cross-module PRs |
| Next.js server actions tempt business logic into the UI layer | actions are adapters; rule: no Drizzle import outside `modules/` and `db/` |
| Postgres as queue and store under load | pg-boss is adequate for this scale; revisit when job volume or latency demands (ADR-015) |
| Chromium PDF rendering memory on Railway | measure in Phase 3; fallback to `@react-pdf/renderer` (ADR-016) |
| Offline replay creating duplicate postings | idempotency keys reserved in-transaction; conflict queue; replay tests (Phase 7) |
