# Bryel's Care ERP + CRM

A multi-site, mobile-first, offline-capable operations platform for Bryel's Care Corporation,
a cosmetics and personal-care manufacturer (soap, lotions and related products). It covers
identity and sites, master data, inventory and scanning, procurement, production with Batch
Manufacturing Records, quality and traceability, packaging and dispatch, sales/CRM, HR and
attendance, operational finance, analytics, and a future customer portal.

**Status: MVP built for client demonstration (Gate 0 approved).** The MVP covers the go-live
flow end to end on fictional data: receive → label → QA release → batch with weighing and the
digital Batch Manufacturing Record → QA batch release → order → FEFO allocation → dispatch and
delivery receipt → traceability, plus the owner overview and audit log. Procurement, HR,
finance, offline mode and the customer portal are planned (shown as "Coming next" in the app).
See `docs/demo-script.md` for the presenter's guide.

## Run the MVP locally

Prerequisites: Node.js 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
cp .env.example .env             # set DATABASE_URL to your Postgres database
pnpm db:migrate                  # apply migrations
pnpm db:seed                     # load the fictional demo data (requires ALLOW_DEMO_SEED=true)
pnpm dev                         # http://localhost:3000
```

Demo accounts (password `demo1234`, all fictional): `owner@`, `admin@`, `manager.nfd@`,
`operator.nfd@`, `checker.nfd@`, `warehouse.nfd@`, `qa.nfd@`, `sales@`, `warehouse.rvs@`,
`auditor@`, `planner.nfd@` (production planner) and `qa.lead@` (second QA approver) at
`bryels-care.test`. Reset the demo data at any time with `pnpm db:reset`.

Production engineering master data (formulas, routings, work instructions, inspection plans,
equipment) needs SQL that Drizzle cannot express (exclusion constraints on effective dates,
draft-only and immutability triggers, batch revision freeze). It ships as the custom migration
`src/db/migrations/0002_w1d_custom_sql.sql`, applied by `pnpm db:migrate` like any other
migration. Its canonical source is `src/db/sql/w1d.sql`; the migration is a verbatim copy and
`tests/integration/masterdata/custom-sql.test.ts` fails if they drift.

| Command | What it does |
|---|---|
| `pnpm dev` | Development server with hot reload |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm typecheck` | TypeScript strict check |
| `pnpm test` | Integration tests against a real Postgres (`TEST_DATABASE_URL`, default `postgres://postgres@localhost:5432/bryels_test`) |
| `pnpm db:generate` | Generate a SQL migration from schema changes (review before committing) |
| `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:reset` | Apply migrations / load demo data / wipe and reload demo data |

Environment variables: `DATABASE_URL` (required), `DATABASE_MIGRATION_URL` (optional separate
migration role), `APP_ORIGIN` (public URL, used for origin checks), `ALLOW_DEMO_SEED` (`true`
only on demo and staging environments; never in production).

File attachments (supplier CoA, delivery photos; `docs/security.md` §4.6, §4.8):

| Variable | Use |
|---|---|
| `FILE_STORAGE` | `local` (development: files under `FILE_STORAGE_DIR`, default `./.data/files`, excluded from version control, never served statically) or `s3` (staging/production: private S3-compatible bucket, e.g. the Railway Bucket). Unset = uploads show "File storage isn't set up" and nothing is stored |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | Bucket settings when `FILE_STORAGE=s3` (Railway: `${{Bucket.ENDPOINT}}` etc., path style `false`; MinIO: `true`) |
| `FILE_URL_SECRET` | 32+ random characters; signs the 5-minute, user-bound download links. Required in production (a per-process secret is used in development) |

Custom SQL: after migrating a database that already holds MVP receipts (not a fresh one), run
`src/db/sql/w1b.sql` once to mark those receipts as posted. The nightly expiry check is the job
`inventory.expiry_check` (`src/modules/inventory/jobs/expiry-check.ts`), wired by the job registry.

## Deploy to Railway (demo or staging)

1. Create a Railway project, add a **PostgreSQL** service, and add a service from this GitHub
   repository. Railway builds the `Dockerfile` (see `railway.json`).
2. On the app service set variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}`,
   `APP_ORIGIN=https://<your-app>.up.railway.app`, and for a demo `ALLOW_DEMO_SEED=true`.
3. Deploy. On start the container applies migrations, loads the demo data if allowed and empty,
   and serves on `$PORT`; Railway checks `/api/health`. `/api/ready` reports database status.
4. Generate a public domain in the service's Networking settings and sign in with a demo account.

The full production topology (worker, bucket, backups, staging/production separation) is in
`docs/deployment-railway.md` and arrives with later phases.

## Code map

| Path | Contents |
|---|---|
| `src/app/(app)/` | Authenticated pages per module (thin server components and server actions) |
| `src/app/print/` | Print layouts: lot labels, Batch Manufacturing Record, delivery receipt |
| `src/modules/<module>/` | Domain services: permission and site checks, transactions, audit |
| `src/modules/inventory/ledger.ts` | The stock ledger: every stock change goes through `postMovement` |
| `src/db/schema/`, `src/db/migrations/` | Drizzle schema (MVP subset of `docs/data-model.md`) and SQL migrations |
| `src/db/seed.ts` | Fictional demo data shaped after the Acapulco Soap BMR |
| `src/lib/` | Auth (argon2id sessions, `AuthContext`), audit, numbering, decimal helpers |
| `src/ui/` | Design-system components from `docs/ux-system.md`; `brand.tsx` holds the logo (ADR-024) |
| `tests/integration/` | Integration tests on a real Postgres per module |

## Source of truth

- `docs/source/master-brief.md`: the master engineering brief (converted from the owner's
  document). Read it first.
- `docs/source/bmr-acapulco-soap.jpeg`: the current paper Batch Manufacturing Record used as
  the reference for configurable BMR templates.
- `docs/source/ui-inspiration.md`: notes on the Dribbble dashboard reference and how it is
  adapted.

## Phase 0 deliverables

| Document | Purpose |
|---|---|
| `docs/gate-0-report.md` | The Phase 0 report for the owner: the eight items the brief requires and the decisions requested at Gate 0 |
| `docs/PRD.md` | Vision, actors, domains, MVP, phased roadmap, facts vs assumptions, discovery questions, glossary |
| `docs/process-maps.md` | As-is and to-be workflows for the eight core flows, exception paths, approval gates |
| `docs/architecture.md` | Component map, module boundaries, API conventions, security boundaries, jobs, offline |
| `docs/decision-log.md` | Architecture decision records with alternatives and status |
| `docs/data-model.md` | ERD, entities, keys, indexes, constraints, ledger invariants, migration strategy |
| `docs/permissions-matrix.md` | Role × action × site-scope matrix and sensitive-field rules |
| `docs/security.md` | Threat model, session policy, application controls, audit catalogue, retention |
| `docs/ux-system.md` | Navigation, responsive behaviour, design tokens, component rules, states, accessibility |
| `docs/design/style-tile.html` | Static visual direction: tokens, shell, owner dashboard, operator scan screen |
| `docs/offline-sync.md` | Cached data, command queue, idempotency, conflicts, retry policy |
| `docs/reports-and-templates.md` | Document templates (BMR, labels, DR, pick list), print specs, revision rules |
| `docs/testing.md` | Test strategy, invariants, device matrix, acceptance procedures |
| `docs/demo-script.md` | Presenter's guide for the 15 to 20 minute client demo, with screenshots in `docs/demo/` |
| `docs/deployment-railway.md` | Services, Postgres, storage, secrets, migrations, backups, rollback |
| `docs/operations-runbook.md` | Routine admin, failed jobs/imports, sync conflicts, incidents, restore |
| `docs/risk-register.md` | Risks, likelihood, impact, owner, mitigation, trigger |
| `docs/data-migration-plan.md` | What history is migrated, identifier rules, reconciliation, sign-off |
| `docs/backlog.md` | Phased epics and user stories with acceptance criteria; Slice 1 definition |
| `docs/analytics-kpis.md` | KPI definitions, formulas, time basis, sources, drill-down |
| `docs/modules/hr-attendance-payroll.md` | HR scope, attendance import design, rule configuration, open questions |
| `docs/modules/finance.md` | Finance scope decision, costing model, accounting export |
| `docs/team-charter.md` | The delivery team, responsibilities, RACI, gates and working agreements |

## Architecture map

- One Next.js (App Router) codebase deployed as one Docker image that runs two Railway
  services: `web` (pages, server actions, `/api/v1`) and `worker` (pg-boss jobs: PDFs, labels,
  imports, scheduled reports, reconciliation).
- PostgreSQL 16 is the only transactional store (ledgers, sessions, audit, job queue); files
  live in a private S3-compatible bucket.
- Twelve modules under `src/modules/` (identity, masterdata, inventory, procurement,
  production, quality, documents, sales, hr, finance, analytics, platform), each exposing one
  public `index.ts`; authorization is enforced in the service layer through `AuthContext` and
  scoped repositories.
- Versioned JSON API at `/api/v1` with idempotent commands, designed for offline replay.
- Details: `docs/architecture.md` section 3 (component map) and section 4 (code layout and
  module boundaries); decisions in `docs/decision-log.md`.

## The team

Delivery is run as a multidisciplinary team of specialised Claude agents defined in
`.claude/agents/`. Each persona owns documents and code areas listed in
`docs/team-charter.md`. Invoke a persona with the Agent tool (`subagent_type: <name>`).

## Roadmap

Phases follow the brief: 0 Discovery → 1 Foundation → 2 Inventory MVP → 3 Production + BMR →
4 Packaging, fulfilment, CRM → 5 Reporting + imports → 6 Procurement + HR/finance →
7 Offline/PWA hardening → 8 Customer portal + payments → 9 Production readiness.
Exit criteria per phase are in `docs/PRD.md`.
