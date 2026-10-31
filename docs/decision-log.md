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
| ADR-044 | Price lists are approved through `approval_rules` (document type `price_list`); a seeded organization-wide `finance` role holds credit terms, price approval and order approval | Accepted (Wave 3 integration, W3D) | 2026-10-25 |
| ADR-045 | `sales_cs` no longer approves sales orders; submission confirms within limits, the approval rules route the rest | Accepted (Wave 3 integration, W3D) | 2026-10-25 |
| ADR-046 | Customer returns are re-lotted into quarantine (new lot, origin = shipped lot), never put back into the shipped lot | Accepted (Wave 3 integration, W3F) | 2026-10-25 |
| ADR-047 | Opening stock is posted as `opening_balance` goods receipts with `opening_balance_lines`, not `goods_receipt_lines` | Accepted (Wave 3 integration, W3C) | 2026-10-25 |
| ADR-048 | Scheduled reports: daily/weekly/monthly cadence at a local time; delivered files stored in the database for 30 days; email carries a link only | Accepted (Wave 3 integration, W3B) | 2026-10-25 |
| ADR-049 | Action-centre items are materialised (`action_items`) by detectors and registered sources, refreshed by a sweep, resolved automatically | Accepted (Wave 3 integration, W3B) | 2026-10-25 |
| ADR-050 | Allocation proposes whole boxes first, then loose units, then part of a box | Accepted (Wave 3 integration, W3E) | 2026-10-25 |
| ADR-051 | Pack verification is always by a person other than the picker | Accepted (Wave 3 integration, W3E) | 2026-10-25 |
| ADR-052 | One sales order state machine for commerce and fulfilment; every move logged; allocation uses the order line's requirement snapshot; transition logs append-only | Accepted (Wave 3 integration) | 2026-10-25 |
| ADR-053 | The import poster needs the entity's create permission; system_admin creates suppliers; customers import through the customer service | Accepted (Wave 3 integration) | 2026-10-25 |
| ADR-054 | KPI engine: one record query per KPI, nightly snapshots reconciled by re-running the query in SQL; no materialized views yet | Accepted (Wave 3 integration, W3A) | 2026-10-25 |
| ADR-055 | Demo mode (`DEMO_MODE`) and dashboard-only Railway start-up: one start script for web and worker, self-check, advisory-locked migrations, demo auto-load and owner reset | Accepted (Railway demo) | 2026-10-24 |

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

## ADR-044 Price-list approval and the finance role

**Status.** Accepted (Wave 3 integration, as built by W3D), 2026-10-25. Content of the default rule
is an assumption for the owner (A-W3D-03, A-W3D-10).

**Decision.** A price-list version is approved through the same `approval_rules` engine as orders
and quotations (ADR-028), with the new document type `price_list`; the seeded rule is one step by
`finance` or `owner_director` holding `sales.price_list.approve`. The editor, creator and submitter of
a version can never approve it (mandatory separation of duties). An organization-wide `finance` role
bundle exists (matrix column FI): credit terms view/approve, price-list view/approve, quotation and
order view/approve/export, customer view/export and its analytics strings (A-W3I-02).

**Why.** Prices are money the warehouse never sees (matrix §6); the approval needs the same evidence
(rule evaluated, decision, cycle) as other approvals, and finance is the natural approver.

**Alternatives.** A dedicated price-list approval table (rejected: a second approval engine);
owner-only approval (rejected: does not scale and the matrix gives FI `a`).

## ADR-045 Sales customer service does not approve orders

**Status.** Accepted (Wave 3 integration, W3D), 2026-10-25.

**Decision.** `sales.sales_order.approve` is removed from `sales_cs` (matrix §3.8: SC `v c e s x o`).
A draft is submitted with `sales.sales_order.submit`; within the credit limit and below every rule
threshold it confirms itself; otherwise it waits in `pending_approval` for the role the rule names
(finance, site manager, owner), who must not be its creator or submitter. The approval shows in the
approver's action centre (ADR-049).

**Why.** The person taking the order should not also waive credit and amount limits.

## ADR-046 Customer returns are re-lotted into quarantine

**Status.** Accepted (Wave 3 integration, W3F), 2026-10-25.

**Decision.** Posting an approved return creates, per returned lot line, a new lot (`origin_lot_id` =
the shipped lot, status `quarantine`) and a `return` movement into a quarantine location (default the
site's customer-returns cage, `sales.customer_return.location_kinds`). QA decides each return lot with
the normal lot decision; the shipped lot's history is never changed. The genealogy follows the
re-lot edge both ways (trace, recall explorer). A fully returned shipment moves to `returned` (ADR-052).

**Why.** Returned goods have an unknown history since dispatch; mixing them into the original lot
would release them silently and break the ledger's meaning of that lot.

**Alternatives.** Return into the original lot on hold (rejected: one lot with two histories);
scrap on arrival (rejected: QA may release or rework).

## ADR-047 Opening stock lines outside goods_receipt_lines

**Status.** Accepted (Wave 3 integration, W3C), 2026-10-25.

**Decision.** The go-live opening stock count is posted as one `opening_balance` goods receipt per
warehouse with `opening_balance_lines` (count sheet, counter ≠ checker, initial status quarantine /
on hold / expired, container count, the import row), each line posting one ledger movement through
`postMovement`. `goods_receipt_lines` stays for supplier receipts.

**Why.** Opening stock includes finished-product lots and lots without expiry or supplier lot that the
receipt line's constraints (materials, supplier lot, CoA) correctly refuse for real receipts; loosening
them would weaken receiving.

## ADR-048 Scheduled report cadence and file storage

**Status.** Accepted (Wave 3 integration, W3B), 2026-10-25. Retention and cadence are assumptions
A-W3B-04, A-W3B-05.

**Decision.** A schedule runs daily, weekly (weekday) or monthly (day 1–28) at a local time in the
organization's time zone, not a free cron expression; a missed slot produces one catch-up run. Each run
rebuilds the AuthContext of every recipient, writes one file per distinct permission/site group into
`report_run_files.content` (database), deleted after 30 days; the email carries a sign-in link only,
and only a recipient of the run can download its file.

**Why.** Owners understand "every Monday 07:00"; data never leaves in an email; the database is
already backed up and access-controlled, and files are small.

**Alternatives.** Cron strings (rejected: unreadable for owners); files in the bucket (possible later
for large files; needs the S3 adapter in every environment).

## ADR-049 Materialised action-centre items

**Status.** Accepted (Wave 3 integration, W3B), 2026-10-25.

**Decision.** The action centre lists rows of `action_items`, written by detectors (one per kind,
SQL over the source tables) and by sources other modules register (`registerActionItemSource`, wired
in `src/modules/wiring.ts`: W3C imports). `platform.action_centre_sweep` (every 5 minutes and when the
page opens) opens new items, resolves items whose record no longer matches (audited), and escalates by
`notification_rules`. Visibility is the kind's permission at the item's site. Wave 3 integration adds
the W3D, W3E, W3F and W3C kinds (A-W3I-04).

**Why.** Acknowledgement, escalation and history need a row per item; computing the list on every page
view would also be slow on phones.

**Alternatives.** Notifications only (rejected: they do not clear when the record resolves); live
queries per view (rejected: no acknowledgement or escalation state).

## ADR-050 Allocation by whole boxes first

**Status.** Accepted (Wave 3 integration, W3E), 2026-10-25. Assumption A-W3E-07.

**Decision.** Within each FEFO/FIFO candidate lot and location, allocation proposes whole single-lot
boxes (full before partial), then loose units, and only when nothing else fits part of a box, which
the picker takes out at the shelf. Allocations are lot-, location- and box-specific, and are released
with a reason, never deleted.

**Why.** Shipping whole sealed boxes keeps labels and box-level traceability intact and makes picking
and verification a scan per box.

## ADR-051 Verifier is never the picker

**Status.** Accepted (Wave 3 integration, W3E), 2026-10-25. Owner to confirm staffing (A-W3E-08).

**Decision.** Whoever scanned or completed the pick cannot verify the pack (`packs.checked_by <>
packed_by`, service rule and database check); there is no switch.

**Why.** The backlog acceptance criterion (US-4-11) makes the four-eyes check mandatory; a switch
would quietly remove the only independent count before goods leave.

## ADR-052 One sales order machine across commerce and fulfilment

**Status.** Accepted (Wave 3 integration), 2026-10-25.

**Decision.**

1. `ORDER_TRANSITIONS` in `src/modules/sales/orders.ts` is the only sales order machine: draft →
   submitted → confirmed | pending_approval (→ confirmed, or → draft with a reason) → allocated →
   picking → packed → partially_shipped | shipped → invoiced → closed, cancellation up to packed, and
   W3E's undo paths (allocation released, pick or shipment cancelled, dispatch reversed), which need a
   reason.
2. Every move, including fulfilment moves, goes through `transitionOrder()`, which writes
   `sales_order_state_transitions`; W3E's `advanceOrder` wraps it and adds the audit event.
3. Allocation and the full-shipment check read the requirement snapshot frozen on the order line at
   submission; lines from before Wave 3 read the approved requirements in force today through W3D's
   `effectiveRequirements` (A-W3I-01).
4. The sales order, shipment, complaint and customer-return transition logs are append-only by trigger
   (`src/db/sql/w3i.sql`, `w3f.sql`). A fully returned shipment moves to `returned` through the
   shipment machine.
5. Fulfilment reads (pick, packing, shipment, delivery receipt) select explicit order and customer
   columns, never the full rows that carry money and credit terms.

**Why.** Two streams built two halves of the same lifecycle; one table and one log keep reports, KPIs
(KPI-SAL-01 now uses the confirmed transition, ADR-054) and audits consistent.

## ADR-053 Import posting needs the entity permission

**Status.** Accepted (Wave 3 integration), 2026-10-25. Who posts is an assumption for the owner
(A-W3I-03).

**Decision.** Posting an import needs `platform.import_job.post` and the create permission of every
entity the kind creates (checked again by the module services at run time). `system_admin` now holds
`masterdata.supplier.create` (it already created materials, products and customers), so a seeded role
can post supplier imports prepared by procurement. The `customers` kind posts through W3D's
`createCustomer(ctx, input, { tx })`; credit terms in a file are refused unless the poster holds
`finance.credit_terms.approve`. Registered import kinds live on `globalThis`, like the other registries.

**Alternatives.** Posting as a system actor (rejected: bypasses the services' permission checks);
giving procurement `platform.import_job.post` (rejected: the matrix keeps posting with SA/SM).

## ADR-054 KPI engine without materialized views

**Status.** Accepted (Wave 3 integration, W3A), 2026-10-25. Assumptions A-W3A-01, A-W3A-02.

**Decision.** Each KPI is one SQL record query (`src/modules/analytics/kpi/catalogue.ts`) whose rows
are both the drill-down list and the input of the value. Definitions are mirrored and versioned in
`kpi_definitions` by checksum (a changed query records a new version). `analytics.snapshot_kpis`
writes nightly `kpi_snapshots`; `analytics.reconcile_kpis` re-runs the query aggregated in SQL (the
R-query, stock from the ledger) and records a mismatch with a critical notification, correcting
nothing. Snapshots, reconciliation results and definitions are append-only (`src/db/sql/w3a.sql`).
Dashboards run the record queries live; no materialized views yet.

**Why.** One query per KPI makes the number explain itself and makes reconciliation exact; the data
volume does not need materialized views yet (revisit when a dashboard card exceeds its time budget).

## ADR-055 Demo mode and dashboard-only Railway start-up

**Status.** Accepted (Railway demo), 2026-10-24. Refines ADR-014 (topology) and ADR-025 (worker
service); `ALLOW_DEMO_SEED` becomes an alias of `DEMO_MODE`.

**Context.** The owner deploys the demo on Railway from the web dashboard only, from a GitHub
branch that redeploys on every push. Railway no longer lets new services opt into config as code
(`railway.json`, read until 2026-12-01) and Infrastructure as Code needs the CLI, so nothing may
depend on a start or pre-deploy command typed per service. Railway has no secret generator for
service variables.

**Decision.**
1. One image, one start command (`scripts/start.sh`): `APP_ROLE=worker` (or a service named
   `worker`) runs the worker; otherwise web: self-check → migrations (advisory lock) → reference
   data → demo data when `DEMO_MODE=true` and the database is empty → Next.js. Only web migrates.
2. A start-up self-check prints plain-language `[setup]` lines and is fatal only without a usable
   `DATABASE_URL`. `APP_ORIGIN` defaults to `https://$RAILWAY_PUBLIC_DOMAIN`,
   `TRUSTED_PROXY_HEADER` to `x-real-ip` on Railway, `FILE_STORAGE` to `s3` when every `S3_*` is
   set; in demo mode only, missing `FILE_URL_SECRET`/`DATA_ENCRYPTION_KEY` are derived from
   `DATABASE_URL`.
3. Demo mode (`DEMO_MODE=true`, never with `APP_ENV=production`): auto-load into an empty
   database with a completeness marker, "Try the demo" one-click sign-in for demo accounts only,
   a demo banner, owner-only reset (step-up, typed confirmation, truncate-and-reload keeping the
   schema) and no TOTP-deadline block for demo accounts.
4. Demo data and real data never mix: seed, auto-load and resets refuse while any account's email
   is not a demo address; demo mode refuses invitations to real addresses.

**Why.** Every push must give a working demo without anyone typing commands, and the same code must
be unable to harm a real database. Truncating rather than dropping keeps the worker and pg-boss
running during a reset.

**Consequences.** Assumptions A-DEMO-01 to A-DEMO-08 (`docs/PRD.md`). The derived demo secrets are
as safe as `DATABASE_URL` itself and are never used outside demo mode. Real deployments use a
separate Railway project with `APP_ENV=production` (`docs/railway-for-dummies.md` "Going live").

ADR-056 to ADR-070 are reserved for the Wave 4 stream decisions (procurement, finance operations,
quality system, offline, portal, readiness) that are being written up from the stream notes.

## ADR-071 Portal-user administration sits with site managers

**Status.** Accepted (Wave 4 integration).

**Context.** `sales.portal_user.admin` is a restricted string: holding it makes a session privileged
(1 h idle timeout, enforced TOTP). Granting it to `sales_cs` would put every salesperson under those
rules for a task a few people do.

**Decision.** `site_manager` and `system_admin` administer portal users (invite, suspend, reset);
`sales_cs` keeps portal-user view and the portal catalogue.

**Consequences.** Sales asks the site manager to invite a customer contact. Tests:
`tests/integration/portal/w4e-portal-access.test.ts`.

## ADR-072 An empty sandbox company next to the demo

**Status.** Accepted (owner request, 2026-10-25).

**Context.** The demo company is full of fictional records, which overwhelms a first-time user who
wants to learn by building their own data from nothing.

**Decision.** In demo mode only, `pnpm db:sandbox ensure` (run by `db:demo auto|reset`) creates a
second organization, "Bryel's Care Sandbox (empty)", with one site (SBX), a warehouse with the basic
locations designated, the role templates, reference data (units, conversions, reason codes), the
approved print templates copied from the demo company, one print station, and 14 accounts
`sandbox.*@bryels-care.test` (two per checker/approver role). No materials, products, suppliers,
customers, stock or orders. The sign-in page shows the accounts under "Start from scratch"; a
sandbox banner links to the end-to-end guide `docs/help/getting-started.md` (/help). Same safety
rules as ADR-055: demo addresses only, refused while any real account exists, demo mode only.

**Consequences.** Organization-scoped look-ups that used "the first organization" order by
`created_at`, so the demo company stays first. "Start over" (owner reset) recreates both the demo
and the empty sandbox.

## ADR-073 Owner override and "who can do this"

**Status.** Accepted (owner request, 2026-10-25). Regulatory use flagged for qualified review.

**Context.** The owner, testing alone, could not move work forward: steps such as releasing a work
order they planned, approving a formula they submitted, checking their own weighing or QA release
need a different person or another role, and the screen did not say who that is.

**Decision.**
1. Setting `governance.owner_override` (organization, restricted: re-authentication to change; off
   by default; on in the demo and the sandbox). When on, a user with the Owner/Director role and an
   organization-wide assignment holds every permission and passes every same-person rule
   (`ctx.assertSeparation` / `ctx.sodBlocks`, role-restricted approval steps via `ctx.actsAsAnyRole`,
   co-signing with their own password).
2. Every use is recorded: `audit()` writes `governance.owner_override.used` (the action it enabled
   and the rules or permissions bypassed) in the same transaction.
3. The database same-person rules that were CHECK constraints become deferred constraint triggers
   (`bc_sod_distinct`, `src/db/sql/adr073.sql`) that accept a row only when the transaction carries
   `bc.owner_override = on`, which `audit()` sets transaction-locally when it records an override.
   Without an override the database refuses the same rows as before (SQLSTATE 23514, same name).
4. "Who can do this": a refused step carries the permission it needs; forms and the work order's
   next step show the roles and the colleagues who hold it at the site (`GET /api/who-can-do`).

**Why.** In a small company the owner must be able to finish the work and to try the system alone;
the audit trail, not a hard block, then shows that one person did both sides.

**Consequences.** Independent QA release and second-person checks are GMP controls (ISO 22716 /
FDA Philippines): switching the override on for real production is the owner's documented decision
after QA advice (assumption A-GOV-OWNER). Other roles are unchanged. Tests:
`tests/integration/governance/owner-override.test.ts`.

## ADR-078 Faster sign-off and picking on the shop floor

**Status.** Accepted (owner decision, 2026-10-25). Regulatory use flagged for qualified review.

**Context.** On an iPad the owner had to type lot numbers to stage and weigh, could not see whether a
lot held enough, and every checker had to type their password on the operator's tablet.

**Decision.**
1. A checker or approver signing on the operator's device picks their name. Their password is asked
   only when `production.sign_off.require_password` is on (default off, restricted). Each name-only
   signature writes `identity.co_signature.by_name` with the operator and session it came from.
   The same-person rule still applies (owner override aside, ADR-073).
2. `production.weighing.second_person_check` (default on; off in the sandbox): when off, batches
   created afterwards need no checker on weighing lines (the snapshot's `requiresChecker` is false).
3. Staging lists each reserved lot with its quantity and a one-tap "Bring … to production" button
   (quantity = what the ingredient still needs, or the lot's reserved quantity if less); scanning stays
   available under "Scan labels instead". Weighing preselects a lot from a list (lot, quantity,
   location, expiry; staged lots first) and warns when the lot holds less than still needed.

**Consequences.** A name-only signature records who was named, not proof they were present: for
GMP the owner should switch the password back on, or use sign-off from the checker's own device,
before real production (assumption A-SIGN-01). Tests: `tests/integration/production/execution-controls.test.ts`.

## ADR-079 Built-in starter example (Acapulco soap)

**Status.** Accepted (owner request, 2026-10-25).

**Context.** Starting from an empty company, the owner had to invent the first formula and routing
on unfamiliar screens.

**Decision.** "Use the Acapulco soap example" (Formulas and Routings pages; `installSoapExample` in
`src/modules/masterdata/templates.ts`) adds, only where missing (matched by name), the soap
materials, the product "Acapulco Soap 135 g", a draft formula with the demo company's illustrative
quantities and a draft five-step soap routing with optional readings. Codes are the next free
`MAT-/PKG-/PRD-/F-/R-` numbers. Nothing is approved automatically; the drafts follow the normal
review and approval. Running it again changes nothing. Needs the material, product, formula and
routing create permissions. The routing editor also derives a parameter's code from its name.

**Consequences.** The example quantities are fictional (not an approved recipe) and say so in the
formula notes. Tests: `tests/integration/platform/sandbox.test.ts`.
## ADR-074 One production order with a simple status and a daily log

**Status.** Accepted (owner decision after the iPad trial, 2026-10-30; stream S2).

**Context.** The owner found the production flow (work order → plan → planned → release → batch →
stage → line clearance → weigh → steps → output → QA → close) too many screens and words to follow.
They want ONE "production order" to track from ordering to done, and a simple daily record of what
was made and what went wrong.

**Decision.**
1. A **production order is a work order** with its batches. No new state machine: the simple status
   is a read model over the existing work order and batch machines
   (`src/modules/production/production-order-status.ts`): draft/planned → **Draft**; released with no
   started batch → **Approved**; released with a started batch, or in_progress → **In progress**;
   completed/closed → **Done**; cancelled → **Cancelled**. "Started" = the batch has `started_at`,
   the rule `syncWorkOrderProgress` already uses.
2. **Approve** (`approveProductionOrder`, permission `production.work_order.approve`) runs plan +
   release + FEFO reservation + creation of the order's batches (`batch_count`, default 1) in ONE
   transaction, idempotent (command `production.production_order.approve`). The existing plan and
   release bodies were extracted as `planLockedWorkOrder` / `releaseLockedWorkOrder` and the batch
   insert as `insertBatch`; `planWorkOrder`, `releaseWorkOrder` and `createBatch` call them, so
   their behaviour is unchanged. Approving includes creating the batches (no separate
   `production.batch.create`). A shortage (with `production.work_order.allow_release_with_shortage`
   off) rolls everything back and the message names each material with need / usable / short in
   kg or g. Separation of duties (`approvals.sod.work_order_release`) compares the approver with the
   person who **created** the order (or planned it, for an order planned on the old screen); the
   owner override (ADR-073) applies.
3. The order page shows ONE next action: **Approve** (command), **Start** (opens staging, then the
   batch workspace for the line check) or **Finish** (opens the batch workspace, then the closure
   page). Start and Finish are links to the screens where that work is recorded; they never change a
   state themselves. Waiting states (approval by another person, quality check) say who can act.
4. **Daily log**: tables `production_daily_logs` and `production_defect_entries`, append-only
   (`src/db/sql/s2.sql`). A correction is a new entry with `corrects_id` and a reason; an entry is
   replaced at most once (unique index); replaced entries stay visible and do not count. Defect
   types come from setting `production.defect_types`. Permissions `production.daily_log.view` and
   `production.daily_log.create` (operator: both; site manager: both; planner, QA: view; auditor and
   system admin: view through VIEW_ALL; owner: all).
5. **Defects summary** per product and day (good, defects, defect % = defects ÷ (good + defects),
   by type) on the order and on `/production/defects`.
6. Navigation: **Production orders** is the first Production item, then **Defects**; the board,
   work orders and direct batch creation stay reachable, labelled "(detailed)" / "(advanced)".

**Why.** The owner tracks one thing; the batch engine, ledger, QA and traceability controls stay
exactly as built and tested.

**Consequences.** Not done in this change: feeding the defect rate into the analytics KPI catalogue
(needs a KPI definition and reconciliation test, ADR-04x analytics rules); unit-of-measure for the
daily log is "units" (pieces) for every product (A-S2-03). Tests:
`tests/integration/production/production-orders.test.ts`.
## ADR-076 Editable dropdown lists, material brand and standard pack

**Status.** Accepted (owner request, 2026-10-30). Default options and demo values flagged for owner review (A-S4-01..05).

**Context.** The owner could not add a choice to a dropdown ("everything is pre-built"): product
families were a setting, customer types a fixed code list, and materials had no category, brand or
pack size ("palm oil may have different brands; there is no master quantity").

**Decision.**
1. One generic table `lookup_values` (organization, `list_key`, `code`, `label`, `sort_order`,
   `is_active`) plus a code registry `LOOKUP_LISTS` (src/modules/masterdata/lookups.ts) that defines
   each list: title, where it is used, shipped default options, how many records use an option, and
   how many options must stay on. Lists: `product_family`, `material_category`, `customer_segment`,
   `supplier_category`. The settings registry was not used: its values are versioned JSON with an
   approval flow and no per-option identity, rename or "in use" check.
2. The `code` is the stored value and never changes (trigger); renaming changes only the label, so
   records follow. Options are reordered and turned off; an option in use is never deleted (an unused
   one may be). Forms offer active options; an edit keeps a record's turned-off value. Services accept
   the code or the label (any case) and store the code.
3. While an organization has no rows for a list, the defaults stand in (same pattern as reason codes);
   the first change writes them under a row lock (`FOR UPDATE` on the list's rows, insert
   `ON CONFLICT DO NOTHING`), so concurrent first edits never fork the list. A record that picks an
   option takes a share lock on it, so a delete cannot race a new use.
4. Screen **Master data → Lists** (`/masterdata/lists`); permissions `masterdata.lookup_value.view`
   (every role) and `.admin` (system_admin; owner_director). Audit `masterdata.lookup_value.created|updated|deleted`
   (entity number `list:code`, site null). Lists with richer rows keep their screens and are linked:
   reason codes (also defect and scrap reasons), units of measure, and the governed quality/finance
   lists in Settings (they need a second approver). Lists that drive program logic (statuses, state
   machines, location kinds, warehouse kinds, material class, discrepancy and document kinds,
   complaint channels) stay fixed in code and are not shown.
5. Product families move from the setting `masterdata.product_families` (removed) to the list; default
   codes equal the old values (`Soap`…) and customer type codes equal the old fixed list, so no data
   changes. src/db/sql/s4.sql copies a customised setting into list rows.
6. Materials get `category`, `brand` (usual brand) and a standard pack (`standard_pack_qty` +
   `standard_pack_uom`, unit must convert to the base unit). The supplier × material pair gets its own
   `brand` and pack (`masterdata.supplier.edit`, not a cost term). Receipt lines record the brand that
   arrived and posting copies it to the lot; corrections use the audited lot edit. The receive form
   fills one pack from the pair (else the material), offers "Number of packs" and suggests the brand;
   the PO picker returns the pack as the default quantity. Lot labels get the optional field `brand`
   (on by default for new material label templates).

**Why.** One table and one screen cover every simple list; codes keep history stable; brand per lot is
what traceability needs when the same material comes from several brands and suppliers.

**Consequences.** New columns and table need a migration (generated at merge) plus the custom SQL
src/db/sql/s4.sql (code trigger, setting copy). A new simple list = a key in `LOOKUP_LIST_KEYS`
(schema CHECK) and an entry in `LOOKUP_LISTS`. Pack sizes in litres for materials kept in grams need
an approved material-specific density conversion first (A-S4-05). Tests:
`tests/integration/masterdata/s4-lists-brand.test.ts`.
## ADR-075 Codes assigned by the system, deleting drafts, "To approve", notification links

**Status.** Accepted (owner requests, 2026-10-30; stream S3). Assumptions A-DEL-01 to A-DEL-03 and
A-CODE-01 flagged for owner approval.

**Context.** On the iPad the owner could not delete a draft made by mistake, could not tap a
notification to reach the record, had to invent codes for every material or customer, had no single
place for approvals, and did not find how to add or edit a location.

**Decision.**
1. *Codes.* Material, product, supplier, customer, location and equipment codes are optional on
   create. A blank code gets the next number of a per-organization counter, reusing the numbering
   rules of ADR-009 / US-1-19 (`src/lib/numbering.ts`, new document types MAT, PRD, SUP, CUS, LOC,
   EQP: pattern `{PREFIX}-{SEQ}`, never reset, 4 digits that grow past 9999 instead of
   overflowing; `assignMasterCode`). The counter row stays locked until the creating transaction
   ends, so concurrent creates get different codes; a number already used by a typed or imported
   code is skipped. The owner changes prefixes under Admin → Numbering like any document type.
2. *Deleting drafts.* `src/lib/draft-delete.ts`: a record that is a never-submitted draft
   (`status = draft` and `submitted_at` empty; for master data its initial state) and that no other
   record references (catalogue foreign keys, `isReferenced`) can be hard-deleted with its own
   child rows (lines, addresses, steps) by its creator (holding the create permission) or by a
   holder of the module's edit/admin permission, at the record's site. Audit
   `<module>.<entity>.deleted` with the deleted row (and lines) in `before`. Submitted, approved,
   posted or used records are never deleted (cancel / void / reversal as before). Covered:
   materials, products (with unused SKUs), suppliers (quality status new), customers (prospect or
   active, unused), formula / routing / work-instruction revisions (the parent goes too when it
   was the only revision), inspection plans, purchase requests, purchase orders (not one made from
   a request), sales orders, quotations, price-list versions, stock adjustments. The append-only
   transition histories of sales orders, purchase requests and purchase orders accept deleting the
   creation row (empty → draft) only inside a draft delete (transaction flag `bc.draft_delete`,
   `src/db/sql/s3.sql`); any later transition still blocks the delete.
3. *Notification links.* `src/lib/record-links.ts` maps entity type + id to the record's page;
   a notification opens the producer's stored internal link, else the derived page, else the
   action centre. `GET /notifications/open/{id}` marks the user's own notification read and
   redirects (plain links, never prefetched). A unit test checks every notifying entity type and
   that each derived route has a page.
4. *To approve.* `/approvals` (top-bar button with a count, Home menu, rail icon) lists the action
   centre's approval items the user may decide (permission at the item's site; the owner override
   shows everything) with who asked and when (from the audit trail), a direct link and, for kinds
   whose module decision needs no password or measurement, Approve and Reject / Send back with a
   reason, calling the existing module services (same permission and same-person rules).
5. *Locations.* "+ Add location" and an "Edit" button per row on Master data → Locations, an
   "Edit location" button on the detail page, simple labels (Type of place; Section or zone = the
   parent location, no new column) and a help note: one Site per address, each site with its own
   warehouses and locations.

**Why.** The owner works alone on a tablet: every screen must lead somewhere and a mistaken draft
must be removable, while posted history stays immutable.

**Consequences.** Custom SQL `src/db/sql/s3.sql` (replaces the three transition-log triggers with
`adr075_transition_guard`) must be appended to the merged migration; no table or column changes.
Tests: `tests/integration/masterdata/adr075-codes-and-draft-deletes.test.ts`,
`tests/integration/action-centre/adr075-to-approve.test.ts`, `tests/unit/record-links.test.ts`.
## ADR-077 Warehouse sections, after-the-fact purchase orders and the tablet receive screen

**Status.** Accepted (owner request, 2026-10-30; stream S6). Builds on ADR-043 and W4A (US-6-03).

**Context.** On an iPad the owner could not tell where raw materials and finished goods are ("it is all
around the place"); urgent buys are received with no purchase order and there was no way to make the PO
afterwards; and the PO receive screen was a 900-px table with eight columns per line that overlapped at
tablet widths.

**Decision.**
1. *Sections.* `locations.section` (nullable; `raw_materials | packaging | finished_goods | qa_hold |
   returns | production | other`, check `locations_section_ck`) set in Master data → Locations. Empty =
   derived (`sectionOf` / `sectionSql`, `src/lib/location-sections.ts`, `src/modules/masterdata/location-sections.ts`):
   quarantine/hold/rejected/recall → `qa_hold`, production/staging → `production`, else the warehouse kind
   when it is raw_materials/packaging/finished_goods, else `other`. A section is display and suggestion only;
   movement rules still come from the location class and lot status (V-LOC). Stock screens group by
   section (`stockBySection`, `sectionSummary` in `src/modules/inventory/sections.ts`): `/warehouse` (new
   warehouse home with section tiles), `/inventory`, `/inventory/locations`. Receiving and put-away
   suggest the item's section (raw material → Raw materials, packaging → Packaging, product → Finished goods)
   via `sectionForItem`; production output already lands in finished-goods locations by class.
2. *After-the-fact PO.* `createPoFromReceipt` (`src/modules/procurement/after-the-fact.ts`,
   `procurement.purchase_order.create` at the receipt's site, idempotency key): from a posted *unplanned*
   receipt, a draft PO with `after_the_fact = true`, `after_the_fact_reason`, `source_goods_receipt_id`;
   lines copy material, quantity and unit from the receipt lines (`source_goods_receipt_line_id`), the buyer
   enters prices; `qty_received_base` = the receipt quantity and line status `received`, so nothing is
   expected and the PO is never receivable. Normal V-ASL and approval rules apply; on final approval it
   moves approved → received (new transition, only for after-the-fact POs; `ck_purchase_orders_sent`
   exempts them since nothing is sent). One live PO per receipt (`uq_purchase_orders_source_receipt`,
   receipt row locked). Editing such a draft is refused (cancel and re-create); cancelling a draft frees the
   receipt. Reversing the source receipt is refused while a live PO points at it. The posted receipt is
   never edited. Supplier bills map the receipt lines to the PO lines (`purchaseOrderLineOfReceiptLines`).
3. *Tablet receive screen.* `/inventory/receive` asks "Which delivery is it?" (sent POs of the site, or
   "No purchase order"), then one card per item: quantity (+unit), supplier lot no., expiry date and a
   reserved brand slot (`brand-slot.tsx`); everything else under "More details". Layout uses container
   queries so fields never overlap at 768–1180 px. PO receiving moved here (`?po=<id>`);
   `/procurement/expected/<id>` redirects.

**Consequences.** Schema change needs a migration (lead regenerates): `locations.section`,
`purchase_orders.after_the_fact | after_the_fact_reason | source_goods_receipt_id`,
`purchase_order_lines.source_goods_receipt_line_id`, the index and checks above, and the changed
`ck_purchase_orders_sent`. Assumptions A-S6-01..04 (PRD). Tests:
`tests/integration/inventory/s6-sections.test.ts`, `tests/integration/procurement/s6-po-from-receipt.test.ts`.

## ADR-080 Production flow v2 (supersedes parts of ADR-074 and ADR-078)

**Status.** Accepted (2026-10-30). The owner delegated every decision ("act as the consultant, decide,
I will test on the demo/sandbox"). Design: `docs/production-flow-v2.md`; independent reviews:
`docs/reviews/production-flow-v2-qa-review.md` (GMP) and `docs/reviews/production-flow-v2-ux-review.md`
(tablet UX). Where they disagree, the decision below wins and the design doc is read with it.

**Decisions.**
1. **Statuses (supersedes ADR-074 §1):** one list everywhere (chip, progress strip, filters, board):
   Draft → Approved → In progress → Quality check → Done, plus end states Failed and Cancelled.
   Curing is not a status: "In progress · Curing until Fri 28 Nov". A QA "Not yet" shows
   "Quality check · On hold" in amber. **Done means QA passed** (not "moved to the hold area").
   Quantities show in pieces first ("247 bars · 2 batches"); mass only on Weigh and More details.
2. **Getting materials:** a pick list with "Taken" ticks; no stock move and no scanning by default
   (`production.prepare.move_stock`, `production.prepare.scan_lots`, both off). "Not needed" may never
   skip a weighing.
3. **Right lot at weighing (GMP blocker from the UX review):** the lot is preselected but the operator
   confirms it by typing the last 4 characters printed on the container (or scanning)
   — `production.weighing.lot_confirm`, default on.
4. **Second-person weighing check (supersedes ADR-078 §2):** mode `all | marked | none`; existing
   organizations keep their behaviour (true → all, false → none); new organizations and the sandbox
   `marked` (lye solution, colour, extract, fragrance, preservative are marked in the examples). The
   checker picks their name (owner decision, ADR-078) on a 2-tap confirm screen. [GMP: confirm whether
   critical lines need a PIN.]
5. **Two short checks** (Start check, Before wrapping check) replace the three line clearances in the
   example setups, "All OK" button, checker off by default. Sites with separate rooms keep three.
6. **Counts are typed once:** Cut step records bars cut; the daily log records good units and rejects
   by type; Finish is a read-back with only damaged and left-over wrappers typed (if nothing was logged
   it asks for the counts in three short screens). Samples come out of the good units; rejects found
   after wrapping count as wrappers used. Packaging balance must be 0. "Defects" are called "Rejects".
7. **Expiry counts from the mixing date**; the wrap label and the lot use the same date.
8. **Quality check (GMP blockers B1/B2 from the QA review):** one screen with Pass / Not yet / Fail,
   an "Exceptions in this batch" box and a "batch record reviewed" tick. The releaser can never be a
   person who weighed, checked or did a step of that batch; the owner override can bypass this only
   with a typed reason that is printed on the batch record. The person who entered the test results
   may release when `quality.release.tester_may_release` is on (restricted; default on). Release is
   done from the releaser's own signed-in session (never by picking a name). [GMP: confirm electronic
   signature validation before the paper BMR is retired.]
9. **Pass closes the batch automatically** when all closure checks pass (via the existing hook
   pattern), generates the BMR, sets the order Done when its last batch is decided, and notifies the
   linked customer order.
10. **Lye solution** is its own short order and lot, used only after a second person's check, with a
    use-by date set by QA. Soap example: 8 steps; lotion example with pH/viscosity before filling and
    a maximum bulk holding time.
11. **Screens and words:** operator screens Orders, Order, Get materials, Weigh (in-app 56 px keypad),
    Step ("Step done"), Finish, plus "Check quality" for QA and a one-page owner dashboard ("Waiting for
    me" first). Navigation per role: operators "My work" and "Today"; owner/planner Orders, Today,
    Rejects, New order, Setup; old screens in a collapsed "Advanced" group; Maintenance leaves
    Production; the iPad tab bar follows the role. Banned operator words include dispense, staging,
    quarantine, tolerance, yield, rework, reading, disposition, release (see the UX review §4).
12. **Target:** one soap batch from Draft to Done in ≤ 30 taps excluding typed counts, checked at
    820×1180 and 1180×820.

**Consequences.** Built in four stages (G1 status, order hub, navigation, words; G2 materials, weighing,
steps, curing; G3 finish, quality check, auto-close; G4 today page, dashboard, examples, hide and
redirect). Items a human GMP consultant must still confirm are listed in the QA review §5 and in
`docs/PRD.md` assumptions A-PF2-01..12.

**Consequences of stage G1 (2026-10-30, status, order hub, navigation, words).**
- The read model `src/modules/production/production-order-status.ts` implements §1 with one table row per
  case (unit-tested in `tests/unit/production-order-status.test.ts`). It reads batch facts (state, start,
  "ever rejected", finished-lot status, frozen step list, open step records, materials taken) in three
  queries (`loadBatchFacts`). A work order in `completed` with a batch in the hold area is now
  **Quality check**, not Done; Failed is its own chip; a part-failed order is Done with the warning
  "1 of 2 batches failed". The list filter pre-selects work order states that can map to the asked
  status and then filters on the computed status.
- The next action is a pure table (`production-order-next.ts`): Get materials, Start, Weigh, the step
  name, Curing finished (no button while curing), Check <step>, Finish, Redo, Check quality; without the
  permission at the site it becomes a wait with who can help. Multi-batch orders get one button per batch;
  the primary is the actionable batch furthest along. Until stages G2/G3 the buttons open today's
  screens (staging by scan, batch workspace, QA queue); nothing fakes a state change.
- Schema: `work_orders.needed_by date` (nullable; migration generated by the lead at merge). "Make for
  this order" links through the existing `work_orders.sales_order_id` and needs
  `production.work_order.create` plus `sales.sales_order.view` at the customer order's site
  (A-PF2-12 has the missing-pieces formula). Pieces are typed first; the batch count is the fewest whole
  batches whose expected pieces cover them.
- Navigation is built per role in `src/app/(app)/nav.ts` (`buildNav`, `tabsFor`, unit-tested): Maintenance is
  its own group; the bottom tab bar never shows "Batches" or a bare "Orders". "Today" is a read-only list of
  today's daily log entries for the site until the full page of G4.
- Words: "Defects" became "Rejects" on screens, in the setting label and in messages; table, setting key
  and permission names keep `defect`.
- Analytics checked: no KPI or dashboard counts "Done" production orders. KPI-OPS-05/-14 and the work
  orders report count **work order** states (labelled as such) and stay correct; the work orders report
  already counts a batch as done only after a QA decision. The operator home tile and the owner overview
  shortcuts now open production orders instead of the old batch list.
**Consequences, stage G2 as built (materials, weighing, steps, curing; slices V2-3..V2-5).**
- *Materials list* (`src/modules/production/materials-list.ts`, screen `/production/orders/[id]/materials`):
  append-only `batch_material_picks` (taken / not_needed / untaken; trigger in `src/db/sql/g2.sql`).
  With `production.prepare.move_stock` off (default) the last tick moves the batch planned →
  materials_staged with no stock movement; on, each tick runs the staging-by-scan body (`stageInTx`).
  `production.prepare.scan_lots` (default off) asks for the label. Held/expired lots are refused;
  "Not needed" never touches the weighing line. `startBatch` accepts a work-order batch whose list is
  complete (the scan path still works from "Materials by scan").
- *Weighing*: a Materials-list batch weighs only from the lots set aside for its order, and the weighed
  quantity converts that reservation. The Weigh card sends `lotPreselected` + `lotConfirm`
  (`production.weighing.lot_confirm` = last4 | scan | none, default last4, restricted). A lot scanned or
  typed into the lot field of the full batch record counts as confirmed (A-PF2-11 risk: choosing from that
  screen's list is not confirmed). `production.weighing.second_person_check` is now `all | marked | none`
  (stored booleans still read: true → all, false → none; `g2.sql` rewrites them and stores the old
  default for existing organizations); the checker confirms on the operator's tablet
  (`checkDispense(..., signedOn: "operator_device")`, ADR-078 name pick).
- *Steps*: `stepDone` (readings + completion in one command, out-of-range values kept, the next wait
  started at once); waits use the existing step kinds `curing` / `hold` and the routing minimum time
  (`earliest_completion_at`); ending early stays the CX-TOL exception (approver ≠ operator, reason,
  problem report). Job `production.curing_reminder` (hourly, one notification per step record).
- *Read model for G1*: `batchFlowFacts` / `getBatchFlowFacts` / `orderBatchFacts` (current step, ready
  date, "Curing until Sat 28 Nov", pick progress) and the pure `nextBatchScreen` ("what is the next screen
  for this batch") in `src/modules/production/flow-facts.ts`.
- *Expiry (§7)*: `production.output.expiry_basis` gains `mixing_date`, the default for new organizations
  (`batchExpiryDates`, one source for lot, BMR and label); existing organizations keep `manufacture_date`.
- Not in G2: Finish (G3) and Check quality (G3) still open the full batch record; "Use another lot" at the
  Materials list goes through the QA substitution; PIN on marked lines (QA review S1) not built.

**Consequences of stage G3 (2026-10-30, Finish, Check quality, auto-close).**
- **Finish (V2-6, §6).** `finishBatch` (`src/modules/production/finish.ts`, command `production.batch.finish`,
  idempotent) runs in ONE transaction under one batch lock the extracted bodies `recordYieldLocked`,
  `recordScrapReworkLocked`, `countPackagingLocked` and `postBatchToQuarantineLocked` (pattern of ADR-074 §2);
  the old commands call the same bodies and keep their behaviour. Lock order as `postMovement`: batch →
  packaging rows → lots in id order → balances. A comparison test shows the result equals the old commands
  run one by one. Counts are read back from the daily log of the batch (`batchLogCounts`: entries that count;
  entries without a batch only for a one-batch order); without log entries the screen asks for good pieces
  and rejects. Rejects become scrap records with reason code `other` and the note "Reject: <type>" (A-PF2-15).
  Wrapper arithmetic (QA review S4): used = good pieces (samples included) + rejects already wrapped; taken
  = used + damaged + left over within `production.packaging.reconciliation_tolerance` (default 0), else
  refused. Samples kept leave stock as a `consumption` with source `batch_retained_sample` (not a batch
  input, so genealogy is unchanged). A yield outside the range or rejects above the approval threshold need
  a reason and open ONE problem report through the existing `openDeviation` hook; that open report stands
  in for the prior approval at Finish and blocks the pass until QA closes it. Settings
  `production.output.default_hold_location` (site; empty = first active quarantine location in section
  `qa_hold`) and `production.output.retained_samples` (`{enabled: true, units: 2}`, needs approval). The
  checker at Finish follows the frozen transfer step's `requires_checker` (seeded routings: on).
- **Packaging count moved to Finish.** A packaging step no longer needs its components counted before it
  completes (`packagingBlockers`); a counted component out of tolerance still blocks it. The old transfer
  (`postBatchToQuarantine`) now refuses uncounted components instead of skipping their consumption.
- **Check quality (V2-7, §8).** `decideQualityCheck` (`src/modules/quality/check-quality.ts`, Pass / Not yet
  / Fail, idempotent) and the page `/quality/check/<batch>` (list `/quality/check`, "Waiting for check").
  Every decision is a row of the new append-only table `batch_quality_checks` (tick, exceptions shown,
  reason, check-again date, override reason, tester released). Release independence: the makers of a batch
  (weighed or checked a weighing, did or checked a step, finished or checked the finish, recorded the yield
  or rejects, took or counted wrappers) can never pass it; under the owner override only with a typed reason
  (≥ 10 characters), audited (`quality.quality_check.passed`, `governance.owner_override.used`) and printed
  on the BMR. `quality.release.tester_may_release` (restricted, needs approval, default **true**) lets the
  person who entered the results review the inspection and pass in the same transaction; the CHECK
  `ck_inspections_reviewer_not_performer` became a deferred constraint trigger (`src/db/sql/g3.sql`) lifted
  only by the transaction flag `bc.tester_release` (set only in that case) or the owner override. The
  decision takes no co-signer and refuses system contexts (own session only; password re-entry of QA
  review B3 is not built, see below). Not yet = lot `on_hold` with a review date ("Quality check · On hold");
  a later Pass lifts that hold first (`hold_lifted`). Fail = existing batch reject.
- **Auto-close (§9).** The pass calls `onBatchReleased` of the new quality release-hook registry
  (`src/modules/quality/release-hooks.ts`, same pattern as `execution-hooks.ts`), registered in
  `src/modules/wiring.ts` with production's `autoCloseReleasedBatch`. It runs as the system action
  `quality_pass_auto_close` on behalf of the QA person inside the same transaction: closes the batch when
  every closure check passes (BMR CONTROLLED COPY), otherwise generates the BMR and leaves the batch released
  (`production.batch.auto_close_skipped`). The closure check "Yield reconciliation checked" now also accepts
  the QA pass with "batch record reviewed" by someone other than the person who recorded the counts. The
  order becomes Done / Failed / Done with "1 of 2 batches failed" through the G1 read model; the person who
  created the linked customer order gets a `sales.order.stock_available` notification (no automatic allocation).
- **Not done in G3.** Password/PIN re-entry for the release (QA review B3; go-live item), the 3-screen
  empty-log Finish (one screen with the fields open instead), the in-app keypad (numeric inputs with
  56 px height), name-only signatures in the exceptions box (co-signatures by name are not linked to a
  batch in the audit), and the FDA notification warning (S11).
- **Migration (lead).** New table `batch_quality_checks`; drop CHECK `ck_inspections_reviewer_not_performer`;
  custom SQL `src/db/sql/g3.sql` (append-only trigger, reviewer trigger).

## ADR-081 Five destinations, Operations Center and stock by type (UX revision, slice R1)

**Status.** Accepted (2026-10-30). The owner asked to "perform the necessary revision" against the master
document's Part II–IV (UX restructuring brief and mockup board) on the existing app, without starting
from scratch. Read with `docs/UX_AUDIT.md`, `docs/NEW_NAVIGATION.md`, `docs/WORKFLOW_ARCHITECTURE.md`
and `docs/REDESIGN_IMPLEMENTATION_PLAN.md`. Builds on ADR-080 §11 (per-role navigation); supersedes
its group list only (Production and Maintenance as separate groups).

**Context.** The audit counted 13 menu groups, 117 menu items and six navigation surfaces; an operator
saw 54 items in 11 groups (UX-01, UX-02). No screen showed the pipeline from delivery to dispatch
(UX-20), and stock was not split into raw materials, WIP and finished goods (UX-23).

**Decisions.**
1. **Five destinations** replace the fourteen groups: Home, Operations, Inventory, Sales & Customers,
   Management (`src/app/(app)/nav.ts`). Every screen keeps its URL; only its place in the menu
   changes, so bookmarks, notification links and tests still work. Each menu entry appears once.
2. Inside a destination, items without a section are tabs; the rest sit in named menus ("Receiving",
   "Quality", "Packing & dispatch", "Maintenance", "Advanced" last; Management: "Reports & analytics",
   "Purchasing", "Finance", "Production setup", "Master data", "People & access", "System").
3. **Placement rules:** receiving (expected deliveries → receive → receipts → put away), quality,
   boxing/picking/dispatch and maintenance belong to Operations; customer invoices, payments,
   statements and credit notes belong to Sales & Customers; analytics, purchasing, supplier-side finance,
   production setup (formulas, steps, instructions, inspection plans, equipment), master data, users and
   system settings belong to Management. "My expense claims" is a personal item under Home.
4. **Floor roles** (operator and warehouse personas) do not get the Management destination; their
   pages still check access on the server as before (menus never grant or remove access). A new
   `warehouse` persona gets the tabs Home · Receive · Scan · Inventory · Menu; operators
   Home · My work · Today · Scan · Menu; QA Home · Quality check · Operations · Scan · Menu; everyone
   else Home · Operations · Inventory · Sales · Menu. Every tab bar ends with Menu.
5. **The quick-action rail is removed** (sixth navigation surface, icon-only, duplicated the menu;
   UX-27). Its actions are the "Quick links" of the Operations Center. Scan, To approve, notifications
   and the account menu stay in the top bar.
6. **Operations Center** (`/operations`, read model `getOperationsCenter` in
   `src/modules/analytics/operations-center.ts`): nine stages — Expected deliveries, Receiving,
   Awaiting inspection, Raw materials available, Production, Quality check, Packaging, Finished goods,
   Orders to dispatch — each a live count over existing state machines (no new table, no stored
   counter), split by status, with one attention line (late, on hold, expiring) and a link to the
   screen that does the work. A stage is computed only when the caller holds that module's view
   permission; scope is the current site or "All my sites" (same rule as the owner overview). Below it,
   the active batches furthest along first, each opening its production order (ADR-080 hub).
7. The owner/manager **Home** shows the pipeline first ("Right now"), then the existing KPI overview.
8. **Inventory** has tabs Raw materials · Work in progress · Finished goods · All stock, with Scan as
   the primary button. WIP (`/inventory/wip`) lists batches between materials set aside and the QA
   decision from the same read model as the Operations Center (WIP is not a stock lot; A-UX-03).
9. **Management** has a landing page listing only the sections the user may open.
10. An app-wide error page (`src/app/(app)/error.tsx`) replaces blank screens on pages without their own
   boundary (UX-24).

**Not decided here (needs the owner):** assignment of production orders to people or teams so "My work"
is truly assigned work (UX-15, A-UX-04); one approvals/alerts inbox (UX-06, UX-29); the shared
record layout (UX-21) and a workflow-instance record (UX-22) — see the implementation plan, phases R2–R4.

**Consequences.** No schema change, no migration, no new permission. Help guides and on-screen setup
messages now name the new paths (e.g. "Management → System → Templates & labels"). Tests:
`tests/unit/nav-per-role.test.ts` (five destinations, one entry per screen, per-role menus and tabs,
permission filtering) and `tests/integration/analytics/operations-center.test.ts` (counts equal the
records, a new lot moves the right stage, cross-site and role negatives).

## ADR-082 Assigned production orders, "To approve" for approvers, one record header (UX revision R2–R3)

**Status.** Accepted (2026-10-30). The owner delegated the open decisions of ADR-081 ("decide freely,
act like an expert; I will check when the app is live").

**Decisions.**
1. **Assignment (UX-15, A-UX-05).** A production order can be assigned to one person who makes it
   (`work_orders.assigned_operator_id`, nullable; migration `0029_r3_assignee.sql`, additive). The planner or
   site manager assigns (`production.work_order.edit` at the order's site); only active people who
   record production there (`production.daily_log.create`, active site assignment) can be chosen. Not
   assigned = anyone at the site may take it. Closed and cancelled orders cannot be reassigned. Every
   change is audited (`production.production_order.assigned`, before/after) and the new assignee gets an
   in-app notification that opens the order. Assignment is guidance, not a lock: it does not change who
   may record a step (permissions and site rules stay as they are), so a sick operator never blocks a
   batch.
2. **"My work"** lists the operator's own orders first, then the unassigned ones, never someone else's;
   a "Mine / Everyone's" switch shows the rest. Planners can use the same switch. Each card says
   "Assigned to you", "Assigned to <name>" or "Anyone can take it".
3. **"Your next task"** card on the operator Home: the first of those orders with a step to do, with its
   one next-action button (mockup "Start Task").
4. **One inbox for decisions (UX-06, UX-29).** "To approve" stays the single place where people decide.
   It is shown to office roles holding an `*.approve` permission and to anyone with something waiting.
   Floor roles do not see it otherwise: their sign-offs (second-person weighing check, line clearance,
   pack check) happen on the tablet at the step. Notifications stay information; the Action centre
   stays exceptions.
5. **One record header (UX-21).** Purchase order, goods receipt, customer order and shipment pages open
   with the same header as the production order: reference, type, name, site, status, a progress strip
   derived from the record's state machine (cancelled/reversed shown as blocked, never as progress) and
   one primary next action (existing actions only).
6. **Owner overview batch cards open the production order** (UX-09); a batch without an order still opens
   its full record.

**Consequences.** Tests: `tests/integration/production/assignment.test.ts` (picker, assign, audit, My work
order and filter, unassign, role escalation, cross-site, invalid assignee), `tests/unit/record-steps.test.ts`,
`tests/unit/nav-per-role.test.ts` (approver rule). Deployment: the migration runs at start as usual
(`scripts/start.sh`); rollback = redeploy the previous commit (the extra nullable column is ignored).

## ADR-083 Layout that fits tablets and phones, a plain Home, and floor menus (UX revision R5)

**Status.** Accepted (2026-10-30). The owner: "buttons and text are overlapping, the UI is a mess on
tablets, iPads and phones … I really don't like the UI, it is overwhelming." Two usability tests were
run with testers playing a non-technical owner and floor staff (`docs/USABILITY_TEST.md`).

**Decisions.**
1. **Breakpoints.** The full top menu (five destinations, section menus, site switcher) shows from 1280 px.
   Below that — phones and iPads in both orientations — the header is compact (menu button, logo mark on
   phones, scan, approvals, notifications, account), the destination's main tabs are one swipeable row
   with "More", and the role's bottom tab bar is shown. The drawer folds per destination.
2. **Fields keep the size a screen asks for.** `fieldClass` lets a caller's width, height, padding, text
   size or corners replace the base field class; a `w-24` input no longer stretches over its label.
3. **Green primary actions** (`--cta` = brand green), as the brief's design rules ask.
4. **Home answers the owner's questions only:** "Needs your attention" (plain sentences built from live
   counts, each opening the records), four headline numbers with plain titles, the live pipeline, and a
   link to the detailed overview, which moved to Management → Reports & analytics → Business overview.
   Home follows the site chosen in the header (or "All my sites") and offers Today / This week / This month.
5. **Floor menus.** Operators keep Home, My work, Daily log, Stock and Scan; warehouse staff keep
   Receiving, Packing & dispatch and Inventory. Pages outside the menu still open by link and are still
   checked on the server.
6. **Plain words** on menus, pipeline stages, Home and the screens the testers used (see the usability
   test for the list); developer codes (ADR, KPI, Phase, Wave) are not shown to users.
7. **The production flow never sends an operator to the full batch record to finish:** the last step's
   button is "Finish" and opens the simple Finish screen.
8. **"To approve" lists only what the user can decide now** (refines ADR-082 §4): each approvable module
   registers a read-only verdict in `src/modules/wiring.ts` that reuses its decide service's step, role and
   same-person rules; everything else visible to the user sits under "Waiting for others" with who must
   decide, and the badge equals the decidable rows. Approve is an on-page two-step confirmation (no
   browser pop-up). Kinds without a verdict keep the old rule (permission at the site, not your own request).
9. **Low stock** (`lowStockItems`, A-INV-LOW-01): usable released stock below the active reorder minimum
   (materials) or product minimum, shown in Home → Needs your attention. Reorder suggestions are worked out
   on page load when the nightly job has not run for 26 hours (`ensureReorderSuggestionsFresh`).

## ADR-084 Floor screen (production TV)

**Status.** Accepted (2026-10-30). Owner request: "a dashboard that is flashed on a screen in real time in
the production area". Plan: `docs/FLOOR_DISPLAY.md`. Builds on ADR-080 (flow facts, status v2), ADR-081
(Operations destination) and ADR-083 (floor menus).

**Decisions.**
1. **One read model, no new tables.** `getFloorDisplay(ctx, { siteId? })` (`src/modules/production/floor-display.ts`)
   reuses `batchFlowFacts`/`currentStepOf`/`waitLabel`, `loadBatchFacts` + `productionOrderStatus` and
   `defectSummary`. Panels: Making now (batches `materials_staged`/`in_process`, max 6 + "N more"), Next up
   (orders whose status v2 is Approved and whose batches have not reached `materials_staged`, by needed-by
   then planned start, max 5, "Late"), Waiting (curing/resting, `awaiting_qc`/`quarantined` with the oldest
   age, approved orders whose approval recorded shortages), Today (daily log good and rejects of the
   plant's day; "planned" = expected pieces of the orders In progress, the bar is hidden when that is 0).
2. **Authorization on the server.** `production.batch.view` at the site (`requireAt`: 404 outside the
   caller's sites, 403 without the permission). "Today" also needs `production.daily_log.view` at the site,
   else the panel says so. The payload holds no prices, no customer or supplier names and only first names.
3. **Route `/floor` outside the `(app)` group** (no menus, nothing to press), signed in with `requireContext()`
   like the print pages; `?site=<code>` picks one of the caller's sites. Sizes in vw so 1920 × 1080 and
   1280 × 720 show the same layout. Icons + words for every tone (green on track, amber waiting, red late).
4. **Refresh = server render every 30 s** (`router.refresh()`), "Updated hh:mm:ss"; when the data is older
   than 75 s or the browser is offline the screen says "Connection lost — showing hh:mm data". The error
   boundary retries by itself every 30 s. No websockets at this volume (SSE stays a later option). The timed
   `router.refresh()` is listed as an allowed exception of ADR-043 (no form, no server action on this page);
   the route has no `loading.tsx` (ADR-043 §3).
5. **Role "Floor display"** (`floor_display`, site-scoped, three `.view` strings), defined last in
   `src/lib/permissions.ts` so no grant loop widens it; synced by the seed and `pnpm admin:bootstrap
   --sync-roles`. Demo account `floor.nfd@bryels-care.test` ("Floor TV NFD", NFD). An account whose only
   role is floor_display lands on `/floor` (`homeHref`). Operations shows "Floor screen (TV)" to roles
   with `production.batch.view`, except floor personas (operator, warehouse; ADR-083 FLOOR_MENU).

**Consequences / risks.** The TV account is a normal session: it is signed out after the absolute session
lifetime (`session.absolute_hours`, default 7 days) and must be signed in again; a revocable signed display
link per site is the planned follow-up. The planned-pieces figure mixes "made today" with the plan of the
orders being made (multi-day curing orders inflate it); the owner should confirm the wording after use.

## ADR-086 No silent hand-offs (consultant review 2026-10-30)

**Status.** Accepted (2026-10-30). A step that hands work to another person must tell that person, in the
step's own transaction. (1) Draft and planned production orders are the To approve kind
`approval.production_order` (replaces `approval.work_order_release`), decided inline with the rules of
`approveProductionOrder` (permission at the site, separation of duties against the creator, owner override per
ADR-073), idempotent; approvers at the site are notified when the order is created. (2) Posting a goods
receipt notifies the people who can release lots at that site, once per receipt; the QA queue is oldest first.
(3) Dispatch creates the invoice draft in the dispatch transaction (sales hook registered by finance,
`createInvoiceFromShipment`, system actor on behalf of the dispatcher, idempotent per shipment, savepoint so a
refusal never blocks dispatch; setting `finance.invoice.draft_at_dispatch`, default on); reversing a dispatch
cancels only a still-draft invoice; submit/approve/issue unchanged. Home shows "N shipments are not billed
yet" from `notInvoicedShipments`. (4) "Record a payment" opened from an invoice preselects it and its open
amount; the server re-checks every amount. Recipients are always resolved by permission at the site.

## ADR-087 One page per material or product (owner request 2026-10-30)

**Status.** Accepted. `/inventory/items/[kind]/[id]` on the read model `getItemStock`: one total and its split
(ready to use · waiting for QA check · stopped by QA · expired · bad · set aside · promised to customer orders ·
free to use), totals by supplier and by brand (as recorded at receipt, ADR-076; by batch for products), what
expires first (30/60/90 days and already expired), where it is (per section and shelf), every lot in the order to
use them, and the last ten movements as sentences. Each lot falls into exactly one bucket (same rules as the
stock list), so the parts always add up. "All plants" only for users with lot view at more than one site;
minimums need balance view; customer-order figures need sales-order view. Reads only. One status vocabulary on
stock screens: Ready to use / Waiting for QA check / Stopped by QA / Expired – do not use / Bad – do not use.
Search never shows an expired lot as ready to use.

## ADR-088 The grade-5 standard for every screen, approvals by the top roles, packaging and labels in the flow

**Status.** Accepted (2026-10-30). Owner: "You just changed the layout; contents are the same… a grade 5 will
still not get it… the site manager or owner still needs approval from another person… where will the operator
get and scan the packaging lot… formula only in g or kg, how about pieces… if a material is not in the formula
help create it… users still need to add a code."

**Decisions.**
1. **Every screen** is reviewed against one standard (`docs/PAGE_REVIEW.md` tracks all of them): one sentence
   saying what the screen is for; forms show at most five fields, everything else defaulted under "More
   details"; **no user ever types a code** (the system numbers everything; editable only under More details);
   one green button for the next step; grade-5 words with "What is this?" for the six kept words (lot, batch,
   quality check, batch record, INCI, version); works on a 390 px phone; empty and error states say what to do.
   Shared blocks: `src/ui/guide.tsx` (`PageIntro`, `NextStep`, `MoreDetails`, `Explain`).
2. **The owner and the site manager may approve their own operational records** (production orders, purchase
   requests and orders, stock adjustments and counts, price lists, quotations, customer orders, supplier
   returns, expense claims, recipes and steps when the owner is the approver); the record shows "approved by
   <name> (own request)". Releasing a material or product lot for use (quality decision) stays with QA — the
   cosmetics GMP rule. Organization setting, default on; changes need the owner.
3. **Packaging and labels are part of the flow, not a scavenger hunt**: packaging (wrappers, labels, boxes)
   is listed in the recipe per piece, set aside and taken at "Get materials" like the ingredients; the
   packaging step asks only how many were used and thrown away; the batch's product labels (product, batch,
   expiry) are printed by the system from a button on that step. No lot is scanned that the operator did not
   get from the list.
4. **Recipes per pieces or per weight**: "This recipe makes [N] pieces" or "[N] kg"; the system converts with the
   product's weight per piece and the expected yield; ingredients missing from the list can be added on the
   spot.

## ADR-089 Guided recipe wizard on top of the formula and routing services

Status: Accepted (owner request 2026-10-30, "easy enough for a grade-5 student").

Decision: `/masterdata/recipes/new` and `/masterdata/recipes/[formulaId]` are a five-screen wizard (product, batch
size, ingredients, steps, check and save). Its only writer is `saveRecipe` in `src/modules/masterdata/recipes.ts`,
which calls the existing formula, routing, product and material commands; pure helpers live in `recipe-blocks.ts`.
All input is validated first with the services' own schemas; a failed save removes what it created with the existing
draft-delete/withdraw commands. A part unchanged since its approved version gets no new revision. Amounts typed in
percent must total exactly 100%. Step blocks map only to existing step kinds. "Make a new product" creates the
product and its SKU and activates both when permitted. "Add a new ingredient" creates the material inline. Approval,
immutability and batch snapshots are unchanged; the detailed pages remain as "advanced editing".

Consequences: new setting `masterdata.recipe.default_allowed_difference_pct` (default 2); assumptions A-RW-01..05
(A-RW-05, "later steps wait" ticked by default, flagged for QA); fixed the list counts and the advanced formula
editor reset bugs. Open: litres need a density. Batch size by pieces and packaging per piece: ADR-094.

## ADR-090 Warehouse screens speak in friendly units and plain words (usability test 2026-10-30)

Status: Accepted (owner delegated decisions; the 20x unusual-amount factor, A-UX-09, needs the owner's and the
warehouse lead's confirmation).

Decision: quantities on receive, move, count and adjustment are entered in a friendly unit (kg/g, L/mL, pcs; "20 kg"
typed is accepted), starting from the item's standard-pack unit, else kg, L or pcs. The server converts to the lot's
base unit with decimal.js (`qtyInputToBase`, optional `qtyUom` on `scanMove`/`recordCount`/`recordRecount`/
`createAdjustment`) and refuses unknown units or the wrong kind; stored quantities stay in base units (ADR-010).
Receive asks on the page before saving an amount more than 20x off the standard pack or recent receipts ("50 g of Palm
Oil? Most deliveries are 25 kg sacks."). A QA release messages `inventory.movement.post` holders at the lot's site
once per lot, inside the release transaction, with the suggested shelf. Receipt labels go straight to one print
preview. Stock counts go shelf by shelf. Adjustments look the lot up by words and are sent to the manager in one
action. Reasons `opening_balance` and `data_correction` require `inventory.balance.admin`. Warehouse users get a
six-tile Home (Receive, Put away, Move, Count, Fix stock, Find). Stored codes and statuses are unchanged.

## ADR-091 Top roles approve their own operational records (ADR-088 §2 as built, 2026-10-31)

Status: Accepted (owner request); flagged for review under A-GOV-SELF-01 (owner, accountant, QA adviser).

Decision:
- Setting `approvals.top_roles_self_approve` (organization, default on, restricted, `ownerOnly`): any change is a
  change request only an Owner/Director can approve.
- Top role: the Owner/Director (organization-wide, including organization-level records such as price lists, customer
  requirements and recipes) or a Site Manager at the record's site only.
- A top role may approve operational records they created or submitted and decide every step: production orders and
  plans, purchase requests and orders, supplier returns (and post them), stock adjustments and count variances (both
  steps and post), price lists and customer requirements (owner only), quotations, sales orders and over-shipment
  exceptions, expense claims, finance documents at steps whose roles the rules give them, and recipe/routing/work
  instruction revisions at steps that do not name QA. On their own records the owner may stand in for another
  role's step (never QA). Other people's records keep their role steps and escalation.
- Enforcement in services (`ctx.sodBlocksAt`, `assertSeparationAt`, `sodConflictAt`, `actsAsAnyRoleAt`); `audit()`
  writes `governance.self_approval.used`, flags the decision `ownRequest: true` and sets the transaction-local
  `bc.self_approval`, which the same-person trigger (`src/db/sql/adr088.sql`, migration 0030) honours on 15 operational
  tables only. "To approve" verdicts apply the same rule; records show "<name> (own request)".
- Unchanged: lot/batch release, quality check pass/fail, conditional release, hold lift, inspection review and floor
  checks keep an independent second person (GMP, ADR-080 §8), even for an owner holding QA; finance posting rules
  (poster ≠ approver, bill variance, own expense posting); ADR-073 owner override.

Consequences: tests `tests/integration/governance/top-role-self-approval.test.ts`; the finance detail pages' "Approved
by" row lacks the "(own request)" suffix (the step list has it); the seeded owner role lacks some sales/procurement
create strings (covered by the owner override in the demo).

## ADR-092 Packaging and labels in the production flow (ADR-088 §3 as built, 2026-10-31)

Status: Accepted; label content (A-G5-02) needs the regulatory adviser's sign-off, the per-product packaging setup
(A-G5-01) needs owner/QA confirmation.

Decision: a batch's packaging lines are the recipe's packaging lines, else the per-product setup
`production.packaging.per_piece` (expected pieces × per piece × (1 + spare %), rounded up). They are batch lines with
status `packaging`: set aside first-expiry-first at approval, listed on Get materials with lot and shelf, never
weighed. "Step done" on the packaging step records the issue against the taken lot (no scan; same postings and audit
as the scan path, `source: materials_list`) and converts the reservation; the step asks only how many were used and
spoiled; Finish still reconciles. "Print labels for this batch (N labels)" creates one label job (up to 999 copies) on
the approved finished-goods template; the first print fixes `output_lot_number`, made date and expiry on the batch and
Finish posts the lot with them; extra copies go through Reprint with a reason.

Consequences: migration 0031 (`batch_materials.bom_line_id` nullable; `batches.output_*`; label copies ≤ 999); tests
`tests/integration/production/packaging-flow.test.ts`. The recipe wizard offers packaging per piece (ADR-094).

## ADR-093 Setup records never need a typed code (ADR-088 addendum, 2026-10-31)

Status: Accepted; A-G5-MD-01..04 (QA defaults per kind, site code rule, usual-supplier proposal) need owner/QA
confirmation.

Decision: every set-up record's code is optional and made by the system in the creating transaction. New numbering
types WH, LINE, DEP and QCP (`{PREFIX}-{SEQ}`, never reset) alongside MAT, SUP, LOC, EQP. Site codes are the initials of
the name (max 6, numbered on clash) because they feed `{SITE}` in document numbers. Reason and unit short names and
quality-check test codes are made from the words. A blank code on edit keeps the code; typed codes stay unique. A new
material is three questions (name, kind, how it is counted); it takes its CoA and QA-check defaults from its kind, its
allocation rule is always first-expiry-first, and a usual supplier picked on the form is proposed for the approved list
in the same transaction (`createMaterialWithUsualSupplier`, needs `masterdata.supplier.edit`; QA still approves).

Consequences: tests `tests/integration/masterdata/adr088-no-code-setup.test.ts`; menu renamed Reasons, Units, Choice
lists, Making areas / lines, Quality checks for items.

## ADR-094 Recipe wizard by pieces and packaging per piece (ADR-088 §4 and ADR-092 as built, 2026-10-31)

Status: Accepted; A-RW-06 needs the owner, A-RW-07 needs QA and the owner.

Decision: the wizard's batch size is typed "By pieces" (default for new recipes) or "By weight (kg)". By pieces, batch
grams = pieces × grams per piece × 100 ÷ expected amount made %, rounded up to a whole gram (decimal.js), stored only as
the formula's reference batch size; a stored size that is exactly N pieces is shown back as N. Grams per piece is the
product's size, else the net content of its same-code SKU; a missing one is typed once and saved through
`updateProduct` (needs `masterdata.product.edit`). "Packaging for each piece" saves recipe packaging lines (material
kind packaging, made inline as packaging/pcs; quantity = pieces × per piece; proportional; 0% allowed difference; no
weighing check) after the ingredient lines; ADR-092 sets these aside and lists them on Get materials; they are outside
the percent total and never weighed. `saveRecipe` refuses packaging as an ingredient and non-packaging as packaging.
Formula and production services unchanged; no migration.

Consequences: tests `tests/unit/masterdata-recipe-pieces.test.ts`, `tests/integration/masterdata/recipe-wizard.test.ts`;
the advanced formula revision page still adds packaging pieces into its gram total (to fix).

## ADR-095 Grade-5 pass of every screen completed (ADR-088 delivery, 2026-10-31)

Status: Accepted.

Decision: all screens in `docs/PAGE_REVIEW.md` (Production, Quality, Maintenance, Setup, Inventory, Purchasing,
Finance, Sales, Reports, Settings & people, Home, Help, Operations) follow the standard: one "This screen is for…"
sentence, a "What to do next" box on record pages, at most five visible fields with the rest folded, no typed codes,
names before codes, plain words, phone 390 px without sideways scroll. Shared pieces: `src/ui/guide.tsx`,
`src/ui/plain-list.tsx`, `src/ui/name-and-code.tsx`, `src/ui/qty-unit-input.tsx`. Menu items use the same words as the
screens (e.g. Problem reports, Stopped by QA, Repair jobs, To get from shelf, Send out, Price offers, Requests to buy,
Running low, Money, Close the month, People, History of changes). Help is five role guides ("Your day in 5 steps") plus
"Words we use". Stored codes, statuses, permission strings, exports and printed GMP records keep their names;
renaming printed records needs QA sign-off. New read model `getTopProducts` for the Reports landing.

Consequences: per-area unit tests `tests/unit/grade5-*.test.ts` guard the intro sentence, no typed codes and the jargon
titles. Open: 118 of 170 settings have no written description; supplier-bill lines still priced per base unit; the
finance "Approved by" row lacks "(own request)".

## ADR-096 Recipe advanced-editing screens and product codes (ADR-088/093/094 follow-up, 2026-10-31)

Status: Accepted; A-G5-MD-05 needs the owner.

Decision: the products, formulas ("Recipes (advanced)"), routings ("Steps (advanced)") and work-instruction ("How-to
sheets") screens follow the grade-5 standard and point first to the step-by-step recipe. A blank code is made in the
creating transaction: PRD-, SKU- (a product's first sellable item takes the product's code), F-, R-, WI- (numbering
types SKU, FRM, RTG, WI). A blank code on edit keeps it; typed codes stay unique. Products take shelf life in months.
`getFormulaRevision` totals exclude packaging lines and return them as `totals.packaging` (closes the ADR-094 open
point). Approval and QA-independence rules unchanged.

Consequences: tests `tests/integration/masterdata/grade5-recipes-advanced.test.ts`,
`tests/unit/grade5-recipes-advanced.test.ts`. Open: the recipe wizard still picks F-/R- codes with `nextCode`; switch it
to server numbering later.
