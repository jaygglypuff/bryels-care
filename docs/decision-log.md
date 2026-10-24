# Decision log

Architecture and delivery decisions for the Bryel's Care ERP/CRM. Each entry records the
decision, the alternatives considered, the trade-offs, the date and the status.
Statuses: **Proposed** (needs owner approval at a gate), **Accepted**, **Superseded**, **Deferred**.

Entries are numbered `ADR-nnn` and never deleted; a superseded entry points to its replacement.

| ADR | Decision | Status | Date |
|---|---|---|---|
| ADR-001 | Modular monolith in one Next.js (App Router) codebase | Proposed (Gate 0) | 2026-10-12 |
| ADR-002 | PostgreSQL 16 on Railway as the only transactional store | Proposed (Gate 0) | 2026-10-12 |
| ADR-003 | Drizzle ORM with SQL migrations | Proposed (Gate 0) | 2026-10-12 |
| ADR-004 | Self-hosted session authentication (database sessions, argon2id) | Proposed (Gate 0) | 2026-10-12 |
| ADR-005 | Action-level RBAC with site-scoped assignments enforced in the service layer | Proposed (Gate 0) | 2026-10-12 |
| ADR-006 | Append-only ledgers for stock, production and finance; balances are projections | Proposed (Gate 0) | 2026-10-12 |
| ADR-007 | Tailwind CSS v4 + in-repo component library on Radix primitives; design tokens as CSS variables | Proposed (Gate 0) | 2026-10-12 |
| ADR-008 | Zod schemas shared by API, server actions and forms | Proposed (Gate 0) | 2026-10-12 |
| ADR-009 | UUIDv7 primary keys plus human-readable document numbers from numbering rules | Proposed (Gate 0) | 2026-10-12 |
| ADR-010 | `numeric` for quantities and money; entered unit and base unit both stored | Proposed (Gate 0) | 2026-10-12 |
| ADR-011 | Single organization, multi-site tenancy model with a future portal tenant boundary | Proposed (Gate 0) | 2026-10-12 |
| ADR-012 | Vitest (unit + integration on real Postgres) and Playwright (end-to-end) | Proposed (Gate 0) | 2026-10-12 |
| ADR-013 | pnpm, TypeScript strict, ESLint boundaries between modules, GitHub Actions CI | Proposed (Gate 0) | 2026-10-12 |
| ADR-014 | Railway: web service + worker service + backup cron service from one image, managed Postgres, S3-compatible bucket | Proposed (Gate 0) | 2026-10-12 |
| ADR-015 | pg-boss (Postgres-backed) for background jobs | Proposed (approve at G1, before Phase 2) | 2026-10-12 |
| ADR-016 | PDF generation: code-defined renderers with versioned JSON template definitions, headless Chromium in the worker | Proposed (approve at G2, before Phase 3) | 2026-10-12 |
| ADR-017 | QR Code default symbology; Code 128 configurable; camera scanning via BarcodeDetector with ZXing fallback | Proposed (approve at G1, before Phase 2) | 2026-10-12 |
| ADR-018 | Offline: PWA (Serwist) + IndexedDB outbox with idempotent commands; server authoritative | Proposed (approve at G6, before Phase 7; API groundwork in Phase 2) | 2026-10-12 |
| ADR-019 | Default locale assumptions: Philippines, Asia/Manila, PHP, metric units | Proposed (Gate 0, needs business confirmation) | 2026-10-12 |
| ADR-020 | Finance module starts as operational finance support, not a general ledger | Proposed (Gate 0) | 2026-10-12 |
| ADR-021 | Payroll is import-first and reporting-first; payroll calculation gated behind qualified review | Proposed (Gate 0) | 2026-10-12 |
| ADR-022 | Postgres row-level security as defense in depth | Deferred (evaluate end of Phase 2) | 2026-10-12 |
| ADR-023 | Phase 0 reconciliation decisions (Pack in inventory, audit naming, idempotency scope, device table, finance postings without GL, negative stock) | Proposed (Gate 0) | 2026-10-16 |
| ADR-024 | Brand palette, recreated logo and Dribbble-style shell | Accepted | 2026-10-23 |
| ADR-025 | Worker as a second Railway service from the same image, pg-boss with an outbox table | Accepted (Wave 1 as built; confirm at G2) | 2026-10-23 |
| ADR-026 | Phase 2 documents and labels print from the browser; no stored PDFs yet (amends ADR-016) | Accepted for Phase 2 (ADR-016 final call stays at G2) | 2026-10-23 |
| ADR-027 | File storage: S3-compatible private bucket behind an adapter, downloads through signed user-bound links | Accepted (Wave 1 as built) | 2026-10-23 |
| ADR-028 | One settings store and one approval-decision ledger shared by all modules | Accepted (Wave 1 integration) | 2026-10-23 |
| ADR-029 | One system actor per organization (users row with status `system`) for scheduled work | Accepted (Wave 1 integration) | 2026-10-23 |
| ADR-030 | Co-signatures on the operator's shared device: the second person types their own password (no second session) | Accepted (Wave 2 integration) | 2026-10-24 |
| ADR-031 | Consumption posting timing is a setting: at transfer to quarantine (default) or at each dispense | Accepted (Wave 2 integration) | 2026-10-24 |
| ADR-032 | Batch closure and controlled reopen/amend live in their own append-only tables, outside the batch state table | Accepted (Wave 2 integration) | 2026-10-24 |
| ADR-033 | Email through an adapter: Resend over HTTPS in production (Railway blocks SMTP), outbox in development, honest "not set up" otherwise | Accepted (Wave 2 integration) | 2026-10-24 |
| ADR-034 | One-time account tokens travel in the URL fragment and are stored only as sha256 | Accepted (Wave 2 integration) | 2026-10-24 |
| ADR-035 | In-house TOTP with AES-256-GCM encrypted secrets and key rotation | Accepted (Wave 2 integration) | 2026-10-24 |
| ADR-036 | `approval_rules` table and setting change requests replace typed step policies | Accepted (Wave 2 integration) | 2026-10-24 |
| ADR-037 | Numbering rule versions: a new pattern never changes issued numbers; the period sequence continues | Accepted (Wave 2 integration) | 2026-10-24 |
| ADR-038 | One shared Postgres rate-limit store (fixed window) for API, scan, sign-in and identity limits | Accepted (Wave 2 integration) | 2026-10-24 |
| ADR-039 | Read-only maintenance mode as an application setting with a role allow-list | Accepted (Wave 2 integration) | 2026-10-24 |
| ADR-040 | Reference master data installs itself (deploy start and first-admin bootstrap); shipped defaults stand in until then | Accepted (Wave 2 integration) | 2026-10-24 |
| ADR-041 | Staging is recorded per scan in `batch_material_stagings` and re-reserves stock for the batch | Accepted (Wave 2 integration) | 2026-10-24 |
| ADR-042 | Optional approval gate on production plans (off by default) | Accepted (Wave 2 integration) | 2026-10-24 |
| ADR-043 | In-place actions re-render the page in the action response; no `loading.tsx` or `<Suspense>` around pages with in-place actions | Accepted (Wave 2 hardening) | 2026-10-24 |

---

## ADR-001 Modular monolith in one Next.js codebase

**Decision.** Build the system as one TypeScript codebase using Next.js 15 (App Router) with
React 19. Domain logic lives in `src/modules/<domain>` as framework-free services; Next.js
route handlers (`/api/v1/*`) and server actions are thin adapters that validate input, build an
authorization context and call a service. The same image runs as a `web` process and a
`worker` process (ADR-014).

**Why.** The brief requires a mobile-first responsive PWA, printable documents, a typed API
client, Railway deployment and a modular monolith. One codebase gives one deployment, shared
Zod schemas, server rendering for fast first paint on phones, and the ability to add a
separate customer-portal app later that reuses the same modules. Next.js is the most widely
documented option for the PWA + SSR + typed-full-stack combination.

**Alternatives.**
- *Separate API (Fastify or NestJS) + Vite SPA.* Cleaner API boundary but two deployables,
  duplicated validation and more Railway services from day one. Can be adopted later by
  moving `src/modules` behind a standalone server, because modules do not import Next.js.
- *Remix / React Router v7 or SvelteKit.* Capable, but smaller ecosystem for PWA tooling,
  component libraries and hiring.

**Consequences.** Module boundaries must be enforced by lint rules, not by habit. Route
handlers must never contain business rules. Long-running work (PDFs, imports, scheduled
reports) runs in the worker, never in a request.

## ADR-002 PostgreSQL 16 on Railway

**Decision.** PostgreSQL is the single transactional source of truth: business records,
ledgers, sessions, audit events, job queue (ADR-015) and reporting aggregates. No second
database until a documented need appears.

**Why.** Required by the brief. Postgres gives transactions, row locks for stock posting,
`numeric` types, partial unique indexes for idempotency keys, and materialized views for KPIs.

**Alternatives.** Adding Redis for sessions or queues was rejected for Phase 1 to 6: it adds a
service and a failure mode without a current need.

## ADR-003 Drizzle ORM with SQL migrations

**Decision.** Use Drizzle ORM (`drizzle-orm` + `drizzle-kit`). Schema is declared in
TypeScript; migrations are generated as SQL files, reviewed, committed, and applied with an
explicit migrate step at deploy time. Hand-written SQL is allowed for ledgers, locks and CTEs.

**Why.** Drizzle is SQL-first and typed, has no query engine binary, supports transactions
and `SELECT ... FOR UPDATE`, and keeps migrations as plain SQL that can be audited. This
matches the "explicit migrations, no hidden schema drift" requirement.

**Alternatives.**
- *Prisma.* Excellent developer experience, but a separate engine, weaker control over
  locking and raw SQL ergonomics, and heavier cold starts on Railway.
- *Kysely.* Great query builder, but no schema or migration generation.

## ADR-004 Self-hosted session authentication

**Decision.** Implement session authentication in-house: argon2id password hashes,
server-side `sessions` table, opaque session id in an `HttpOnly; Secure; SameSite=Lax` cookie,
idle and absolute expiry, session listing and revocation, password reset tokens, account
lifecycle (invited, active, locked, deactivated). TOTP multi-factor is added for privileged
roles in Phase 1b. CSRF is covered by same-site cookies plus Origin checks on mutating
requests and an anti-CSRF token for non-JSON form posts.

**Why.** The brief asks for secure session-based auth with revocation and account lifecycle.
Full control of the session table is needed for site-scope refresh, device logout cleanup
and offline re-authentication rules.

**Alternatives.**
- *Auth.js.* Good for OAuth, but session revocation, per-site scope refresh and device
  policies fight the framework.
- *Clerk / Auth0 / Supabase Auth.* External dependency and recurring cost; offline re-auth
  and strict tenancy become integration work. Can still be added later as an identity
  provider adapter without changing the authorization model.

## ADR-005 Action-level RBAC with site scope enforced in the service layer

**Decision.** Permissions are strings `module.entity.action` with actions
`view | create | edit | submit | approve | post | export | void | admin`. Roles bundle
permissions. A user receives roles through `user_site_assignments` (user, site, role) or an
organization-wide assignment for roles that legitimately span sites (Owner/Director, System
Administrator, Auditor). Every service call receives an `AuthContext` (user, permissions,
allowed site ids, request id). Repositories expose only scoped query helpers that require the
allowed site set and fail closed. Separation of duties: the user who submits cannot approve
the same record. Approval thresholds are data.

**Why.** The brief requires server-side enforcement, scope-aware action permissions,
requester/approver separation and tests proving cross-site access is impossible.

**Alternatives.** Attribute-based policies (OPA, Casbin) are heavier than needed; Postgres
RLS alone is not enough because scope must also shape API responses and exports.
RLS as defense in depth is ADR-022.

**Note (2026-10-16).** Permission strings use the catalogue spellings in
`docs/permissions-matrix.md`: `inventory.movement.*` (not `inventory.stock_movement.*`),
`quality.hold.*` (not `quality.quality_hold.*`) and `inventory.pack.*` (not `sales.pack.*`); see ADR-023.

## ADR-006 Append-only ledgers; balances are projections

**Decision.** `stock_movements`, `production_postings` (consumption/output) and financial
postings are immutable once posted. Corrections are a reversal row linked to the original plus
a replacement row, each with reason, actor and time. `inventory_balances` (site × location ×
lot × container × quality status) is a projection updated inside the same transaction as the
posting and reconciled by a scheduled job against the ledger. Posting serializes on the
affected lot/location rows
(`SELECT ... FOR UPDATE`). Negative balances are rejected by a database constraint; allowing
negative WIP balances for specific sites would require a new ADR replacing the constraint with a
policy-aware trigger.
Every posting command carries an idempotency key; a repeated key returns the original result.

**Why.** Traceability, concurrency safety and "never edit historical balances" are
non-negotiable in the brief.

## ADR-007 Tailwind CSS v4 + in-repo component library

**Decision.** Styling with Tailwind CSS v4. Components are owned in `src/ui` (shadcn-style:
code copied into the repo, built on Radix primitives), with design tokens defined once as CSS
variables (colour, spacing, radius, elevation, focus ring, status colours, chart palette) and
consumed by Tailwind. Icons: Lucide. Charts: Recharts with the token palette. Typography:
Inter (variable), loaded via `next/font`.

**Why.** Consistent tokens before scaling pages is required by the brief. Owning the
components keeps operator-mode variants (large targets, high contrast) under our control.

**Alternatives.** MUI / Ant Design (admin-template look the brief asks to avoid, heavy
bundles); Chakra (fine, but token model and server-component support are weaker).

## ADR-008 Zod schemas shared by API, server actions and forms

**Decision.** Every command and query has a Zod schema in its module. The same schema
validates route handler bodies, server action inputs, offline queued commands on replay, and
client forms (react-hook-form resolver).

## ADR-009 UUIDv7 keys and document numbering rules

**Decision.** Primary keys are UUIDv7 (time-ordered, generated in the application).
Human-facing identifiers (batch number, lot number, box id, PO/SO/DR numbers) are generated by
`numbering_rules` (per site and document type: prefix, date pattern, sequence, reset period)
inside the posting transaction, and are unique per organization.

**Why.** Offline clients must be able to create records without a server round trip (UUID),
while people need short, predictable numbers on paper and labels.

## ADR-010 `numeric` for quantities and money; dual unit storage

**Decision.** All quantities, weights and money use Postgres `numeric` and `decimal.js` in
the application. Quantity-bearing rows store `qty_entered`, `uom_entered`, `qty_base`,
`uom_base`. Conversions come from `uom_conversions`, which must be dimensionally consistent
(mass to mass, volume to volume; density-based conversions are material-specific and
versioned).

## ADR-011 One organization, many sites; portal tenants later

**Decision.** The data model has an `organizations` root (one row for Bryel's Care) and
`sites` under it. All operational tables carry `site_id`; master data carries
`organization_id` and an optional site restriction. The future customer portal introduces
`customer_portal_tenants` with its own authentication boundary and API surface; internal
tables are never exposed directly.

## ADR-012 Testing stack

**Decision.** Vitest for unit tests and for integration tests that run against a real
PostgreSQL database (CI service container; locally via Docker or a `DATABASE_URL`). Playwright
for end-to-end browser tests including mobile viewports and camera-scan simulation.
Negative authorization tests (cross-site, role escalation, IDOR) are mandatory for every
module and run in CI.

## ADR-013 Tooling

**Decision.** pnpm, TypeScript `strict`, ESLint with `eslint-plugin-boundaries` to forbid
imports between modules except through each module's public `index.ts`, Prettier, Husky
pre-commit (lint-staged), GitHub Actions CI (lint, typecheck, unit, integration, e2e smoke).

## ADR-014 Railway topology

**Decision.** One Docker image; Railway services: `web` (Next.js server, health at
`/api/health` and readiness at `/api/ready`), `worker` (pg-boss consumer, same image,
`node dist/worker.js`), a `backup` cron service (same image, `node dist/backup.js`, read-only
role `bc_backup`; job code `platform.backup_dump` in `docs/architecture.md` §8), managed
PostgreSQL, and an S3-compatible bucket for files. Environments:
development (local), staging, production, each with its own database and secrets. Migrations
run as the `web` service's pre-deploy command; the `worker` does not migrate and waits until
the schema version is current before consuming jobs. Service configuration is expressed as
Railway Infrastructure as Code (`.railway/railway.ts`), not the deprecated `railway.json`.
Backups: Railway Postgres backups plus a scheduled encrypted logical dump to the bucket;
restore is rehearsed before go-live (see `docs/deployment-railway.md`).

## ADR-015 pg-boss for background jobs (Phase 2)

**Decision.** Use pg-boss for queued and scheduled jobs (PDF generation, label batches,
imports, scheduled reports, balance reconciliation, notifications). Jobs are idempotent and
keyed. Job codes, triggers and idempotency keys are registered in `docs/architecture.md` §8 (the
job registry); no job runs under a code that is not listed there. Revisit only if queue throughput
exceeds what Postgres comfortably serves.

## ADR-016 PDF generation (Phase 3, proposed)

**Decision (proposed).** Documents (BMR, dispensing sheet, labels, DR, pick list) are
rendered by code-defined HTML/CSS renderers in the application, configured by versioned JSON
template definitions stored in `document_template_versions` (section selection, labels,
options, page settings). Free-form HTML is never stored in or executed from the database
(see `docs/reports-and-templates.md` A-RPT-01). Rendering happens in headless Chromium in the
worker; the same renderer drives on-screen preview and print. Generated PDFs are stored in the
bucket with template version, source record revision, generator and reprint reason.
Alternative kept open: `@react-pdf/renderer` if Chromium memory on Railway proves
problematic. Final call at the start of Phase 3.

## ADR-017 Barcode symbology and scanning (Phase 2)

**Decision.** Default label symbology is QR Code (dense, phone-camera friendly, survives
curved containers); Code 128 is available per label template for linear scanners. Encoded
payload is a short typed identifier, never a URL with internal data. Payload types:
`BC:LOT:<lot-number>`, `BC:BOX:<box-id>`, `BC:LOC:<location-code>`, `BC:MAT:<material-code>`,
`BC:SKU:<sku-code>`, `BC:EQP:<equipment-code>` (equipment and scales; accepted 2026-10-16 from
process-maps A-PROC-42) and `BC:DOC:<document-number>` (printed documents; see
`docs/security.md`). Grammar and resolution rules are in `docs/data-model.md` section 9.
EAN-13 for consumer units is a later-phase option, not a Phase 2 symbology. Scanning uses the browser `BarcodeDetector` API where available and
ZXing as fallback; keyboard-wedge scanners are supported by a focused input listener.

## ADR-018 Offline strategy (Phase 7, groundwork earlier)

**Decision.** PWA with Serwist service worker; app shell and approved reference data are
cached; an IndexedDB outbox (Dexie) stores queued commands with client-generated UUIDv7
ids and idempotency keys. Only workflows listed in `docs/offline-sync.md` are allowed offline.
The server re-validates every replayed command; conflicts land in a review queue. Because
replay depends on idempotent command endpoints, the `/api/v1` command contract is designed
for idempotency from Phase 2.

## ADR-019 Locale defaults (assumption, needs confirmation)

**Decision.** Until confirmed: country Philippines, timezone Asia/Manila (configurable per
site), currency PHP, metric units (g, kg, mL, L, pcs), date display `DD MMM YYYY`. Evidence:
PayMongo is a Philippine provider and the brief uses "night differential", a Philippine labour
term. Tax, labour and cosmetics regulatory rules are configuration validated by the company's
qualified reviewers, never hard-coded.

## ADR-020 Finance starts as operational finance support

**Decision.** Phase 6 finance scope is customer invoices and receivables, supplier bills and
payables, payment tracking, credit notes, expense requests with approval limits, product and
batch costing (estimate vs actual), and exports to the accountant's system. A double-entry
general ledger is not built unless the owners approve that scope. Posted financial records are
immutable with controlled reversals and period locks regardless of scope.

## ADR-021 Payroll is import-first and reporting-first

**Decision.** Attendance import, exception review and time summaries ship before any pay
computation. Payroll calculation (earnings, overtime, differentials, statutory contributions)
is configuration-driven with effective-dated rules and requires sign-off by a qualified
payroll/accounting reviewer before the company relies on it.

## ADR-022 Row-level security as defense in depth (deferred)

**Decision.** Deferred. The service layer is the enforcement point (ADR-005). At the end of
Phase 2, evaluate adding Postgres RLS policies keyed on a per-transaction
`SET LOCAL app.allowed_site_ids` so that a bug in a scoped query cannot leak another site's
rows. Adoption depends on connection-pool behaviour on Railway and migration complexity.

## ADR-023 Phase 0 reconciliation decisions

**Status.** Proposed (Gate 0), 2026-10-16. Decisions taken by the principal architect while
reconciling the Phase 0 documents; each amends the ADR in the "Amends" column and is binding for
the documents and for Phase 1 code.

| # | Decision | Amends | Where defined |
|---|---|---|---|
| 1 | `Pack` (pack verification, box assignment) lives in the `inventory` module; permission strings are `inventory.pack.{view,create,submit,approve}`; `sales.pack.*` is withdrawn | ADR-005 | `docs/permissions-matrix.md`, `docs/data-model.md` |
| 2 | Audit event names are three lower `snake_case` segments `module.entity.event` (e.g. `identity.authorization.denied`, `documents.label_job.printed`), CHECK-enforced; the authorizing permission is stored separately in `permission_code` | ADR-005, ADR-006 | `docs/data-model.md` §8.1 |
| 3 | Idempotency keys are unique per `(organization_id, key)`, not per user; a repeated key returns the stored result | ADR-006, ADR-018 | `docs/data-model.md` §11.4 |
| 4 | The client device table is `device_registrations` (sessions and sync commands reference `device_registration_id`) | ADR-018 | `docs/data-model.md` §11, `docs/offline-sync.md` |
| 5 | Finance ledger rows are `financial_postings` (operational postings per invoice, bill, payment, credit note, period-locked and reversible); no journal entries or general ledger accounts are created unless the owners extend ADR-020 | ADR-020 | `docs/modules/finance.md`, `docs/data-model.md` |
| 6 | Negative stock is blocked by the `inventory_balances` CHECK constraint in every phase; no site policy may bypass it (see the ADR-006 wording) | ADR-006 | `docs/data-model.md` §5.2, `docs/process-maps.md` V-NEG |
| 7 | Canonical permission spellings: `inventory.movement.*`, `quality.hold.*`, `inventory.pack.*` | ADR-005 | `docs/permissions-matrix.md` |

**Why.** The Phase 0 documents were written in parallel and diverged on these names and
rules; one recorded ruling per item stops the drift before code exists.

**Consequences.** Any document still using the superseded spellings is defective and is fixed
in the Phase 0 consistency pass; Phase 1 lint rules and database CHECKs enforce items 2, 3 and 6.

## ADR-024 Brand palette, recreated logo and Dribbble-style shell

**Status.** Accepted (owner request after the MVP), 2026-10-23. Amends ADR-007 (design tokens)
and `docs/ux-system.md` §3 (navigation model).

**Decision.**
1. The primary palette is the company's greens: leaf green `--brand-600` `#367a24` (primary
   actions, links, active tabs) and light green `--lime-400` `#8dc63f` (accents, focus ring,
   positive chart segments), each with a 50 to 900 ramp in `src/app/globals.css`. Gold
   `--gold-400` `#e3b54a` is a decorative accent only. Dark `--cta` `#17210f` stays the
   highest-emphasis action and active-module pill, as in the reference design.
2. The logo is a vector recreation (`src/ui/brand.tsx`: `Logo`, `LogoMark`; favicon
   `src/app/icon.svg`) of the mark printed on the owner's paper BMR. It is used in the app
   shell, sign-in, the printed BMR and the delivery receipt. Lot labels stay monochrome for
   thermal printers.
3. Desktop navigation follows the reference: a top bar with logo, a pill row of modules
   (active pill solid `--cta`), site selector, scan button, QA bell and account menu; a second
   pill row for the active module's pages; and a left rail of round quick-action icons. This
   replaces the 240 px persistent left navigation of `docs/ux-system.md` §3.1. Tablet and phone
   keep the drawer; phones keep bottom tabs (Home, Scan, Batches, QA, Orders), filtered by
   permission.
4. Display type is Poppins (headings, KPI values, logo); body text is Inter. Both are
   self-hosted through `next/font`.

**Why.** The owner asked for the design to follow the supplied Dribbble reference more
closely and to carry the company logo and green / light-green colours before the client
presentation.

**Consequences.** The quick-action rail and the bottom tabs show only actions the user holds
permission for, and the QA bell is hidden without `quality.disposition.view`. The server
still enforces every permission (ADR-005). The recreated logo is a placeholder for the
official vector artwork (assumption A-PRD-36). Contrast (WCAG AA): white on `--brand-600` is 5.3:1, `--brand-600`
text on the page background `--bg` is 4.7:1, `--fg` on `--lime-400` is 8.2:1; light green
(2.0:1 against white) is never used for text or as the only carrier of meaning.

## ADR-025 Worker as a second Railway service from the same image

**Status.** Accepted (Wave 1 as built), 2026-10-23. Refines ADR-014 and ADR-015; confirm at G2.

**Decision.**
1. Background work runs in a `worker` service built from the same image as `web`, started with
   `pnpm worker` (`src/worker.ts`; later `node dist/worker.js`). No public domain, one replica,
   same `DATABASE_URL`. It serves `/api/health` and `/api/ready` on `PORT`, waits until the
   bundled migrations are applied (it never migrates), writes a `worker_heartbeats` row every
   30 s and drains on `SIGTERM`.
2. pg-boss (schema `pgboss`) delivers and schedules; our `background_jobs` table is the source
   of truth and the outbox: commands insert the row inside their own transaction, the worker
   relays it to pg-boss after commit, so a rolled-back command never runs a job.
3. Jobs are `defineJob(...)` definitions listed in `src/modules/platform/job-handlers.ts` and in
   the registry table of `docs/architecture.md` §8 (a unit test keeps them in step). Wave 1
   registers `inventory.reconcile`, `inventory.rebuild_balances`, `inventory.expiry_check`,
   `inventory.reservation_expiry` and `documents.render`.

**Why.** One image keeps build, scan and rollback simple; Postgres-backed queues avoid another
managed service; the outbox prevents "job ran for a command that rolled back".

**Alternatives.** Jobs inside the web process (lost on redeploy, competes with requests);
Redis-backed queue (another service and failure mode).

**Consequences.** Without the worker service nothing breaks in the request path, but scheduled
work (expiry, reservation lapse, reconciliation) stops; Diagnostics shows the missing heartbeat.
The worker needs CREATE on the database for the `pgboss` schema on first start.

## ADR-026 Phase 2 prints from the browser; no stored PDFs yet (amends ADR-016)

**Status.** Accepted for Phase 2, 2026-10-23. Amends ADR-016; ADR-016's final engine call stays at G2.

**Decision.** Generated documents and labels are rendered by the code-defined renderers from a
frozen dataset and a pinned template version, numbered, hashed (sha256) and audited, and printed
through the browser print dialog at the template's `@page` size (labels one per page, hash-checked
before printing). No PDF file is stored in Phase 2. `PDF_RENDERER=disabled` (default) makes
"Download PDF" show a setup-required state; `chromium` is reserved for the Phase 3 engine
(`WITH_CHROMIUM=1` image). The `documents.render` job uses the same render function for retries.

**Why.** Headless Chromium adds a large image layer and memory pressure on Railway before any
document needs to be stored; browser print already produces exact label and A4 output.

**Consequences.** Printed output is reproducible from the stored dataset and hash, but there is
no stored PDF artefact to attach or e-mail until the engine ships (US-2-11 marked Partial).

## ADR-027 S3-compatible bucket storage with signed, user-bound links

**Status.** Accepted (Wave 1 as built), 2026-10-23. Implements the storage part of ADR-014.

**Decision.** Files go through one adapter (`src/lib/storage`): `FILE_STORAGE=local` for
development (disk under `FILE_STORAGE_DIR`, never served statically) and `FILE_STORAGE=s3` for
staging and production (private S3-compatible bucket such as the Railway Bucket, SigV4 without an
SDK). Object keys are opaque (`org/<org>/<attachment>`); uploads are type-sniffed, size-capped and
metadata-stripped. Downloads use application links signed with `FILE_URL_SECRET` that are bound
to the requesting user and expire after 5 minutes; redeeming one needs that user's signed-in
session and re-checks site scope, then local files stream and bucket files answer with a
60-second presigned redirect, always as an attachment. Unset storage shows "File storage isn't set up" and stores nothing.

**Consequences.** Each environment needs a bucket, the `S3_*` variables and a 32+ character
`FILE_URL_SECRET` (`docs/deployment-railway.md` §4). A leaked link is useless to another user and
for long.

## ADR-028 One settings store and one approval-decision ledger

**Status.** Accepted (Wave 1 integration), 2026-10-23.

**Decision.**
1. All configurable values live in the platform `settings` table with the typed registry
   `src/lib/settings.ts` (zod schema, default, scopes, assumption id per key; site row beats
   organization row beats the default; an invalid stored value falls back to the default). W1C's
   interim `inventory_settings` table is dropped; its keys and defaults moved unchanged
   (`src/modules/inventory/policy.ts` keeps the inventory helpers).
2. All multi-step approval decisions are rows in the append-only `approval_decisions` table
   (master data revisions, equipment overrides, stock adjustments, stock counts). W1C's interim
   `stock_approval_decisions` is dropped. A new `cycle` column numbers approval rounds, so a
   record sent back for rework (a count rejected to recount) can be decided again by the same
   approvers; uniqueness is `(record_type, record_id, cycle, step, decided_by)`.

**Why.** Two stores for the same concept would drift and be reported twice; nothing was
deployed, so the interim tables could be removed without a data migration.

**Consequences.** `approval_rules` (data-model §3.1) still does not exist; step policies are typed
configuration (A-PRD-37). A settings administration screen is still to be built.

## ADR-029 One system actor per organization

**Status.** Accepted (Wave 1 integration), 2026-10-23. Refines `docs/architecture.md` §8 rule 4.

**Decision.** Each organization has one `users` row with status `system`
(`system@bryels-care.invalid`, created by the seed or on first use by `src/lib/auth/system.ts`).
It can never sign in (status is not `active`, the password hash matches nothing, no role
assignments) and is hidden from user administration. Scheduled jobs with no triggering user run
with `systemContext`: user id = the system user (so NOT NULL foreign keys such as
`dispositions.decided_by` and `stock_movements.posted_by` are satisfied), only the permissions
the job declares, every active site. Audit rows of a system context carry `actor_id` null,
`actor_label` `system:<job code>` and `on_behalf_of` the triggering user when there is one.

**Alternatives.** A nil UUID context (W1A; fails every NOT NULL foreign key loudly); nullable
actor columns on domain tables (weakens accountability everywhere).

**Consequences.** Reports that group by person must exclude status `system`; the user list and
user detail already do.


## ADR-030 Co-signatures on the operator's shared device

**Status.** Accepted (Wave 2 as built, W2B), 2026-10-24.

**Decision.** Where the routing requires a checker (line clearance, weighing, step completion,
transfer to quarantine) or an approver for a controlled exception, that person chooses their name
on the operator's device and types their own password. The server verifies it once
(`src/lib/auth/co-sign.ts`), checks the person's permission and site and that they differ from the
operator, and records both identities; no second session is created and nothing is remembered on
the device (A-W2B-01).

**Alternatives.** Each checker signs from their own phone (slower on the floor, extra devices);
badge or PIN signatures (need hardware and enrolment, possible later).

**Consequences.** Not a validated electronic signature (Q-QA-05); the paper record stays the
controlled copy until QA validates (`documents.controlled_record`). Failed co-signatures are audited.

## ADR-031 Consumption posting timing is a setting

**Status.** Accepted (Wave 2 as built, W2B), 2026-10-24.

**Decision.** Ingredient and packaging consumption post at transfer to quarantine together with
the output, in one transaction (default); setting `production.post_consumption_at_dispense`
(organization or site, needs approval) posts each weighing and the packaging consumption as it
happens. Either way every movement goes through `postMovement` with a `production_postings` row;
a voided weighing is reversed or never posted.

**Why.** A-PROC-31: some sites want stock to fall as it is weighed; the default keeps abandoned
batches from leaving half-posted consumption.

## ADR-032 Batch closure and reopen/amend in their own tables

**Status.** Accepted (Wave 2 as built, W2D), 2026-10-24.

**Decision.** `batch_closures`, `batch_reopen_requests` and `batch_amendments` are append-only
tables beside the batch. `closed` is a normal batch state, but the transitions out of `closed`
(reopen to the state it was closed from, or to `quarantined`) are in `REOPEN_TRANSITIONS` of
`src/modules/production/closure.ts`, usable only by the reopen service after a site manager and a
different QA user approve (`approval_decisions`, record type `batch_reopen`). Amendments record
the previous and corrected value with a reason; closing again regenerates the BMR as "AMENDED".

**Why.** Keeps `BATCH_TRANSITIONS` free of a backdoor and gives the BMR an auditable history.

## ADR-033 Email adapter: Resend over HTTPS, outbox in development

**Status.** Accepted (Wave 2 as built, W2E), 2026-10-24. Implements the email adapter of
`docs/architecture.md` §2.

**Decision.** `EMAIL_PROVIDER=resend` sends through Resend's HTTPS API (`RESEND_API_KEY`,
`EMAIL_FROM`) because Railway blocks outbound SMTP below the Pro plan; only metadata is stored.
`outbox` (development and tests, refused in production) stores the full message in `email_outbox`
and prints it. Unset (`none`) sends nothing: the row says `not_configured`, screens say "Email is
not set up" and administrators see the one-time link once to pass on.

**Consequences.** A Resend account and a verified sending domain per environment; no fake "sent".

## ADR-034 Account tokens in the URL fragment

**Status.** Accepted (Wave 2 as built, W2E), 2026-10-24.

**Decision.** Invitation and password-reset links put the 32-byte random token after `#`
(`/invite#token=…`). The page reads it in the browser, removes it from the address bar and posts
it with the form; servers, proxies and logs never see it in a URL. Only `sha256(token)` is stored;
tokens are single use and expire (`identity.invitation.ttl_hours`, `identity.password_reset.ttl_minutes`).

## ADR-035 In-house TOTP with encrypted secrets

**Status.** Accepted (Wave 2 as built, W2E), 2026-10-24.

**Decision.** RFC 6238 TOTP (HMAC-SHA-1, 6 digits, 30 s, ±1 step, a reused step refused) and
one-time recovery codes, without a third-party library (`src/lib/auth/totp.ts`). Secrets are
encrypted with AES-256-GCM under `DATA_ENCRYPTION_KEY` (`keyid:base64`); `DATA_ENCRYPTION_KEY_PREVIOUS`
still decrypts during a rotation. Privileged roles must enrol after `identity.mfa.grace_days`.

**Consequences.** Production needs `DATA_ENCRYPTION_KEY`; losing it means re-enrolling every user.

## ADR-036 `approval_rules` and setting change requests

**Status.** Accepted (Wave 2 as built, W2F), 2026-10-24. Completes ADR-028 item 2.

**Decision.** Who approves what, above which amount or variance, is data in `approval_rules`
(record type, step, role or permission, thresholds, site), evaluated by
`src/modules/governance/approval-rules.ts` for stock adjustments, count variances, master-data
revisions and setting changes; nobody approves their own submission. The configurable
`approval?` types (sales order, quote, work order release, production plan, customer return)
follow the separation-of-duties switches `approvals.sod.<type>`. Settings marked `requiresApproval` change through
a `setting_change_requests` row approved by a different holder of `platform.settings.approve`.

**Consequences.** Defaults are assumptions (A-PM-15) for the owner to confirm; changing rules and
restricted settings needs step-up re-authentication.

## ADR-037 Numbering rule versions

**Status.** Accepted (Wave 2 as built, W2F), 2026-10-24. Refines ADR-009.

**Decision.** How a document number looks comes from the effective approved
`numbering_rule_versions` row (pattern tokens PREFIX, SITE, YYYY, YY, YYMM, YYMMDD, SEQ; reset
never/yearly/monthly/daily), else the built-in default in `src/lib/numbering.ts`. A new version
never changes issued numbers; counters are keyed by period, so the running sequence of the period
continues. Versions are approved by a second person.

## ADR-038 One shared Postgres rate-limit store

**Status.** Accepted (Wave 2 integration), 2026-10-24.

**Decision.** W2E (token buckets) and W2F (fixed window) each built a `rate_limit_buckets` table.
One table and one store remain: `src/lib/rate-limit` (fixed window from the first request, one
upsert per check, Retry-After). Configured limits (`platform.rate_limits`): API per user, scan
look-ups per user, sign-in per IP per minute and hour (applied once, in the sign-in action). Fixed
identity limits (`AUTH_LIMITS`): password reset 3 per account and 10 per IP per hour, TOTP 5 per
user per 15 minutes, token forms 30 per IP per hour.

**Why.** Every web replica must count in the same place (US-1-25 AC3); two stores would double-count.

## ADR-039 Read-only maintenance mode as a setting

**Status.** Accepted (Wave 2 as built, W2F), 2026-10-24.

**Decision.** `platform.maintenance.read_only` (restricted setting) refuses every command of a
user holding none of the allowed roles before any write (checked in the AuthContext), shows a
banner, and keeps reads and sign-in working; scheduled system jobs keep running. `MAINTENANCE_MODE=1`
stays the full outage switch for restores.

## ADR-040 Reference master data installs itself

**Status.** Accepted (Wave 2 integration), 2026-10-24.

**Decision.** Units (g, kg, mg, mL, L, pcs), the SI conversions and the default reason codes are
installed idempotently (existing rows untouched) by `pnpm db:reference`, which `scripts/start.sh`
runs after the migrations on every deploy, and by the first-admin bootstrap for a new
organization. Until a category has rows, services and forms use the shipped default reason codes,
so no command loses its list. The in-code reason lists of Wave 1 and W2B are removed.

**Why.** A fresh Railway database must work without a manual step; the company still owns the
content (A-W2G-05).

## ADR-041 Staging recorded per scan

**Status.** Accepted (Wave 2 as built, W2A), 2026-10-24.

**Decision.** Each staging scan is one append-only `batch_material_stagings` row and one ledger
transfer to a staging location (`production.staging.location_kinds`); the work-order reservation
becomes a batch reservation (`demand_type = 'batch'`). The batch becomes `materials_staged` when
every ingredient is staged; substitutions of another lot of the same material are QA-approved
`batch_material_substitutions`. Posting to quarantine ends the batch reservations (closure releases
what is left). Weighing recommends the staged lots first.

## ADR-042 Optional approval gate on production plans

**Status.** Accepted (Wave 2 as built, W2A), 2026-10-24.

**Decision.** A production plan can require approval before its lines become work orders
(`production.production_plan.approval_required`, off by default, A-PROC-30); when on, the
approver differs from the submitter (`approvals.sod.production_plan`). Nothing is created
automatically: a planner converts each line.

## ADR-043 In-place actions re-render the page in the action response

**Status.** Accepted (Wave 2 hardening), 2026-10-24. Supersedes the ad-hoc refresh workarounds of
W2A and W2C (double `router.refresh()`, rehearsal reload fallback).

**Problem.** In production builds the screen sometimes stayed unchanged after a successful
in-place action (the change was saved): the page kept its old data, or the form stayed on its
pending text ("Recording…") until a manual reload. Seen after work-order release and QA results,
reproduced on every module that has in-place forms (about 1 in 3 releases in a scripted loop).

**Root cause.** A scheduling defect in the React build that Next.js 15.5 ships
(`next/dist/compiled/react-dom`, React 19.2 canary), triggered by our route `loading.tsx` files.
A server-action response with `revalidatePath`, and a `router.refresh()`, both apply a new React
Server Components payload in a transition. Every page sat inside the Suspense boundary that
`loading.tsx` creates, and that boundary is already showing content during an in-place update.
When the transition render suspended there on a payload chunk that had arrived but was not yet
decoded (status `resolved_model`), React marked the render "suspended with delay" first and then
attached its retry listener; the chunk resolved that listener synchronously, inside the render,
and React drops pings received during render in that state. At the end of the render React marked
the update's lane suspended and cleared its ping, so nothing ever retried it: the transition
never committed, and every later refresh joined the same stuck lane. The browser had received the
whole payload (instrumented Flight and router logs). Timing decides whether the chunk is still
pending or already decoded when React gets to it, which is why it was intermittent and more
frequent right after a navigation. Without a Suspense boundary React attaches the listener before
it marks the render, so the same race records the ping and retries.

Things checked and excluded: the middleware and cache headers (responses complete and are
`no-store`), `useActionState`/`useFormStatus` usage, form keys, prefetching, the router's action
queue (the refresh result was applied to router state every time), and the "aborted" RSC requests
shown by the browser (a symptom of the abandoned render, not the cause).

**Decision.**

1. A server action that leaves the user on the page calls `refreshCurrentPage()`
   (`src/lib/in-place.ts`, `revalidatePath("/", "layout")`) after the change and before it
   returns. Next.js renders the current page into the action's own response, so the result
   message and the fresh data reach the browser together and commit in one transition; the submit
   button stays pending until both are on screen. Module helpers that call `revalidatePath` for
   the page are equivalent (any revalidation re-renders the current page) and stay. Actions that
   open another page keep `revalidatePath` + `redirect`.
2. Forms never refresh the router themselves and never retry with timers. The shared building
   blocks are `ActionForm` and `useInPlaceAction` in `src/ui/form.tsx` (idempotency key chosen
   at submit). Client code that calls a server action directly wraps state updates made after
   the `await` in `startTransition`, so they join the action's transition.
3. No `loading.tsx` and no `<Suspense>` in `src/app` or `src/ui`. Navigation feedback is the
   shell's `NavigationProgress` (`src/ui/navigation-progress.tsx`): a progress bar along the top
   edge of the screen after 150 ms and the previous page held at 60 % opacity after 300 ms
   (ux-system §6).
4. `router.refresh()` remains only where no action response exists: REST uploads (goods-receipt
   documents, scanned paper pages) and the MFA recovery codes, which stay on screen until the user
   confirms. `tests/unit/in-place-actions.test.ts` enforces points 2 to 4 and forbids form
   controls named `reset` or `submit` (React calls `form.reset()` after an action; the settings
   form had such a checkbox and threw after every save).

**Alternatives.**

- Keep `loading.tsx` and patch the vendored React (`pnpm patch next`, record render-phase pings).
  It fixes the defect at its source and keeps skeletons, but it edits minified third-party code
  that every Next.js upgrade replaces, outside our tests' reach. Rejected for now; revisit when
  Next.js ships a React with the fix.
- Refresh twice from the client (the W2A/W2C workaround): the second refresh joins the stuck lane
  and fails the same way; it also costs a second request. Rejected.
- `redirect()` to the same page: the redirect target is rendered into the same kind of
  transition and hung the same way (observed during the Wave 2 integration). Rejected.
- Full page reload after each action: always fresh, but slow on warehouse phones and loses
  client state (scanner focus, messages). Rejected.

**Consequences.** Client navigations no longer show route skeletons; the progress bar and the
dimmed previous page replace them. A form that disappears in the new state (for example "Mark
investigating" once a hold is under investigation) is not visible afterwards, so its outcome must
show on the page itself (status chip, timeline, banner). The demo rehearsal
(`tests/e2e/demo-rehearsal.cjs`) has no reload fallback: a screen that looks unchanged after a
successful action fails it.
