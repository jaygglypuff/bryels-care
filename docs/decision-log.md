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

Status check 2026-11-06 (ADR-115 §5): no later entry accepts ADR-023 on its own. It went to the owner with
ADR-001 to ADR-014, ADR-019 to ADR-021 at Gate 0 (`docs/gate-0-report.md`, approval checklist); the README
records Gate 0 as approved and the code follows all seven items (for example item 4 in
`src/db/schema/offline.ts`, item 6 as the `inventory_balances` CHECK). The status is left as written, like the
other Gate 0 entries, until the owner's Gate 0 approval is recorded in this log (open item for the principal architect).

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

ADR-056 to ADR-070: reserved, never used (checked 2026-11-06, ADR-115 §5). The Wave 4 decisions were recorded as
assumptions in `docs/PRD.md` and in later ADRs instead; the numbers stay unused so no old reference can point at a
different decision.

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
from scratch. Read with `docs/archive/UX_AUDIT.md`, `docs/NEW_NAVIGATION.md`, `docs/archive/WORKFLOW_ARCHITECTURE.md`
and `docs/archive/REDESIGN_IMPLEMENTATION_PLAN.md`. Builds on ADR-080 §11 (per-role navigation); supersedes
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

## ADR-085 Plain-word look-up and "Planning tools" (consultant review 2026-10-30)

**Status.** Accepted (2026-10-30; commit "Search lots by plain words and retire \"Older screens\""). Section
written 2026-11-06 from `docs/CONSULTANT_REVIEW.md` (§2 D, §3 items 2–3, §9 wave 0) and the code that cites it
(`src/modules/scan/card.ts`, `src/app/(app)/nav.ts`), because about ten places cite ADR-085 and the section was
missing (ADR-115 §5). It records what was built; it adds no new decision.

**Context.** The consultant review found that a first-time user freezes when look-up needs an exact code
("coconut" or "Coconut Oil" was refused) and that the menu word "Older screens" meant nothing.

**Decisions.**
1. **Plain-word lot look-up.** Typed words on Scan or search (and later in Move stock, counts, Fix stock and Put away)
   are not refused: `keywordMatches(ctx, text)` lists lots at the caller's sites whose lot number, supplier lot, paper
   number, material or product name or code, or supplier name contains every typed word (2 to 5 words, case does not
   matter). Order: with stock first, usable, then waiting for QA, then expired / stopped / rejected marked "do not use",
   each with its shelf ("Did you mean…"). An exact lot number still opens the lot. Read-only, needs
   `inventory.lot.view`, site-scoped like every look-up.
2. **"Older screens" becomes Management → Planning tools.** The detailed production screens left Operations and sit in a
   Management sub-menu with plain labels, for planners and the owner (later reduced to Production plan and Batch
   records when the old screens became redirects: ADR-100, ADR-102, ADR-115).
3. Header in words, destination descriptions and the floor-screen plan were delivered in the same wave (wave 0 of the
   consultant review); the floor screen itself is ADR-084.

**Extended by.** Universal search (owner review 2026-10-30, A-SCAN-02), ADR-088 §3 (lots found by words in the
warehouse screens, A-G5-I2), ADR-098 (one way to identify stock things).

**Tests.** `tests/integration/scan/keyword-lookup.test.ts`, `tests/integration/scan/scan-card.test.ts`,
`tests/unit/nav-per-role.test.ts`.

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

## ADR-097 Inventory and warehouse screens in plain words (ADR-088 delivery, 2026-10-31)

Status: Accepted; A-G5-I1 (display words) and A-G5-I2 (finding lots by words) need the owner.

Decision: all 38 /inventory, /labels and /warehouse screens follow ADR-088: an intro line, one next step on record
pages, rare actions in ⋯ More, at most 5 visible fields, and plain words from `src/ui/inventory/words.ts` (stock
change, undo kept on record, saved to stock, used in making, moved, box or sack, shelf, being made, set aside, can we
deliver?, waiting for QA check, stopped by QA). FEFO is applied silently. Ledger tables are replaced by the shared
`MovementList` rows with friendly units (`fmtLotQty`, no trailing zeros). Lots are found by scan or by words
(`keywordMatches`, ADR-085) in move, count, fix stock and put away, and boxes are picked by content, so no code is
typed. Stored codes, permissions, the REVERSE confirmation word, exports and label status words are unchanged. Every
control is kept: immutable ledger with reasoned undo, count freeze and independent review, two approvers, ADR-091.

Consequences: test `tests/unit/grade5-inventory.test.ts`; menu items renamed (Stock changes, Deliveries received,
Shelves, Boxes and sacks, Being made, Expiring soon, Can we deliver?, Move stock…). With this every screen in
`docs/PAGE_REVIEW.md` is ☑.

## ADR-098 One way to identify stock things (UX audit round 1, 2026-10-31)

Status: Accepted; A-SCAN-10..14 need the owner/QA (tap is not a scan, order of found lots, label places, receiving
layout).

Decision: every field that identifies a lot, box, shelf, batch or item uses `<ScanOrPick>` (`src/ui/scan-or-pick.tsx`):
tap one of the expected candidates, scan (camera or handheld scanner), or find by name — never a bare code text box;
the value is a hidden input only a tap, scan or found item can fill, so a placeholder can never be submitted. Servers
(`resolveLotRef`, `resolveLocationRef`, `findLotForCount`, `findPickCandidates`/`resolvePickRef` in
`src/modules/scan/pick.ts`, site and permission scoped) accept a candidate id, a `BC:` label or a plain number and
refuse the placeholder, words, labels of another kind and other sites' records. A tap is recorded as "entered by hand"
(with a reason where a scan was expected), never as a scan. Verification scans (second check of a box, boxing check,
label verification) cannot be tapped. Found lots list usable stock first, then waiting for QA, then expired or stopped
(marked), each with shelf, amount and use-by date.

Consequences: field inventory in `docs/SCAN_INPUTS.md`; tests `tests/unit/scan/scan-or-pick.test.ts`,
`tests/integration/scan/scan-or-pick.test.ts`. Open: production fields adopt the component (production pass); receiving
without a purchase order still has 6 fields and mixes spare parts into the item list; machine labels `BC:EQP` not yet
accepted in these fields.

## ADR-099 Labels are printed where the work happens (UX audit round 1, 2026-10-31)

Status: Accepted. A-LBL-01 (label sizes) needs the owner and the warehouse lead; A-LBL-02 (product label content)
needs QA and the regulatory adviser.

Decision: every screen that prints a label (delivery, packaging step, box, lot, shelf) shows the label rendered by the
same renderer and approved layout as the label job (`labelPreview`), says where it goes and where it is scanned, then
offers "How many?" and one "Print N labels". The job is recorded against the site's first active label printer;
people never choose a "print station", they pick the printer in the browser's print window. `/print/labels/[jobId]`
prints with `window.print()` using the same `LabelFace` component, size-scoped CSS and a named `@page` per size, so
paper and "Save as PDF" are one page per label at the label size. `/labels` becomes "Labels printed" (history);
printers and templates stay under Settings › Labels and printouts. Job states, idempotency, reprint-with-reason,
superseding and voiding are unchanged. New label kind `product` (migration 0032) for the label on each piece: no
status bar, no bulk quantity; batch labels use it, falling back to an approved finished-goods label. Label renderer v2
(name largest, QR always inside, rows never overlap) is the default for new layouts; v1 stays registered so printed
labels re-render to their checksum; existing approved layouts move to v2 only when QA approves a new layout version.
A product label's `BC:LOT:<lot>` opens the batch until Finish makes the lot.

Consequences: tests `tests/unit/labels/*`, `tests/integration/documents/label-preview.test.ts`; help `docs/help/labels.md`.
Live data: QA must approve a v2 layout version and a `product` template on existing databases (demo reset seeds them).
Safari on iOS ignores `@page` size (print to a label printer with matching paper).

## ADR-100 One path for production work (owner complaint and UX audit A, 2026-10-31)

Status: Accepted; A-ONE-01..05 need the owner/QA.

Decision: every "do work" link is built in `src/modules/production/flow-paths.ts` and opens a flow screen
(`/production/orders/<wo|without-order>/{materials,weigh,weigh/more,step/n,continue}?batch=…`, Finish, Check quality).
`/production/<batch>` is a read-only Batch record with "Continue this batch" for people who can act; the old action
forms are removed. Batches without a production order use the same screens under `without-order`. The step card gains
the start check, second-person checks on the checker's own phone (confirm or send back with a reason), equipment
choice and extra fields under More details; configured step names show a plain subtitle. The packaging step shows the
taken wrapper lot, or the released packaging lots via ScanOrPick when the batch has no packaging lines; product labels
use the ADR-099 panel and the server refuses printing before the packaging step. Weighing lot confirmation is a scan
(typing the last 4 is the fallback for a damaged label). QA decisions are taken on Check quality only. Superseded
screens redirect: `/production/new`, `/production/work-orders(/new)`, `/production/staging` → production orders.

Consequences: tests `tests/unit/production-one-path.test.ts`, `tests/integration/production/one-path.test.ts`; no
migration. Open: redo (rework) has no service to move a batch in and out of `rework_approved`; the board is still tall
on phones; the closure page is reachable by URL for operators (actions server-checked).

## ADR-101 One door per job, menu words = screen titles, 44 px frame (UX audit round 2, part 1, 2026-10-31)

Status: Accepted; A-UX-11 needs the owner.

Decision: a screen with its own top-bar button is not repeated in the tab rows. Messages is the bell at every width;
To approve is a top-bar button from 640 px and a Home tab on phones; Problems & alerts links to To approve and keeps no
list of decisions. QA decisions have one door ("Check a batch or delivery", `/quality`), suppliers one entry
("Suppliers we may buy from"), expense claims one entry. Every menu word equals the H1 of its screen
(`tests/unit/nav-titles.test.ts`, with listed runtime-title exceptions); no role menu lists a screen twice. Rarely used
entries fold under "Advanced" in their section; IT screens sit in "IT and system" for system admin and owner only
(menus never grant access; pages still check it). The frame meets 44 px at 390, 820 and 1440 px; small buttons are
44 px on touch screens, 34 px with a mouse; checkbox/radio labels are ≥44 px rows. Phones get Scan in the top bar for
every role; record headers give the title the full width; destination descriptions are tooltips. No schema or
permission change.

## ADR-102 Superseded screens redirect and links follow (UX audit round 1, 2026-10-31)

Status: Accepted; A-LEG-01 (QA-status filter dropped from the supplier list) needs QA.

Decision: `docs/LEGACY_SCREENS.md` lists every route (current, advanced-kept, redirect). Superseded screens redirect on
the server and keep their URL alive: `/inventory/[lotId]/move` → `/inventory/move?lot=`, `/masterdata/suppliers` →
`/procurement/suppliers` (which gained Add a supplier, CSV and "suppliers we stopped using"), `/quality/check` list →
`/quality`; Problems & alerts keeps only problems (`?tab=approvals` → To approve, `?tab=alerts` → Messages).
`currentHref()` in `src/lib/record-links.ts` rewrites links already stored in messages and queue rows. Record, search,
scan and report links open the current screens. Message titles, queue rows and the most-read service errors use the
screen words; `userMessage()` strips internal error tags. The QA badge uses `qaQueueCount`, the same rule as the QA
list. Stored codes, permissions, exports and printed GMP records are unchanged.

Consequences: tests `tests/unit/legacy-redirects.test.ts`, `tests/unit/no-jargon-messages.test.ts`. Open: about 25
service error messages still use old words; the QA queue lacks the "check again on" date.

## ADR-103 One next step per record, names before codes, purchasing stays with purchasing (UX audit round 2, part 2, 2026-11-01)

Status: Accepted; A-R2P2-01 needs the owner (and QA for the receiving expiry).

Decision: every record page shows exactly one "What to do next"; when the next step is a form it sits inside the box
(`src/ui/next-step-box.tsx`, sales `DoNext`), so there is one green button; when someone else must act the line names
them from the who-can-do directory (`waiting-for.ts`, finance `approvalWaiting`). Refused screens name who can do it.
The permissions matrix is unchanged: the site manager approves but does not raise purchase orders or supplier returns
(separation of raising and approving; ADR-091 lets top roles approve their own records, it does not grant creation).
Feeds lead with names: activity sentences carry the record's name, message and alert titles move record numbers to
the end (`codeLast`), report footnotes drop design references. Big forms fold (copy a job, steps version, label
fields, reason detail, receiving without a purchase order). The recipe wizard needs ingredients and steps before
sending and marks products that already have a recipe. Drizzle renders a column inside an `sql` sub-select of a
single-table query without its table name, so such sub-selects spell out `"table"."column"` (fixed in recipes and
production order batches). The demo seed walks one order to each send-out step through the services.

Consequences: tests `tests/integration/procurement/r2p2-purchasing-access.test.ts`, `tests/unit/{r2p2-helpers,
code-last,sales-day-line}.test.ts`, extended `no-jargon-messages`, `recipe-wizard`, `fulfilment`, `owner-home`; no
migration. Open: batch closure page reachable by operators; label layouts awaiting QA; ~30 "(s)" plurals; help "?" in
the frame; name pickers still search box + dropdown.

## ADR-104 Floor decisions: other material at weighing, box labels, correcting QA results, one or more batches, batches over several days (owner request 2026-11-01)

Status: Accepted (owner delegated the decision). GMP points flagged for QA review: A-FD-01..05.

1. **Another material at weighing.** Two different cases, two different paths:
   - *Same ingredient, another lot* (e.g. the suggested coconut oil lot is finished or damaged): on the weigh card
     "Use another lot" lists the other released lots of the same ingredient at the site (use-first on top, expired and
     stopped lots never offered); the operator taps or scans one. Choosing a lot that is not the first to expire asks
     for a one-tap reason ("first lot is used up / damaged / not reachable"). The set-aside moves with it; the batch
     record shows "Lot changed from … to … — reason, by, time" (`batch_material_substitutions`).
   - *A different ingredient* (e.g. palm oil instead of coconut oil): never decided on the floor alone. If the recipe
     lists an approved alternative for that line, it appears under "Use the approved alternative". Otherwise the
     operator taps "Ask to use something else" (what, why); QA and the site manager get it in To approve; when QA
     approves (QA approval required, GMP), the line is swapped for this batch only and the batch record shows the
     change. The owner/site manager self-approval rule (ADR-091) does not replace the QA approval here.
2. **Labels: box labels by default, piece labels when the product needs them.** Per product, "How do you label it?":
   *A label on each box (default)* or *A label on each piece (bar/bottle)*. Packaging step for "each box": "How many
   pieces did you pack?" → the screen works out the boxes from "pieces per box" ("12 boxes of 24 and 1 box of 9") and
   prints one box label per box (product, batch/lot, pieces in this box, made, expiry, box 3 of 13, QR). Each box is a
   traceable box (container) in the hold area, so warehouse and sales scan boxes, not pieces. "Each piece" products
   additionally print piece labels with "How many?" defaulting to the pieces packed; the piece count is not
   reconciled label-by-label. Several boxes and a part box are normal.
3. **Correcting a QA test result.** A saved result is never edited in place (GMP). Before the QA decision, the person
   who entered it (or another QA person) taps "Correct this result" → new value + reason; the old value stays visible
   struck through with who/when. After the decision (OK / not OK), a correction needs a second QA person's approval
   and re-opens the decision; the owner override does not apply to QA results.
4. **One batch or several.** New production order: "How many pieces?" → the screen proposes the batches from the
   recipe's batch size and the mixer's capacity ("2 batches of 1,000 bars"), with a choice: *Split into N batches*
   (default) or *Make it one batch* — one bigger batch is allowed up to the largest batch the recipe / equipment
   allows (equipment capacity, or the recipe's "largest batch" set by QA); beyond that the button explains why and
   offers the split. Batches may also be sized individually ("1 batch of 1,500 and 1 of 500"). All ingredient targets
   are calculated from the batch size (never typed); a different amount at weighing stays inside the allowed
   difference, or needs the existing out-of-range approval with a reason.
5. **Batches over several days.** A batch stays "Being made" across days. Each step records who and when; at the end
   of a shift the step card offers "Stop for today" (where we stopped, a short note), and the next morning the task
   reads "Continue Calamansi Soap B-26-0006 · step 4 · started yesterday". Curing is a timed wait step ("Curing until
   Sat 8 Nov"). Pieces packed per day go into Today's count; Finish adds them up and checks the total. The floor TV
   shows "day 2" on the batch card.

Consequences: implementation per topic with tests (unit + integration, cross-site and role negatives); assumptions
A-FD-01 (reasons for another lot), A-FD-02 (QA approval for another ingredient), A-FD-03 (box label default and
content), A-FD-04 (correction rules), A-FD-05 (largest batch) in docs/PRD.md.

## ADR-105 Re-audit fixes: one order page, words not keys, status follows batches (UX re-audit A, 2026-11-01)

Status: Accepted; A-R4-01 (where operators issue paper batch pages now that the closure page is for managers and QA)
needs the owner and QA.

Decision: `/production/work-orders/[id]` is a server redirect to `/production/orders/[id]`, which gains "Plan the
batch", "Set aside new stock", "Change this draft" and the order history in words; a unit guard forbids links to the
old route. The production order status is "In progress · step n of N" as soon as any batch is being made (furthest
batch). Configured step names reach screens only through `plainWords()`; audit keys and step values only through
`record-words.ts` (stored keys and the printed batch record are unchanged). An unprinted batch label job with another
count is cancelled (audited) and replaced; printed labels keep reprint-with-reason. The closure page requires
`production.batch.approve`, `production.batch.admin` or `quality.disposition.approve`. The second person can send a
weighing back with a reason (`returnDispense`, append-only void, never by the weigher). The QA tests list shows only
batches sent to QA. One green button on weigh, Get materials, CAPA and maintenance pages.

Consequences: no migration or permission change; tests `tests/unit/record-words.test.ts`,
`production-order-status`, `production-one-path`, integration `one-path`, `packaging-flow`, `bmr-closure`,
`batch-execution`, `board-and-plans`, `w2c-inspections-release`, `check-quality`. Open: step 6 can show Print labels and
Step done both green until labels are printed.

## ADR-106 Get materials is a pick list per lot; weighing follows it; plain wrapper count; one guided path from purchase to boxing (owner 2026-11-01)

Status: Accepted (owner delegated). A-PL-01..03 flagged for QA review.

1. **Get materials = what to get, lot by lot, use-first order.** The list shows, per ingredient, the exact lots to
   bring in use-first (FEFO) order with how much from each and where it is: "Coconut Oil 100 kg: take all 50 kg of lot
   LM-2611-0005 (A-01, expires 7 Nov 2027) + 50 kg from lot LM-2611-0013 (A-01)". The set-aside already splits across
   lots; the screen shows the split.
2. **Partial containers.** A lot in one 180 kg drum and a batch needing 50 kg: "Bring drum LM-… (180 kg in it). Weigh
   out 50 kg. 130 kg stays in the drum for the next batch." Only the 50 kg is set aside; the rest stays available. The
   next batch's list again starts with the opened drum (it expires first), then the next lot.
3. **Weighing follows Get materials.** The weigh card proposes the lot(s) taken at Get materials, in the same order,
   with how much from each ("from LM-…-0005: 50 kg, then LM-…-0013: 50 kg"). If the operator scans another allowed lot
   of the same ingredient: "This is not the lot you took at Get materials (LM-…-0005). You can continue — QA will see a
   note." One-tap reason; the note shows on the batch record and on QA's check page. Expired or stopped lots are never
   accepted. A different ingredient follows ADR-104 §1b (QA approval).
4. **Wrappers count in plain words.** Finish asks: "We took 123 wrappers. You wrapped 120 bars. How many wrappers are
   left over? How many were damaged?" and shows the sum as a sentence ("123 taken = 120 wrapped + 2 damaged + 1 left
   over ✓"); a difference says what to do ("3 wrappers are missing — count the left-over ones again, or write what
   happened"). Left-over wrappers go back to stock in one tap. The taken amount comes from the packaging issue; a
   wrong issue amount (e.g. 1 instead of 123) is a bug to fix, not a count for the operator.
5. **One guided path from purchase to boxing.** A "How work flows" page (Operations) shows the chain Buy → Receive →
   QA check → Put away → Make (order → get materials → weigh → steps → pack → finish) → QA OK → Customer order → Get from
   shelf → Second check → Send out → Invoice, with today's count at each stage and one button to the screen for that
   stage. Every screen in the chain ends with "Next: …" to the following stage. Any screen in the chain that is not on
   this path is removed or redirected (docs/LEGACY_SCREENS.md).

## ADR-107 Round 4 UX fixes: shorter menus per role, frame-wide help, words not codes (UX re-audit C, 2026-11-01)

Status: Accepted.

Decision: rare menu entries fold under "Advanced" except for the roles that use them daily (`foldUnless`); a sub-menu
that is all-folded or has one entry merges into its neighbour (`tidySections`; Planning tools and IT and system
excepted). The owner sees 73 of 112 entries without opening a fold; nothing is removed. A 44 px Help "?" is on every
screen and opens that screen's guide (`helpForScreen`, `src/ui/help/screen-guides.ts`), or the role guide. The site
selector shows the site name only. On phones a header with buttons reads title → intro → buttons. Counts use
`plural()`, never "(s)" (test outside production/quality/maintenance until those files are rewritten); alerts and
messages show dates in words; lists colour only one primary action (To approve: the oldest). `/masterdata/recipes` is
the plain recipe list; the advanced editors stay under Advanced. Demo seed: plain step names on the same 7 steps, no
"(PLACEHOLDER)", and the running demo batch has an assigned operator (demo backfill only).

Consequences: tests `tests/unit/{plural,round4-ux}.test.ts`, extended `nav-per-role`, `no-jargon-messages`,
`activity-sentence`; the live demo needs a reset to show the new seed text.

## ADR-108 Names before codes, box labels printed at boxing, one name picker (UX re-audit B, 2026-11-01)

Status: Accepted; A-SCAN-14 (supplier lot optional for packaging and supplies) needs the owner and QA.

Decision: shelves and places show their name first and the code small and grey (`PlaceName` / `placeWords`) on
receive, counts, reservations and send-out pages; the two demo shelves get distinct names ("QA waiting cage",
"Stopped-by-QA cage"). Box labels are printed where the boxing happens (`/print/labels/pack/[packId]`); "print
station" no longer appears. One lot order (`lotUseOrder`) is shared by the finders and the Scan look-up (usable, then
waiting for QA, then do-not-use, each with its shelf). Customer and product choices use one searchable picker with big
rows. "Waiting for" lines name the team that does the step (`who-words.ts`); refusals name the people who can. A
delivery's totals before the second check come from what was taken off the shelf. The supplier's lot number is
required only for ingredients and intermediates (`SUPPLIER_LOT_REQUIRED_KINDS`). Print screens flag an old (v1) label
layout. Office sales people find Deliveries under Sales & Customers (`salesDesk`), everyone else under Operations.
Plain plurals through one helper (`src/lib/plural.ts`, merged from rounds B and C).

Consequences: tests `tests/unit/reaudit-b.test.ts` and extended integration tests (keyword-lookup, goods-receipt-
document, reservations-fefo, containers, fulfilment, boxing, label-preview); no migration. Open: the "QUARANTINE"
word on raw-material labels (QA labelling decision); live data needs a demo reset for shelf names.

### ADR-104 as built: items 2 and 4, and ADR-106 §4 (2026-11-01)

Status: Accepted (delivery record of ADR-104 items 2 and 4 and ADR-106 §4; sub-section since the 2026-11-06 numbering clean-up, ADR-115 §5).

Products carry "How do you label it?" (`products.labelling`, default `per_box`). On the packaging step and at Finish,
"How many pieces did you pack?" splits the pieces into boxes of the product's pieces per box, with one part box for the
rest; "Print N box labels" fixes the lot number and dates, takes a box number per box (`batch_boxes`) and makes one
label job per box (entity `batch_box`, template kind `carton`: product, batch, lot, pieces, made, expiry, "box n of N",
QR `BC:BOX:<number>`). A new count replaces the plan (old labels cancelled or voided, rows kept as replaced). Before
Finish the code opens the batch; Finish refuses more boxed pieces than good minus samples and, in the output
transaction, creates each box as a sealed container in the hold area. `per_piece` products also print piece labels.
New production orders propose batches from the recipe batch and the largest batch (smallest per-kind maximum of
in-service mixing equipment capacity on the routing, else the recipe batch): Split into N (default, even sizes), One
batch (up to the largest, else refused with the reason) or Choose sizes (each > 0 and ≤ largest, sum = pieces), stored
in `work_orders.batch_plan`; batches are created at their planned size and targets scale from it. Finish shows
wrappers as a sentence; too many is refused, missing wrappers may be explained through a problem report, left-over
wrappers return to their shelf in one tap; "taken" counts every staging transfer of the line (fixes "taken 1").
Migration 0034; assumptions A-FD-03, A-FD-05, A-FD-06 (QA and regulatory review); tests
`tests/unit/production-batch-and-box-plan.test.ts`, `tests/integration/production/adr104-box-labels-batch-plan.test.ts`.
Open: live carton templates need QA to add "Made"; litre capacities ignored (no density); odd batch sizes give weigh
targets with many decimals (fix in the weighing work).

### ADR-104 as built: §1, §3, §5 and ADR-106 §1–3 (2026-11-01)

Status: Accepted; open for QA: A-FD-01, A-FD-02, A-FD-04, A-PL-02. (Delivery record of ADR-104 and ADR-106; sub-section since ADR-115 §5.)

- **Pick list per lot** (`pickPlan`): Get materials lists, per ingredient, the lots to take in use-first order with
  how much from each, including what stays in an opened container; the weigh card proposes the same lots.
- **Another lot:** other released, in-date lots of the same ingredient appear only under "Use another lot"; a lot that
  is not the one to use first, or not the one taken, needs a one-tap reason; the set-aside moves in the same
  transaction and a `batch_material_substitutions` `floor_lot` row is written, shown on Check quality and the batch record.
- **Another ingredient:** the recipe's approved alternative (`bom_line_alternatives`, changeable only while the recipe
  revision is a draft) or a request `approval.material_substitution`. Only a QA person decides, by their own roles
  (`ctx.canGenuinelyAt`), never the requester; owner override and ADR-091 self-approval do not apply. Approval swaps
  the line for this batch only.
- **QA results** are append-only: before the decision superseded directly; after it, a second QA person approves a
  `qa_result_corrections` request, which reverses the decision's stock moves, returns the lot to quarantine and the
  batch to `quarantined` (a closed batch through a reopen record), re-opens the test list and writes the superseding
  result; refused once stock has moved on.
- **Several days:** "Stop for today" (`batch_pauses`), "Continue … started yesterday", "day 2" on the TV, "Packed over n
  days" at Finish.
- **Weighing resolution:** weigh windows rounded to 3 decimals the same way on screen and server (`weigh-window.ts`).

Consequences: migrations 0035 (tables) and 0036 (append-only and decide-once triggers, `src/db/sql/adr104.sql`); no new
permission; tests `tests/unit/{floor-decisions,weigh-window}.test.ts`,
`tests/integration/production/floor-decisions.test.ts`, `tests/integration/quality/result-corrections.test.ts`.

## ADR-109 Every hand-off names who acts next (owner request 2026-11-01)

Status: Accepted; A-NEXT-01 (first names on shared floor tablets) needs the owner.

Decision: `nextActors(ctx, kind, record)` (`src/modules/governance/next-actors.ts`) is the one rule for "who does the
next step": people with a current assignment at the record's site whose role holds the deciding permission and, for
records with approval steps, the open step's roles; an earlier step's approver never decides the next step. Floor
checks and QA decisions are independent: the weigher, step doer or requester is never listed, owner included (ADR-080
§8). Operational records follow ADR-091 ("You can approve this yourself because you are the owner/site manager").
`<NextApprover>` (`src/ui/next-approver.tsx`, words in `src/lib/next-actors-words.ts`: first names, role words, at most
three names then "or N others") is shown in success messages (`ActionState.next`), on the record's next-step line and
on the floor weigh and step cards. `notifyNextActors` sends one in-app message per person and dedupe key in the same
transaction. Floor tasks list a check the user can sign even on an order assigned to someone else. It is a hint only;
the deciding services re-check everything.

Consequences: `docs/NEXT_APPROVER.md` (inventory and remaining work); tests `tests/unit/next-actors-words.test.ts`,
`tests/integration/governance/next-actors.test.ts`; no migration.

## ADR-110 One line from purchase to invoice (end-to-end walk, 2026-11-06)

Status: Accepted (owner delegated); C15 and C7 flagged for owner/QA confirmation.

Decision (from `docs/END_TO_END_FLOW.md`, fix list C0–C20):
- **Data rules first (C1–C8):** the second check of a box refuses any box that is not on the pick list unless an
  over-shipment approval exists for that line and never counts past the order silently; "free stock" has one
  definition (the set-aside rule) everywhere, so "Make for this order" appears when the order is short; boxes made at
  Finish move with their lot when QA says OK, are listed in Put away, are set aside whole first and are picked by
  scanning the box; equipment that blocks weighing says why and offers the fix on the floor ("Record cleaning");
  the packaging step already subtracts the retained samples so box labels are right first time; sack labels show the
  quantity per sack; QA results need a recorded sample first.
- **Every hand-off is a message and a Home line (C9, with ADR-109)** and every stage screen ends with "Next: …" and one
  button to the next stage (C10). Procurement and warehouse get their own Home work lists (C11, C13).
- **One approval per purchase (C15):** an approved request to buy becomes a purchase order without a second approval
  when the supplier, items and amount stay within what was approved; a purchase order without a request, or above the
  approved amount, follows the approval rules. Approvers always see the amount they approve.
- **"How work flows" page (C0):** `/operations/flow`, one row per stage (16 stages, from "Ask to buy" to "Invoice"),
  each with who, today's count, the oldest item's age and one button; the same stages are the stepper on records.

## ADR-111 Lite demo profile and seed-versioned refresh (extends ADR-055, owner request 2026-11-01)

Status: Accepted; A-DEMO-LITE-01/02 need the owner.

Decision: the demo loads by default a small profile (`DEMO_PROFILE=lite`, `src/db/seed-demo.ts`, `src/db/seeds/lite.ts`):
one site, two products (Acapulco Soap 135 g, label per box; Aloe Hand Lotion 250 mL, label per piece), one approved
recipe and routing each, and a storyline made only through domain services (a released and boxed soap batch, a lotion
batch waiting for QA, a soap batch in progress, a lotion order ready for Get materials, purchase orders sent and
received, two customer orders). The large seed (`full`) stays for the integration tests. The lite seed records
`{profile, seedVersion}` in the `platform.demo.seeded` marker; on start `db:demo auto` wipes and reloads once when the
marker's profile or `DEMO_SEED_VERSION` (constant in `src/lib/demo.ts`) differs from the code's, after the unchanged
guards (demo mode, `APP_ENV`, no real accounts). When QA releases or rejects a whole lot, the boxes that hold only that
lot move with it (`moveBoxesWithLot`, audited).

Consequences: any lite-seed change must raise `DEMO_SEED_VERSION`; a deploy then resets the shared demo and signs
everyone out. Open: a routing with both a filling and a packaging step blocks the packaging step
(`packagingBlockers`); the lotion routing records packaging once, on "Label and pack".

### ADR-109 §2 Every remaining hand-off names who acts next (2026-11-06)

Status: Accepted (second part of ADR-109; sub-section since ADR-115 §5).

`nextActors` also takes an ad-hoc rule and `roleStandIn: false`, so the hint keeps step roles exactly as the service
does (stock fixes, finance documents, master-data revisions). The older "Waiting for" helpers (`waitingFor`,
`approvalNext`/`approvalWaiting`/`financeNext`, `waitingForApprover`) are built on it and apply the same-person rule.
Record helpers name and message the next people for quotations, customer orders, price lists, customer requirements,
count differences, stock-fix posting, setting change requests, box checks, master-data revisions, QA corrections and
the review of test results; stock-fix and finance success messages carry names. End-to-end walk C9 messages: PO sent →
warehouse ("Delivery coming"), each received lot → QA (opening the lot), second QA → tester, QA pass → warehouse and
sales ("can now be set aside"), pick → box checker, check → dispatcher, approval → assigned operator. Tests
`tests/integration/governance/next-actors-families.test.ts` and additions. Open: month reopen and delivery proof keep
their own words; the step "end early" form names approvers only in its picker.

## ADR-112 The BMR prints in seven parts, made for Chrome (owner 2026-11-06)

Status: Accepted; A-BMR2-01..03 (printed words, signer role, part 7 on its own page) need QA.

Decision: BMR renderer v2 lays out the bmr/v1 dataset (optional fields for roles, step start/end, material changes,
packaging taken, boxes and labels printed) as an A4 portrait document in seven parts: identity and recipe version,
dispensing and weighing, procedure, packaging and labels, yield, problems and changes, QA decision and sign-offs on its
own page, then the paper pages and the audit trail in words. Every page carries company, product, batch, lot and
"Page x of y" from `@page` margin boxes (Chrome 131+); rows and blocks never split; headers repeat; paper-form field
names are kept. v1 stays registered so printed BMRs re-render to their checksum; templates move to v2 only when QA
approves a new version (both demo profiles use v2). Recorded documents are shown inside `.recorded-doc`, which shields
their tables from app utility classes (fixes misaligned columns on the dispensing sheet, traveler, pick list, packing
list, delivery receipt and purchase order). Desktop Chrome fixes: top bar at 1920 px, side-panel detail lists, the
delivery page, reports and the recipe wizard tabs use the width. Tests `tests/unit/documents/bmr-v2.test.ts`,
integration `bmr-closure`. Live data: QA approves a BMR template version on renderer v2; batches pinned to v1 keep the
old layout. Open: old prints' footers still show codes (needs new layout versions and QA approval).

### ADR-110 as built: How work flows and visible next steps (C0, C10–C19), 2026-11-06

Status: Accepted (delivery record of ADR-110; sub-section since ADR-115 §5).

`/operations/flow` reads one model, `getWorkFlow` (`src/modules/analytics/work-flow.ts`, stage words in
`work-flow-stages.ts`): 16 stages and their counts at the current site, each count one query with its own view
permissions (a stage the viewer may not see is hidden); a row is red when an item waits at a hand-off and no message
names it (A-FLOW-01). The same counts drive the procurement and warehouse Home work lists; the customer order stepper
uses the order part of the 16 stages. Chain screens end with "Next: …" and one button. A purchase order inside an
approved request's supplier, items, quantity, amount and approval steps is approved at submit by the request's
approval (`requestApprovalCover`, audit `procurement.purchase_order.approved_by_request`); everything else follows the
approval rules, and approvers see the total they approve (A-PO-1APP-01/02, owner to confirm). The lot page names the
other QA person and shows the configured lot and batch rules side by side (A-QA-LOTBATCH-01, QA). No migration or new
permission. Tests: unit `work-flow`, `scan-qty`, `round-c16-words`; integration `analytics/work-flow`,
`procurement/adr110-one-approval`. Help: `docs/help/work-flow.md`.

### ADR-110 C1–C8 as built (2026-11-06)

Status: Accepted (delivery record of ADR-110; sub-section since ADR-115 §5).

- **C1** The second check of a box refuses any box not on the pick list (`NOT_ON_PICK_LIST`) unless an over-shipment
  approval for that line has room for the whole box; it never counts past ordered + approved extra; a box not on a
  shelf is refused; `completePacking` refuses `OVER_ORDERED` ("548 of 500 pcs …").
- **C2** Free finished stock has one definition, `freeFinishedStock` (released, in date, storage places, minus
  set-asides and reservations), used by set-aside and by `salesOrderShortfalls`.
- **C3** Built on `moveBoxesWithLot` (refuses mixed-lot boxes); boxes move with QA decisions, re-opened decisions and
  put-away, and are set aside and picked as boxes (BC:BOX accepted at pick and second check).
- **C4** Sales reads the shortage and asks the planner (`askPlannerToMake`, deduplicated, audited); the planner's Home
  lists customer orders short; the production order keeps and shows the customer order.
- **C5** Equipment blocks are explained in plain words on the weigh and step cards; "Record cleaning" uses the
  equipment service.
- **C6** Box labels leave out the retained samples; Finish pre-fills from the packaging step.
- **C7** Sack labels show the quantity per sack or "Sack n of N" (stored labels unchanged).
- **C8** Incoming checks need a recorded sample before results (`SAMPLE_REQUIRED`).
- A filling step that records packaging no longer blocks a later packaging step.

Consequences: no migration or new permission; assumptions A-E2E-01..06, A-LBL-SACK-01, A-QA-SAMPLE-01 (QA/owner);
status with test names in `docs/END_TO_END_FLOW.md`. Demo seed version raised so the live demo reloads on the new rules.

## ADR-113 Live check of the small demo (1): production, BMR, short-or-coming (one "short or coming" rule, weigh reasons, BMR words; 2026-11-06)

Status: Accepted (amends ADR-112, follows ADR-110); A-COVER-01 (owner, planner) and A-BMR2-04 (QA) open.

1. One rule for "short or coming" (`src/modules/production/order-cover-rule.ts`) is shared by How work flows (new count
   `so_coming`, never red), the planner Home and the order's shortage card: free stock, then batches waiting for QA,
   then batches of approved or in-progress orders, then unapproved orders made for the order; stock made for this order
   first; stock made for another open order never counts.
2. The weigh card gets a reason code from the read model (state before role) and names the checker before Save.
3. New BMRs print units, words and place names; "Planned by" is the production order's planner; role words come from
   one source (`src/lib/role-words.ts`); part 4 explains made vs boxed; a batch in progress prints a watermarked
   working copy that is not stored.
4. Renderer v2 was changed in place on the day it shipped, because only the demo profiles used it (no go-live): the
   only forced page break is before part 7, a short part 6 stays with part 7, result words never wrap. From now on v2's
   output is pinned by checksum; further layout changes need v3.
5. The locked packaging step says what comes first and shows the planned boxes and the label preview; liquids show
   volume ("250 mL a bottle"); place names come before codes.
Consequences: the lite seed links the lotion orders to the Isla Spa order and prints its box labels through the label
service; `DEMO_SEED_VERSION` raised; no migration or permission change.

## ADR-114 Live check of the small demo (2): names, desktop, Homes (names at every wait, desktop width, role Homes; 2026-11-06)

Status: Accepted.

Hand-offs name people everywhere they waited on a role: the QA lot page names the QA people who decide for every
viewer (`getLotDisposition().deciders`), a viewer who can act reads "So can …" (`othersSentence`); a sent purchase order
names who receives it and the expected date (`delivery_coming`); "You don't have access" names the people who can do
the work (`doingPermission`: a `.view` permission is read as the entity's doing permission). Desktop: the tab row holds
at most 7 entries, the rest under "More ▾" (`desktopRow`); To approve and Messages show their words from 1440 px;
record steppers use short words for steps that are not current; the recipe wizard (H1, "recipe so far" panel) and To
approve (list and detail side by side) use up to 1200 px or the full width; Homes balance their columns. "What to do
next" on Home is only a step the viewer can do (`firstActionable`); the warehouse is told which lot to put away and on
which shelf; operators lose the warehouse quick actions; recent activity takes its verb from the audit event. How work
flows stage 3 counts deliveries coming with the nearest date. No migration or permission change. Tests
`tests/unit/live-check-1106.test.ts`, `tests/integration/governance/live-check-names.test.ts`.

### ADR-110 C9 addendum: a fully set-aside order tells the pickers (2026-11-06)

Status: Accepted (addendum to ADR-110 C9; sub-section since ADR-115 §5).

When an order's stock is fully set aside (`allocateOrder`), the people at that site who may take stock off the shelf
(`sales.pick.create`, hand-off kind `pick`) get one message per order ("Get order … from the shelf"), never the person
who set it aside. The live check showed "Get from shelf" red on How work flows because nobody was told. Test in
`tests/integration/sales/fulfilment.test.ts`; demo seed version raised.

## ADR-115 Repository clean-up after the redesign (owner request 2026-11-06)

Status: Accepted (owner delegated); evidence: repository hygiene audit 2026-11-06.

Decisions:
1. **Old screens.** `/production/board` is retired (server redirect to `/production/orders?view=board`; page, action,
   service, setting `production.board.columns` and its tests removed). `/production/staging/[batchId]` is retired
   (redirect to the batch record); its old QA lot-substitution path is replaced by ADR-104 §1 and removed. The paper
   weighing sheet and batch traveler prints stay (paper backup for the floor) and are linked from the batch record
   (⋯ More). The help guides for retired screens (work order, staging, weighing) are removed; the others use current
   menu words.
2. **Dead code** with zero references is removed (unused files, server actions, components, exports).
3. **Local demo = live demo.** `pnpm db:reset` and local set-up load the lite demo; the integration tests keep the full
   seed through `tests/support`. README documents both profiles.
4. **Maintenance switch.** `MAINTENANCE_MODE=1` (used by the restore runbook) is implemented: every request except health
   checks gets a plain 503 page. `SESSION_SECRET` is documented as not used.
5. **Docs.** Superseded planning documents move to `docs/archive/` with a pointer to the ADRs; the old demo screenshots
   (`docs/demo/*.png`, 23 Oct) are removed; README, LEGACY_SCREENS, PRD (status column for assumptions), training plan,
   KPI doc, help pages and `.env.example` are brought up to date. Decision-log numbering is cleaned up in place (no
   ADR text changes meaning).
6. **Migrations.** File 0033 does not exist (journal idx 33 is `0034_…`); the next generated migration is renamed to
   `0037_…` so prefixes stay unique; documented in `docs/data-model.md`.

## ADR-116 Recipe wizard keeps what was typed; a product is offered for production only when its recipe and steps are in use (owner bug report 2026-11-06)

Status: Accepted (bug fix within ADR-089/ADR-094/ADR-074); A-RW-03 changed, A-RW-08 and A-PO-RDY-01 need the owner.

Owner's report: "I was trying to save a recipe in the demo but it fails to save and then restarts again — not even
saved as a draft. Also, when I successfully saved a recipe and used it for a production order, and then approved it for
batch, I get a routing error for that product."

Root causes:
1. **Wizard lost everything on a failed call.** The wizard kept its state only in React memory and awaited the server
   action without a catch. Any call that did not return a result (connection dropped, the app redeployed while the
   wizard was open — every deploy changes the server action ids, and the live demo is redeployed often —, a server
   restart, a 5xx) threw inside a transition; React passed it to the page error boundary ("This page could not be
   loaded"), and "Try again" re-mounted an empty wizard. Reproduced with Playwright by failing the save request (abort
   and HTTP 500). A signed-out person got "Something went wrong" (the `requireContext` redirect was caught as an error).
2. **"Save as draft" refused unfinished recipes.** Server and client applied the send-time promises to drafts: percent
   amounts not yet 100 % or a wait step without its time refused the draft, and the wizard's Next button blocked
   reaching "Save as draft" at all while the percent total was not 100 %.
3. **New order offered half-approved recipes.** A wizard recipe is two versions approved one by one: ingredients
   (formula) and steps (routing). The New order screen offered every product with an approved formula; approving the
   order then failed in `planLockedWorkOrder` with "<product> has no approved routing effective on <date>. A routing
   revision must be approved first (V-REV)." when the steps were still waiting (or not in use on that day).

Decision:
1. The wizard calls every server action through `safeCall` (`wizard-keep.ts`): a throw becomes a plain message at the
   top ("Not saved: the app could not reach the server … Nothing you typed is lost"). What was typed is kept in
   `sessionStorage` per person, wizard kind and recipe, with a fingerprint of the server's starting point, restored after
   a reload or a new sign-in in the same tab ("We kept what you typed on this device … Start over"), and cleared on a
   successful save. Session storage only: nothing outlives the browser tab on a shared device. The recipe actions answer
   a signed-out person in words instead of redirecting from inside the action.
2. "Save as draft" (`saveRecipe` with `submit: false`, and the client checks) no longer applies the wizard's completeness
   promises: percent total and wait time are checked when the recipe is sent for approval. What the services must store
   correctly still applies to drafts (product, batch size, a chosen ingredient, a valid amount, a step name). Screens 2–4
   offer "Not finished? Save as draft". Failure messages name the screen to fix. "Nothing changed" is no longer shown as
   "Saved as a draft".
3. `recipeReadiness` / `productReadiness` (masterdata) say whether a product can be made on a date — BOTH an approved
   recipe and approved steps in use on that date (V-REV, unchanged) — and otherwise one plain sentence naming who acts
   next (`nextActors`, the open approval step's people, the same people the approval notification goes to):
   "This product's steps are waiting for approval by Nina (QA) or Teresa (QA) — it can be made after that." Drafts name
   the author; approved-but-later versions name the day. Used by: the New order screen (only ready products can be
   chosen; the others are listed under "Not ready to make yet"; `?product=` shows the reason), `createProductionOrder`
   (refused with the sentence, nothing written), the draft production order screen (the sentence replaces the Approve
   button), and the approval / batch creation refusals (`planLockedWorkOrder`, `insertBatch`) instead of the raw
   routing message. Nothing about who may approve changes.

Consequences: no migration, no seed change (DEMO_SEED_VERSION unchanged). Tests:
`tests/integration/production/order-recipe-readiness.test.ts`, `tests/integration/masterdata/recipe-wizard.test.ts`
("Save as draft keeps an unfinished recipe"), `tests/unit/recipe-readiness-words.test.ts`,
`tests/unit/recipe-wizard-keep.test.ts`. Open: an order created before this change for a product whose steps are still
waiting stays a draft until they are approved; a copy kept on the device is per tab (a new tab starts empty).

## ADR-117 The owner approves recipes, steps and how-to sheets alone (owner decision 2026-11-07)

Status: Accepted (owner decision); GMP risk flagged under A-OWNER-ALONE-01 for the QA adviser and any auditor.

Owner: "If you are the owner, why would you let someone approve it? Example recipe, production order." Chosen option:
"Owner approves alone (setting)".

Decision: setting `approvals.owner_approves_recipes_alone` (organization, default on, restricted, `ownerOnly`). While on,
an `owner_director` with an organization-wide assignment decides every open approval step of a formula, routing or
work-instruction revision in one "Approve", including steps naming `qa_qc` and their own revisions (holding each
step's permission). Each step is recorded as the owner's with `approval_decisions.owner_alone = true` (CHECK: these
three record types only) and the note "Owner approved alone (no separate QA review)"; `audit()` writes
`governance.owner_alone.used`, flags the decision `ownerAlone: true` and sets the transaction-local `bc.owner_alone`,
which `bc_sod_distinct()` honours on `formula_revisions`, `routing_revisions` and `work_instruction_revisions` only
(migration 0038, `src/db/sql/adr117.sql`; no trigger dropped). The recipe page offers one green Approve for the waiting
recipe and steps (`approveRecipeAlone`). Revision pages, the recipe page and the BMR show "Approved by <name> (owner) —
no separate QA review". Recipe, steps and how-to sheet versions are action-centre approval kinds, so "To approve" lists
them. Unchanged: inspection plans, lot/batch QA release, quality checks, holds and every other QA decision; site
managers; QA users; the ADR-073 owner override. Production orders already worked for the owner alone (ADR-091).

Consequences: migrations 0037 (`approval_decisions.owner_alone`) and 0038 (custom SQL); the next generated migration
must become 0039. `decideWorkInstructionRevision` now respects multi-step rules. Tests
`tests/integration/masterdata/owner-alone-recipes.test.ts`, `tests/unit/owner-alone-words.test.ts`.

## ADR-118 Email through Brevo (owner 2026-11-08)

Status: Accepted (owner: "set up an email using Brevo for now").

Decision: the email adapter (`src/lib/email`) gains `EMAIL_PROVIDER=brevo`: Brevo's HTTPS transactional API
(`POST https://api.brevo.com/v3/smtp/email`, header `api-key: BREVO_API_KEY`), sender from `EMAIL_FROM`
(`Name <address>` or `address`), plain-text body. Same rules as Resend: HTTPS not SMTP (Railway blocks outbound SMTP on
small plans), only metadata is stored in `email_outbox` (never the body or the key), a failed send never rolls back the
change and is shown as failed, `none` stays the default. Set-up: in Brevo, verify the sender domain or address (SPF and
DKIM records at the domain's DNS) and create an API key; in Railway (web and worker services) set EMAIL_PROVIDER=brevo,
BREVO_API_KEY and EMAIL_FROM. Test `tests/unit/email-brevo.test.ts`.

## ADR-119 One calm type scale and one record page template (owner 2026-11-08)

Status: Accepted (UX lead; owner to confirm on the live demo). Amends ADR-082 §5 (record header) and ADR-088 §1
(PageIntro shown compact, wording unchanged).

Owner, with phone screenshots of "Check quality: Aloe Hand Lotion 250 mL": "big fonts but the focus is not on the batch
number. The summary is ugly too … it is not harmonious."

Decision:
1. **Type scale as tokens** (`@theme` in `src/app/globals.css`, table in `docs/ux-system.md` §2.8): `text-id` 26→30 px
   (record identifier), `text-title` 22→26 px (page titles, was 26→32), `text-section` 16→17 px (card titles),
   body 15 px below 1024 px, `text-meta` 13, `text-label` 12, `text-value` 18 (summary values), `text-stat` 26 (KPI and
   count numbers, were 26–34), `text-readout` 40 (weigh screen only). No page uses an ad-hoc `text-[NNpx]` above 20 px
   (print layouts and the keypad excepted). Spacing on an 8 px grid; cards 16/24 padding, radius 16/20 (§2.7).
2. **One record page template** (`docs/ux-system.md` Rules: 5.2): `RecordHeader` puts the identifier first as the H1
   (large, dark; `data-testid="record-number"` kept for tests and e2e), the status chip beside it, Help "?" and
   ⋯ More as compact icon buttons on the same row, the product/customer/supplier name as the subtitle, one meta line,
   then the progress strip and "What to do next". Setup records keep the name as the H1 (ADR-103/108) with the code in
   the meta line. `PageIntro` keeps its sentence but shows one line on phones with "more". Summaries use `SummaryGrid`
   (2 columns on phones, 3–4 when wide; bold numbers with units, one small line under each); "nothing went wrong"
   becomes one `QuietLine` instead of a card. Applied to the record pages listed in `docs/ux-audit/harmony-review.md`.
3. Behaviour, permissions, server actions and words are unchanged; only layout and type. No migration, no permission,
   no new dependency.

Consequences: unit test `round4-ux` (page header margin) and the redirect helpers of the grade-5 tests (now also accept
`RecordHeader`) were updated; e2e scripts read `record-number`/`record-reference`, which the new header keeps. Open:
forms are not yet regrouped into titled sections; lists kept their row anatomy; print layouts unchanged (see the review).

## ADR-120 Typing the code printed on a label counts as reading it (owner 2026-11-08)

Status: Accepted by the owner; A-SCAN-TYPED-01 needs QA to confirm. Supersedes in part the ADR-098 sentence
"Verification scans … cannot be tapped" and the ADR-100/105/106 rule "type the last 4 only for a damaged label".

Decision: every field that asks to scan a lot, box, shelf, batch or item also accepts the number printed on its label,
typed in. Case does not matter, and the number can be typed with or without dashes or the `BC:` prefix. Typing only the
last 3 or more characters works when exactly one expected item ends with them. The typing box sits under the Scan button
and never opens the keyboard on its own. A typed entry is saved as `typed`, in the same record a scan would write:
`pick_lines.entry_mode`, `pack_verification_scans.entry_mode`, `label_verifications.entry_mode`,
`batch_material_picks.lot_entry_mode`, dispense `lotConfirmed`, put-away `meta.locationVia`, count `lotVia`
(migration 0039). Typing counts for the verification checks (second check, boxing check, label verification, and lot
confirmation at weighing and Get materials), because the person reads the real label. Picking from a list still does
not count, and the server refuses it. The server matches a typed number exactly first, then ignoring case, dashes and
spaces. If two records would match, it matches neither. A wrong number gets a plain refusal.

Consequences:
- The second-check screen lists the boxes first, and asks how many loose pieces only after a lot label is scanned or typed.
- `docs/SCAN_INPUTS.md` has a new "Type the code" column.
- New tests: `tests/unit/scan/typed-codes.test.ts` and `tests/integration/scan/typed-codes.test.ts`.
- Risk: a checker could type the number from the pick list instead of the label (A-SCAN-TYPED-01).

## ADR-121 Master search: one box for screens, record numbers and names (owner request 2026-11-08)

Status: Accepted by the lead. The owner still needs to confirm A-SCAN-15: the synonym words, the common screens per role,
and the round search button from 1280 px.

Decision: there is one search. It opens from:
- the top-bar box, at 1024–1279 px;
- a round button, from 1280 px. This button also replaces the top-bar Scan button at those widths; "Scan a label" is in
  the dialog instead;
- Ctrl/⌘+K, or "/", on any screen.

On phones the Scan button opens "Scan or search", which shows the same search above the scanner.

What it finds:
- Screens. These come from NAV, filtered by the person's permissions and roles, plus one synonym list
  (`src/app/(app)/search-screens.ts`).
- Records. These come from `masterSearch(ctx, q)` (`src/modules/scan/master-search.ts`), a registry of 47 numbered
  record types.

Access: each record type has its own view permission. It is checked per site with `canAt`; organisation records need
the permission itself. A type the person cannot view is never queried, and every query is limited to their
organisation.

Matching:
- Exact numbers match through the `(organization_id, number)` indexes. Migration 0040 adds the three that were missing.
  Capitals and dashes do not matter: dashes are rebuilt from the numbering shapes.
- Last digits use a pattern match, capped at 5 results per type and 30 in total.
- Words search names.

The search only reads, so it is not audited. Recent items stay in the browser.

This extends ADR-085 and A-SCAN-02 (`searchEverything` is unchanged) and keeps ADR-098. It changes ADR-101's "Scan at
every width" for 1024 px and wider.

Tests: `tests/unit/search-screens.test.ts`, `tests/unit/scan/master-search-numbers.test.ts`,
`tests/integration/scan/master-search.test.ts`.

Known issues:
- The owner's menu row at 1280 px is still 74 px too long; it was 110 px too long before this change.
- The search has no rate limit. Input is capped at 80 characters and every query has a LIMIT.

## ADR-122 Round 4 leftovers and the small-demo rehearsal (2026-11-07)

Status: Accepted (UX leftovers, no owner decision needed). Extends ADR-073, ADR-109 and ADR-111.

Decision:
1. **Who acts next names the owner when nobody else can.** When no one holding the open step's role is left (the small
   demo has one finance person, and she sent the invoice) and `governance.owner_override` is on, `nextActors` names the
   organisation-wide owners instead of "Nobody can do it yet". The owner already could decide it (To approve offered
   it). Never for independent rules (floor second-person checks, QA decisions). Screen hint and notification list only;
   the deciding service re-checks as before.
2. **The label on each piece says "piece".** `LABEL_KIND_WORDS.bar` read "bar" for every product, so the lotion said
   "How many? (one for each bar)". The stored kind `bar` is unchanged; only the words are.
3. **Leftovers done:** "(s)" plurals in production, quality and maintenance (test exclusion removed); To approve row
   and side panel no longer share field ids (`useId`); Compare over time dots have an invisible 88-unit tap target;
   one green button on Problems & alerts; recipe wizard progress bar before its intro.
4. **`tests/e2e/demo-rehearsal.cjs`** now walks the small demo (docs/demo-script.md) through the current flow: QA check,
   pour, put away by scan, Get materials, Weigh by scanning the lot label (the checker confirms on his own session), the
   steps, box labels, Finish, Check quality, set aside, get from shelf by label, second check by another person, send
   out, proof of delivery, invoice (the owner approves, finance saves it to the books), trace and the owner's Home.

Consequences: no migration, no permission change. Tests: `tests/unit/round4-leftovers.test.ts`,
`tests/unit/approvals-unique-ids.test.ts`, `tests/unit/no-jargon-messages.test.ts` (all areas),
`tests/integration/governance/next-actors.test.ts` ("nobody left in the step's role"). The rehearsal needs
`FILE_STORAGE` set (the proof-of-delivery signature is a file); without it the screen says "File storage isn't set
up", which is the configured behaviour (docs/deployment-railway.md).

Open:
- The trace of a lot that is set aside or taken off the shelf but not sent yet says "No customer has received this"; it
  does not name the order it is set aside for (docs/demo-script.md scene 7 now says so).
- On the Isla Spa order the use-first rule set aside the older lotion lot (loose pieces) rather than the boxed new
  batch; correct by FEFO, but the presenter should know the boxes stay on the shelf.
- After the invoice is sent for approval, the delivery still reads "Next: finance bills it" with "Open invoice draft".

## ADR-123 Harmony leftovers: menu fit, one record template, one green button, titled form sections (2026-11-07)

Status: Accepted by the UX lead. The owner is to confirm on the live demo. Extends ADR-119 and ADR-121.

Decision:
1. **The menu row fits at every desktop width.** From 1280 to 1535 px the top bar shows the logo mark instead of the full
   logo.
   - The owner's menu row was 74 px too long at 1280 px. It now fits with 38 px to spare.
   - Every role fits at 1280, 1366, 1440, 1536 and 1920 px, with nothing cut and the site selector and search visible.
     `tests/e2e/top-bar-fit.cjs` checks this on the full demo.
2. **Every page about one record uses `RecordHeader`.** This now includes the person and job pages under People &
   access, which are setup-style (the name is the H1).
3. **The status chip sits beside the identifier.**
   - On the QA lot page it replaces the status banner. A plain sentence below appears only when the status stops people.
   - On QA, maintenance and repair records it moved out of the first card.
4. **One green button per page.**
   - A page's own next-step card or button row folds into the header's `next`, `primary` and `waitingFor` slots, with the
     same controls (production order, item page). `RecordHeader`'s next box accepts block content.
   - A next step that jumps to a form on the same page is an outlined button; the form's own button is the green one.
   - Controls that the next step does not point at are outlined.
   - Setup pages fold their edit form in `EditDetails` ("Change the details").
5. **Long forms use titled sections.** Forms with more than five fields on record and setup pages use the shared
   `FormSection`: a title in `text-section`, at most five visible fields, and the rest folded. This applies to material,
   product, supplier, reason, site and shelf/area.

Behaviour, permissions, server actions and stored data are unchanged. There is no migration.

Tests: `tests/unit/harmony-leftovers.test.ts`. `tests/unit/grade5-recipes-advanced.test.ts` now also accepts a
`FormSection` fold as "More details".

A survey of 57 record pages on the full demo, at 390, 820 and 1440 px, found:
- no sideways scroll;
- at most one visible green button per page;
- at most five visible fields per form;
- no text above 20 px except the `text-stat` token.

## ADR-124 Demo-rehearsal leftovers: billing follows the invoice, names on lines, trace names waiting orders (2026-11-07)

Status: Accepted. These are UX leftovers of ADR-122 and need no owner decision. Extends ADR-108, ADR-109, ADR-110 and
ADR-122.

Decision:
1. **The next step of a delivery and of a customer order follows its invoice** (`billingStepOfShipment` /
   `billingStepOfOrder`; words in `src/lib/billing-step-words.ts`).
   - No invoice, or a draft: "Next: finance bills it".
   - Sent for approval: "Waiting for <names> to approve the invoice". The names come from `nextActors("invoice")` with
     the To approve record, so the ADR-122 owner fallback applies.
   - Approved: "Next: finance saves it to the books".
   - Saved to the books: "Billed … Next: get paid".

   An order shows its delivery that is furthest behind. The owner Home splits "not billed" into three: to make, waiting
   for approval, and to save to the books. These are the same stages as step 16 of "How work flows". People without
   invoice access see the stage and the names, but no link.
2. **Document lines show the name first, with the code small and grey after it** (`LineName`, `splitLineName`). This
   covers the invoice, the supplier bill, the printed invoice, the printed price offer, and the delivery and order
   set-aside rows. Stored description snapshots are unchanged. The recorded delivery receipt keeps its v1 layout until
   a v2 renderer is approved.
3. **The forward trace lists the orders a lot waits for**, apart from the customers who received it:
   - "Set aside for order SO-… (Customer)";
   - "Taken off the shelf for order …".

   This comes from `TraceResult.pendingOrders` and is limited to the viewer's sites; orders at other sites are only
   counted as hidden. Sent rows read "Sent to <customer> on <date>".
4. **No new allocation rule.** Use-first stays: use-by date first, then made first, then received first, then lot number
   (`compareCandidates`), with whole boxes first inside a lot (ADR-050). The demo script explains this to the presenter.

Consequences: no migration and no permission change.

Tests:
- `tests/integration/finance/billing-step.test.ts`
- `tests/integration/quality/trace-pending-orders.test.ts`
- `tests/integration/finance/invoice-at-dispatch.test.ts`
- `tests/unit/billing-step-words.test.ts`
- `tests/unit/line-name.test.ts`

Open:
- Delivery receipt v2 layout, with the name first.
- Waiting orders in the trace export.

## ADR-125 Scan, offline and search leftovers (2026-11-07)

Status: Accepted (round 4 leftovers). Extends ADR-120, ADR-121, ADR-098 and ADR-018.

Decision:
1. **Offline captures keep how the lot was entered.** Offline count and weighing commands carry an optional `lotVia`
   (`scan` | `typed` | `tap`). The server writes it where the online path does: count audit `lotVia`, dispense audit
   `lotConfirmed`.
   - On an offline weighing the lot field confirms the lot, so a tap is refused on the phone and again on replay
     (`checkEntryMode`).
   - Commands queued without it replay as before. Ids and idempotency keys are unchanged.
2. **Every machine or scale field is a scan field** (`<ScanOrPick kind="equipment">`). This covers production step
   equipment (line clearance included), the scale on the online, "other ways" and offline weigh screens, and the machine
   on maintenance jobs and PM plans.
   - People can tap the machine, scan a `BC:EQP:` label, or type its number in any case, with or without dashes.
   - Lookups are limited to the person's organisation and current site.
   - The app prints no equipment labels yet. Their content needs the owner and was not invented.
3. **The master search is rate-limited.** It shares the scan look-up limit (`limitScanLookup`). Over the limit it answers
   in plain words, still shows menu screens, and queries no records. This closes the ADR-121 known issue.
4. **A repeated label shows its card again.** A label handed to Scan or search carries a request number
   (`?code=…&n=…`).
5. **No render-time randomness or runtime month names in hydrated components.**
   - Idempotency keys come from `useClientKey`, after hydration.
   - `fmtDate`, `fmtDayMonth` and `fmtDateTime` spell month names themselves ("Sept"), so printed output is unchanged.

Tests:
- `tests/integration/platform/offline-sync.test.ts`
- `tests/integration/scan/equipment-pick.test.ts`
- `tests/integration/scan/master-search-limit.test.ts`
- `tests/integration/production/execution-controls.test.ts`
- `tests/unit/scan/scan-href.test.ts`
- `tests/unit/client-key.test.ts`
- `tests/unit/date-format-stable.test.ts`

No migration. New assumption: A-SCAN-16 (search and scan share one 120-a-minute budget per person).

Known issues: the `useState(() => crypto.randomUUID())` hidden-key pattern remains in other forms (quality holds, admin
templates, put-away, closure, documents, BMR).

## ADR-126 Six open choices become owner-editable settings (owner 2026-11-07)

Status: Accepted (owner: "decide which is the best, but give me an option I can edit in the settings"). Extends ADR-117
(settings pattern), ADR-120, ADR-121, ADR-123 and ADR-124.

Decision: five organisation settings in the existing catalogue (`src/lib/settings.ts`), which means the existing
Settings screen, governance change requests and audit. Each defaults to the recommended choice, which is today's
behaviour. Every rule is enforced in the services; screens only hide what the server would refuse.

1. **`scan.typed_code_counts_as_check`** (default on; restricted, `ownerOnly`; QA confirms first, A-SCAN-TYPED-01).
   - Off: the second check, the boxing check, the label check, and lot confirmation at weighing and Get materials
     accept only a scan.
   - `checkEntryMode`, `confirmLot` and `confirmPicked` refuse `typed` the same way they refuse `tap`, online and on
     offline replay (`TYPED_NOT_A_CHECK`). A bare "last 4" is refused too.
   - The typing box is hidden for these checks only.
2. **`ui.wide_screen_top_bar`** (`search` by default, or `scan`).
   - `scan`: the Scan button stays at every width.
   - From 1280 px the Scan button is a round icon in the search button's place, because the owner's menu row has no
     room for both.
   - Ctrl/⌘K and "/" still open the search.
3. **`scan.search_open_to_everyone`** (default on; restricted, needs a second person's approval). Off: the search and
   `/inventory/scan` need `inventory.lot.view`.
4. **`sales.show_invoice_stage_without_invoice_access`** (default on; restricted, needs a second person's approval).
   Off: people without `finance.invoice.view` read only "Delivered." or "Sent out to the customer.".
5. **`ui.setup_edit_forms_folded`** (default on). Off: the material, product, supplier, site and shelf/area pages show
   their edit form open.
6. **No setting for the full logo at 1280–1535 px.** With the full logo the owner's menu row was 74 px too long, so the
   logo mark stays.

The Settings screen shows "Who should change it" for each setting, and a list for choice settings. Its chips now say
who decides: "Only the owner can OK changes" or "Needs your password".

Consequences: no migration and no seed change.

Tests:
- `tests/integration/scan/typed-check-setting.test.ts`
- `tests/integration/scan/search-access-setting.test.ts`
- `tests/integration/finance/billing-step.test.ts`
- `tests/integration/production/flow-v2-g2.test.ts`
- `tests/unit/settings-adr126.test.ts`

Open:
- The "Other ways" weigh form does not send `lotVia` yet, so turning typing off does not reach it.
- Setting 4 does not cover the order status chip "invoiced" or the owner's Home invoice counts.
- QA has no settings role in the app, so QA confirms setting 1 outside the app.

## ADR-127 The owner changes settings alone (owner 2026-11-07)

Status: Accepted. Amends the W2F permission exclusion and extends ADR-088 §2 (top roles approve their own requests),
ADR-117 and ADR-126.

Context: the owner asked to "edit in the settings" the choices of ADR-126, and asked earlier "If you are the owner, why
would you let someone approve it?". Before this change, the owner held no `platform.settings.admin`; they could only
approve changes. An owner-only setting also became a request that only the owner could approve, and nobody may approve
their own request. So a company with one owner could never change it.

Decision:
1. `owner_director` holds `platform.settings.admin`.
2. While `approvals.top_roles_self_approve` is on (default), the organization-wide owner's change of a restricted or
   owner-only setting applies at once.
   - The owner still re-enters their password.
   - The change is stored as an applied change request with the note "Own request: the owner changed it alone".
   - It is audited `platform.setting.changed` and `governance.self_approval.used`.
3. With that setting off, the owner's change waits for a second person like everyone else's.
4. Other administrators still submit requests, and site managers still have no settings access.
5. When the owner can change a setting alone, the Settings screen shows "You can change it alone (with your password)"
   instead of the approval labels.

Consequences: no migration. The database rule that the approver of a request is not its submitter is unchanged; the
owner's change records no separate approver. Tests: `tests/integration/governance/owner-changes-settings-alone.test.ts`
(new), `tests/integration/governance/settings-changes.test.ts` (the owner now administers settings).

## ADR-128 Finish and the Materials tab: one checker rule, nothing "missing" once it is in the batch (owner 2026-11-07)

Status: Accepted. Fixes two bugs from the owner's phone screenshots (Test Soap, WO-26-00005, made in the recipe
wizard).

1. **One checker rule at Finish.**
   - The bug: Finish refused with "The checker must sign the transfer to quarantine." The screen never asked for a
     checker, because the recipe has no move-to-QA step. The server assumed "needs a checker" when the step is missing
     (`requiresChecker ?? true`), while the screen assumed "no" (ADR-080 §6 says the checker follows that step).
   - The fix: both now read the step, and a recipe without it needs no checker.
   - When the step needs a checker, the screen says "A second person checks your counts". It explains whom to ask, and
     warns when nobody else from production can check at the site. The server's refusal reads "A second person must
     check the counts. Choose who checked."
   - The words "quarantine" in the Finish and move messages now read "QA waiting area".
2. **Materials tab "Missing".**
   - The bug: the tab showed "Missing 270 g" for an ingredient fully weighed in, and "Missing 10 pcs" for wrappers
     ticked as taken. The shortage was needed − set aside − old staging, so it ignored what was weighed in and the
     new Get materials ticks (`batch_material_picks`, which record no amount).
   - The fix: `materialShort` (`src/modules/production/material-short.ts`). It counts what is in the batch once: the
     largest of old staging, weighed in, and ticked as taken or not needed (at the batch line's amount). Anything still
     set aside adds to that.

Tests: `tests/unit/material-short.test.ts`; `tests/integration/production/finish-batch.test.ts` (checker follows the
move step, both ways). No migration.

## ADR-129 One short menu per job, a Search you can see, Homes that start with what needs you, messages that clear themselves (owner 2026-11-08)

Status: Accepted (owner: second usability round for people who are not computer-literate; the new navigation goes
ahead). Supersedes ADR-081's five destinations and ADR-121's "round search button from 1280 px". Extends ADR-101,
ADR-109, ADR-123 and ADR-126. Brief: `docs/ux-audit/round5/` (A floor, B owner and manager, C office).

Decision:
1. **One catalogue, short menus per job** (`src/app/(app)/nav.ts`).
   - Every screen is listed once in `NAV`, in the areas Home, Needs me, Sell, Make, Buy & stock, Money and Set-up.
   - Each job gets its own areas, with at most five tabs plus one flat "More" and no menu inside a menu:

     | Job | Menu |
     |---|---|
     | Owner and site manager | Home · Needs me · Sell · Make · Buy & stock · Money |
     | Sales | Orders, Customers, Price offers, Invoices |
     | Purchasing | Buying, Suppliers |
     | Finance | Money (Home), Money in, Money out, Month end, Reports |
     | QA | Check, Problems, Trace |
     | Floor roles | four bottom doors (My jobs · Scan · Batches/Receive · Help); the site manager's phone has To check/approve as the third door; no tab rows |
   - Set-up is a page behind the avatar menu (`/setup`), and `/management` redirects there.
   - Pages outside a job's menu still open by URL, link and Search. Menu word = screen title. Permissions are unchanged.
2. **Search you can see.**
   - From 768 px a box with the word "Search" sits right after the menu; phones get a labelled pill. Its first line is
     "Scan a label".
   - It finds people by name (scoped to the viewer's sites), plain questions and actions, and short record numbers.
   - Enter opens the exact record number, else the highlighted row, else one exact action, else the only row. It never
     opens the first hit of an unrelated type.
   - `ui.wide_screen_top_bar = scan` still swaps the box for the Scan button.
3. **Homes start with what needs you.**
   - Owner and manager: Sales this month, Customers owe us, We owe suppliers and Needs you.
   - "What to do next" is only the viewer's own job; other people's work is named. The checks waiting for the viewer
     are listed, and activity shows business events only.
   - Floor roles: "My jobs".
4. **Messages clear when the work is done and go to the job's people.**
   - `resolveDoneNotifications` has one rule per message kind. It resolves a message once its record has left the
     state the message asked about.
   - `HandoffRule.only` and `usersForJob` route warehouse work to the warehouse.

Consequences: no migration and no permission change.

Tests:
- unit: `nav-per-role`, `nav-titles`, `menu-paths`, `search-screens`, `search-round5`, `home-round5`
- integration: `tests/integration/platform/messages-clear.test.ts`, `tests/integration/scan/search-round5.test.ts`
- e2e: `tests/e2e/top-bar-fit.cjs` (210 checks)

Open:
- grouping of many messages;
- names instead of codes in message titles;
- a "Delivery problems" list;
- address search;
- the record header's second "?".

## ADR-130 Round 5 floor: a name never signs, one checker list, plain floor screens (2026-11-08)

Status: Accepted (round 5 floor audit A). Supersedes ADR-078 §1; refines ADR-030, ADR-080 §4/§6, ADR-100, ADR-104 §2 and
ADR-106 §4.

1. **A second-person check is signed by the checker's own session, or by their own password on the operator's device.**
   - The password on the operator's device is allowed only while `production.sign_off.same_device` is on (default on,
     restricted).
   - Picking a name alone is refused in `coSign`. An exception approver always types their password.
   - Every check audit records `signedOn` from the context (A-SIGN-03). `production.sign_off.require_password` is
     retired.
   - Audit finding fixed: the operator could tap the checker's name and "Yes, I checked".
2. **One checker list.** Weighing, step and start checks wait on `/production/checks` (`checkerQueue`), one card per
   thing.
   - A batch's weighings share one card (`checkDispenses`, setting `production.weighing.check_together`, default on;
     A-CHK-01, QA to confirm).
   - "Not right" takes a reason the checker picks from a list. The checker returns to the list after each card.
   - The weighing-step check stays as its own card until QA decides.
3. **Weigh** asks in the scale's unit: kg for 1 kg or more (grams are still stored; A-WGH-UNIT-01).
   - The lot is shown once, and each line confirms when saved.
   - With no signal, the weighing is queued on the phone (A-OFF-WGH-01).
4. **Steps** use plain sentences for missing and out-of-range values, never "Saved." on a refusal.
   - An empty required value writes nothing.
   - Correction reasons are picked from a list.
   - The next button says "Done — go to <step>".
5. **Finish is the last step** ("Move to the QA waiting area"). Each packing item gets one Yes / "No, count them"
   question, and the server refuses an empty count.
6. **Packing prints piece and box labels in one trip.** QA samples get no label (A-LBL-SAMPLES-01).
7. **Receiving** may take packaging without an expiry date (`inventory.receiving.packaging_expiry_required`, default
   off; A-RCV-EXP-01).
8. **Get from shelf and send out:**
   - the customer is the title, and each box is listed once;
   - a tap needs a reason picked from a list;
   - the draft delivery receipt comes before sending out;
   - the last driver is prefilled.
9. **Report a problem** is on the batch record, every step and the lot page. Reporters see "Sent to QA".
10. **Placeholders** are never real record numbers.

Consequences: no migration and no seed change.

Tests:
- `tests/integration/production/round5-floor.test.ts`
- `tests/integration/inventory/round5-receiving-expiry.test.ts`
- updated execution-controls, one-path, flow-v2-g2, batch-execution and next-actors tests
- the demo rehearsal

Open:
- a Finish checker on the checker's own phone when same-device signing is off;
- a display unit per scale;
- an intermittent proof-of-delivery submit.

## ADR-131 Round 5 office fixes: sales, purchasing and money a clerk can follow (owner 2026-11-08)

Status: Accepted (round 5 audits C-office and B-owner-manager). Owner decisions are recorded as A-CREDIT-NOLIMIT-01,
A-FIN-1STEP-01 and A-SETASIDE-ORDER-01. Amends A-PO-1APP-01 (ADR-110 C15).

Decision:
1. **One approval per purchase.**
   - A request to buy that names no supplier covers any approved supplier.
   - A top role's own approved request carries over to the purchase order they make.
   - Only an amount above what was approved needs a second OK.
2. **The purchase order wizard asks for what it needs, where it needs it.**
   - The price is a visible field on step 2, prefilled, and checked on Next using the item's name.
   - "Arrives on" is the request's date or the next working day, never today or a Sunday.
3. **The same-person database rule only checks what changes** (fixes "Something went wrong" after a purchase order
   was sent). The deferred trigger `bc_sod_distinct()` now accepts updates that change none of the columns it checks
   (migration 0041, `src/db/sql/adr131.sql`). Sending never reports email trouble as a failure.
4. **A confirmed customer order can be changed line by line** (`changeOrderLine` / `cancelOrderLine`).
   - Each change takes a reason, is audited and lets go of stock no longer needed.
   - The order shows "Can ship from" (`sales.can_ship.qa_days`) and "Where is it now", and has a "Make the missing N
     for this order" button.
   - Setting aside warns when an order due earlier needs the same stock.
   - A customer with no credit limit may order up to `sales.credit.no_limit_check_above` (₱50,000) without approval.
5. **"Sent" means sent.** Price offers and invoices record when and how they reached the customer (email or print).
   Until then the words say "Ready to give the customer". Order confirmations print and email.
6. **One person, one step below the owner's amount.** `finance.invoice.one_step_below` and
   `finance.payment.one_step_below` (₱50,000).
7. **Supplier bills** are typed in the order's unit and price.
   - "Change the bill" works on a draft, or on a bill that does not match.
   - "Fix a mistake" on a bill in the books undoes it and opens a copy, in one transaction.
8. **Shortages and delivery problems reach purchasing.**
   - "What to buy" has an "Ask to buy N" button on each row.
   - Delivery problems (`delivery_problem_decisions`) are decided as: send the rest, money back, or not needed.
9. **Month end lists what is not finished.** The current month closes only with a reason.
10. **Customers:** numbers keep the CUS-nnn shape, and "Already a customer?" shows before saving.
11. **Order value on Home** follows order-price access. KPI-SAL-01V no longer needs `analytics.financial_kpi.view`;
    this is a visibility change.

Consequences:
- Migration 0041 adds:
  - `given_to_customer_at`, `given_via` and `given_by` on `quotes` and `invoices`;
  - the table `delivery_problem_decisions`;
  - a bill-number index that ignores voided bills;
  - the trigger fix.
- Four settings, and no new permission strings.
- New screens: `/procurement/delivery-problems`, `/finance/bills/[id]/change`, `/print/order-confirmation/[id]`.
- Tests: `tests/integration/procurement/r5-purchasing.test.ts`, `tests/integration/sales/r5-order-changes.test.ts`,
  `tests/integration/finance/r5-money.test.ts`, `tests/integration/finance/r5-one-step.test.ts`,
  `tests/unit/arrive-date.test.ts`, `tests/unit/can-ship-from.test.ts`.

Open:
- Owner:
  - the approver for big orders from customers with no credit limit;
  - whether setting aside out of due-date order should warn or refuse;
  - whether Saturday counts as a working day.
- Owner and accountant: the one-step amounts.
- Accountant: tax rates.
- QA: approving a delivery with no test.

## ADR-132 Round 5 leftovers, part A: one "Needs me" number, grouped messages with names, one help door, pages that land at the top (2026-11-13)
Status: Accepted (round 5 audits A, B and C, leftovers of ADR-129/130/131; part A). Extends ADR-125 §5 and ADR-129.
1. **One "Needs me" number.** The menu badge and Home's "Needs you" card read `needsMeSummary`: approvals the person can decide + checks waiting for them + open messages that ask them to act (kinds in `RESOLVABLE_KINDS`, read or not, not taken on). A message about a record already on the approvals list, or about a weighing, step or box check, is not counted again. The owner and the sales desk get no floor checks. The card shows the breakdown.
2. **Many messages, one row.** 3 or more messages of one kind family, screen, Manila day and state make one row ("12 lots are ready to put away") with "Open the list" and "See each one". Each message keeps its buttons and its own clearing.
3. **Message titles lead with names and places** (`src/lib/message-titles.ts`), with short numbers ("lot …0017"). The full number is in the body.
4. **Search.** Customers are found by saved-address words and suppliers by street and city. Operators, checkers and warehouse people see `FLOOR_RECORD_TYPES` only. Permissions and site scoping are unchanged.
5. **One help door per page.** A page's plain "?" hides where the frame's "?" shows (office roles from 640 px).
6. **Pages land at the top.** A new page reached without Back/Forward or an anchor starts at the top; a "just saved" URL also focuses the green banner. A "saved as a draft" banner shows only while the record is a draft.
7. **Every page sets a browser-tab title**, "<page> · Bryel's Care".
8. **Trace and recall lot pickers list newest first**; other lists keep earliest expiry first.
9. **Problem reports speak plain words:** "Small / Big / Very serious" (the levels stay company QA configuration), "This lot is already stopped by QA", and no "deviation" in messages.
10. **Form keys are made after hydration** (`useClientKey`, `useRenewableClientKey`); actions accept a form sent before its key exists.
11. **Label previews hide the layout code and version** (still printed); QA and layout editors see them under More details.
12. **Browser-walk fixes:** the purchase order wizard says when the request's OKs are not enough (`requestCoverHint`); an order-line change closes after saving; print-page back links are 44 px.

Consequences: no migration; no permission change. "Needs me" now runs the checker queue and open action messages on each page load for floor roles.

Open: whether a request's OK should count as step 1 of the order's approval (owner); rounding "Ask to buy" to pack sizes (owner); names-first titles for QA review, CAPA and recall messages; walk "Fix a mistake" and invoice Email/Print on the full demo.

## ADR-133 Round 5 leftovers, part B: flows and documents (2026-11-13)
Status: Accepted (UX leftovers of ADR-124, ADR-126, ADR-130 and ADR-131). QA to confirm A-FIN-CHK-01 and to approve the delivery receipt v2 layout version.
1. **Finish check on the checker's own phone.** When the move-to-QA step needs a checker, Finish offers "Send the counts to be checked" (always; the only way while `production.sign_off.same_device` is off). Sending runs every Finish rule as a rolled-back dry run and stores the form and a summary in `batch_finish_checks` (migration 0042; state machine waiting → confirmed | returned | withdrawn; one waiting check per batch; the decider is never the sender). The checker's "Looks right" on `/production/checks` runs Finish in one transaction with the sender as doer (permissions re-checked) and the checker signing on their own session; it is idempotent (`finish_key`). "Not right" takes a tapped reason and messages the sender. The same-device password route is unchanged.
2. **Proof-of-delivery Save after a refusal works.** The signature or photo is read at tap time and sent without a form action, so React's form reset can no longer drop it.
3. **The "Other ways" weigh form sends `lotVia`.** A typed lot is refused while `scan.typed_code_counts_as_check` is off; a tapped lot is confirmed like the main Weigh.
4. **The no-signal weighing is built by `queuedWeighCommand`** and tested through the phone outbox and the server replay.
5. **The trace export lists the orders a lot waits for** (`direction = waiting`), only at the viewer's sites.
6. **`sales.show_invoice_stage_without_invoice_access` off** also turns "Billed" into "Sent out" on the order chip, list, board, customer history, counts and "What happened", and removes invoice events from Home activity.
7. **The duplicate-customer check runs in the customer import:** possible duplicates are flagged for the person running the import; a twin row in one file is not loaded and the report says why. Every app create path passes `duplicateCheck`.
8. **New production order:** a single "Make it one batch" when the split is one batch.
9. **Recipe wizard copy** keeps the source's counting mode and asks about packaging and steps that name another piece size.
10. **Delivery receipt renderer v2** prints the product name first. v1 stays registered, so issued receipts re-render to their checksum and reprint with v1. A template moves to v2 only through a new version QA approves ("Start a new version with the newer layout"); the demo seed approves it as demo data (`DEMO_SEED_VERSION` 2026-11-13.1).

Consequences: one migration (0042), no new permission strings, no new settings. New assumptions A-FIN-CHK-01, A-LOTVIA-OTHER-01, A-RPT-DR2-01, A-RCP-COPY-01. Risk: QA people hold the step-check permission, so they can confirm production counts (flagged in A-FIN-CHK-01).
