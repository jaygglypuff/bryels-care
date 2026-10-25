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

**Put the demo online:** `docs/railway-for-dummies.md` is a click-by-click guide for the Railway
web dashboard (no terminal): GitHub repository, branch, database, three variables, done. The
deployed demo has a "Try the demo" switch with one-click sign-in per role and updates itself on
every push.

## Run the MVP locally

Prerequisites: Node.js 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
cp .env.example .env             # set DATABASE_URL to your Postgres database
pnpm db:migrate                  # apply migrations
pnpm db:seed                     # load the fictional demo data (requires DEMO_MODE=true or ALLOW_DEMO_SEED=true)
pnpm dev                         # http://localhost:3000
```

Demo accounts (password `demo1234`, all fictional): `owner@`, `admin@`, `manager.nfd@`,
`operator.nfd@`, `checker.nfd@`, `warehouse.nfd@`, `qa.nfd@`, `sales@`, `warehouse.rvs@`,
`auditor@`, `planner.nfd@` (production planner), `qa.lead@` (second QA approver), `finance@`
(finance: credit, price list and order approvals) and `sales2@` (second sales user) at
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
| `pnpm worker` | Background worker (pg-boss): reconciliation, expiry check, reservation expiry, balance rebuilds, document renders; health on `PORT` (default 3001) |
| `pnpm db:reference` | Installs the reference master data (units g/kg/mg/mL/L/pcs, SI conversions, default reason codes) for every organization that lacks them; idempotent, never overwrites company edits. Runs automatically after the migrations in `scripts/start.sh` (every deploy) and in `pnpm admin:bootstrap`; the demo seed installs it too (ADR-040) |
| `pnpm admin:bootstrap` | Production first administrator: invited owner + system admin and a one-time link (no demo seed, refuses once anyone is active; `--sync-roles` re-syncs seeded role templates). See "First administrator" below |
| `pnpm migrate:load …` / `pnpm migrate:approve <IMP> --as <email>` | Go-live loader (US-2-25): `--kind <kind> --file <path> --site <code> --as <email>` validates a file (dry run, results CSV next to the file) and submits it; a second person approves; `--post --job <IMP> --as <email>` posts. Asks for the password interactively. Production needs `MIGRATION_WINDOW_OPEN=true`; `--post` also needs the read-only maintenance mode on. Same engine as Admin → Imports (`docs/data-migration-plan.md` §9.4, §9.5) |
| `pnpm api:contract` | Regenerate `docs/api/v1-contract.json` from `src/lib/api/contract.ts` (a test fails when it is stale) |
| `pnpm backup:dump [--manual] [--label …] [--hold]` | Logical backup (US-9-03): counts and `pg_dump` in one snapshot, `age` encryption, upload and offsite copy, `backup_runs` row, prune 35 daily + 12 monthly. The Railway `backup` cron service runs it via `APP_ROLE=backup` (runbook §13.8) |
| `pnpm restore:drill --performed-by <email> --identity <key>` | Restore drill into a scratch database with checks; records `restore_drills` (runbook §13.6) |
| `pnpm load:seed` / `pnpm load:postings` / `pnpm load:run` | Load test at A-PRD-12 volumes on a scratch database (`docs/load-test-report.md`, `docs/testing.md` §11.3) |

Environment variables (the full per-service table is `docs/deployment-railway.md` §4):

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | web, worker | Required. Runtime database role |
| `DATABASE_MIGRATION_URL` | web (pre-deploy) | Optional separate migration role; falls back to `DATABASE_URL` |
| `APP_ORIGIN` | web, worker | Public URL, used for Origin checks on mutating requests and links in emails. On Railway it defaults to `https://$RAILWAY_PUBLIC_DOMAIN` when unset (web); the worker needs `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` |
| `DEMO_MODE` | web, worker | `true` = fictional demo (ADR-055): demo data loads itself into an empty database at start, "Try the demo" one-click sign-in, demo banner, owner-only Reset demo data. Never in production (`APP_ENV=production` forces it off). `ALLOW_DEMO_SEED=true` is read as the older name. Seed and resets refuse while any non-`@bryels-care.test` account exists |
| `APP_ROLE` | web, worker | `web` (default) or `worker`: what `scripts/start.sh` runs; unset = `worker` when the Railway service name contains "worker" |
| `FILE_STORAGE` | web | `local` (development: files under `FILE_STORAGE_DIR`, default `./.data/files`, excluded from version control, never served statically) or `s3` (staging/production: private S3-compatible bucket, e.g. the Railway Bucket). Unset = uploads (supplier CoA, delivery photos) show "File storage isn't set up" and nothing is stored (ADR-027) |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | web | Bucket settings when `FILE_STORAGE=s3` (Railway: `${{Bucket.ENDPOINT}}` etc., path style `false`; MinIO: `true`) |
| `FILE_URL_SECRET` | web | 32+ random characters; signs the 5-minute, user-bound download links (`docs/security.md` §4.8). Required in production; development uses a per-process secret; demo mode derives a stable demo-only value from `DATABASE_URL` when unset |
| `PDF_RENDERER` | web, worker | Optional, default `disabled`: documents and labels print through the browser print dialog from their recorded dataset; "Download PDF" shows a "setup required" state until a PDF engine ships (ADR-026, `src/modules/documents/config.ts`). `chromium` is reserved for that engine |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY` | web, worker | Email adapter for invitations, password resets and security notices (`src/lib/email`): unset/`none` = nothing is sent and admins see one-time links once to pass on by hand; `outbox` = development only (message stored in `email_outbox` and printed to the console); `resend` = HTTPS API (Railway blocks outbound SMTP below the Pro plan) |
| `DATA_ENCRYPTION_KEY` | web, worker | `k1:<openssl rand -base64 32>`; encrypts TOTP secrets. Required in production for two-step sign-in; development uses a fixed development key |
| `TRUSTED_PROXY_HEADER` | web | Defaults to `x-real-ip` on Railway (Railway's documented client-IP header): the client IP for the per-IP limits of the shared rate-limit store (ADR-038). Unset (development only): sign-in attempts of all clients share one bucket and the reset/invitation IP limits are off (per-account and per-user limits still apply) |
| `WORKER_CONCURRENCY` | worker | Parallel deliveries per job queue, default `2` |
| `PORT` | web, worker | Set by Railway; the worker serves `/api/health` and `/api/ready` on it (default 3001 locally) |
| `LOG_LEVEL`, `LOG_FORMAT` | web, worker | Structured logs (`src/lib/log`, US-1-25): level `debug`/`info`/`warn`/`error` (default `info`; `warn` under tests), format `json` (default) or `pretty` for local reading |
| `RELEASE` | web, worker | Release tag on every log line and error report (staging/production: `${{RAILWAY_GIT_COMMIT_SHA}}`); default `dev` |
| `ERROR_REPORTING_DSN` | web, worker | Error-reporting adapter (`src/lib/log/error-reporter.ts`): unset = disabled (logged once, never a failure); `console` = structured `error_report` log line; a Sentry-compatible DSN = events posted to the provider without cookies, headers, bodies or query strings |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_ROLES`, `BOOTSTRAP_ORG_NAME`, `BOOTSTRAP_SITE_CODE`, `BOOTSTRAP_SITE_NAME` | one-off shell | Read only by `pnpm admin:bootstrap` (first administrator, organization, first site and its reference data); set for the one run, then remove. See "First administrator" below |
| `MIGRATION_WINDOW_OPEN` | web, worker, one-off shell | `true` only during the cutover window: lets the migration loader run against production (`APP_ENV=production`) and lets opening-stock imports post there; also required by `migrate:load --post` everywhere. Remove when check MC-16 passes (`docs/operations-runbook.md` §17a.2) |
| `DATABASE_POOL_MAX` | web, worker | Connection pool size per process (default 10; `DB_POOL_MAX` is accepted as an older alias) |
| `BACKUP_STATUS_SOURCE` | web, worker | `table` = the diagnostics Backups card and the backup-age alert read `backup_runs` (written by `pnpm backup:record` from the backup service). Unset = the card says "not configured" |
| `APP_ROLE=backup`, `WITH_BACKUP_TOOLS`, `PG_CLIENT_MAJOR` | backup | Role and build arguments of the backup cron service (`WITH_BACKUP_TOOLS=1` installs pg_dump of `PG_CLIENT_MAJOR`, default 18, and `age`) |
| `BACKUP_ENCRYPTION_PUBLIC_KEY`, `BACKUP_PREFIX`, `DATABASE_BACKUP_URL` | backup | `age` recipient (required outside development), object prefix (default `backups/<APP_ENV>`), optional read-only dump role |
| `BACKUP_S3_*`, `BACKUP_OFFSITE_S3_*` (`ENDPOINT`, `BUCKET`, `REGION`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `FORCE_PATH_STYLE`) | backup, drill | Primary bucket (falls back to the app `S3_*`) and offsite bucket; `BACKUP_LOCAL_DIR` / `BACKUP_OFFSITE_LOCAL_DIR` for development drills |
| `DRILL_ADMIN_URL`, `BACKUP_AGE_IDENTITY_FILE` | drill (laptop) | Server where the scratch database is created (staging in production drills); path of the offline private key |
| `WORKER_HEARTBEAT_STALE_SECONDS` | web | `/api/health/worker` answers 503 after this many seconds without a heartbeat (default 300) |

Custom SQL: after migrating a database that already holds MVP receipts (not a fresh one), run
`src/db/sql/w1b.sql` once to mark those receipts as posted.

Background jobs (`docs/architecture.md` §8, ADR-025) run in the worker: `inventory.reconcile`
(01:00 Asia/Manila), `inventory.expiry_check` (00:15 Asia/Manila: expiry, retest holds and
`expiring_lot` alerts), `inventory.reservation_expiry` (every 15 min), and on demand
`inventory.rebuild_balances` and `documents.render`, plus `identity.session_purge` (02:30
Asia/Manila: deletes sessions 30 days after expiry, closes assignments past their end date).
Scheduled jobs act as the organization's system actor (ADR-029).

Accounts (Wave 2 W2E): administrators invite people from Admin → Users (one-time link, the person
sets their own password), lock, deactivate and reactivate accounts, grant roles per site with
start/end dates and optional warehouse limits, clone roles into custom roles, and sign devices out.
Everyone manages their password, devices and two-step sign-in (TOTP) on **My account**. Restricted
changes ask for the password again (10 minutes) and, once enrolled, a code.
`inventory.rebuild_balances` and `documents.render`. Scheduled jobs act as the organization's
system actor (ADR-029).
Wave 2 W2F adds `platform.metrics_sample` and `platform.alerts_evaluate` (every 5 min: metrics into
`metrics_samples`, in-app alerts to system administrators for a silent worker, dead-lettered jobs and
backup age, thresholds in the `alerts.*` settings).

Governance (Wave 2 W2F): `/admin/settings` (settings registry, change requests approved by a second
person), `/admin/approval-rules` (owner), `/admin/numbering` (versioned numbering patterns),
`/admin/diagnostics` (Health, Backups, Variables cards) and `/help` (quick guides from `docs/help/*.md`).
Read-only maintenance mode for a cutover window: setting `platform.maintenance.read_only`
(`docs/operations-runbook.md` §17a.2). Demo login for the second administrator:
`admin2@bryels-care.test` / `demo1234`.

## Deploy to Railway (demo or staging)

Owner's click-by-click guide: `docs/railway-for-dummies.md`. In short:

1. Railway project from this GitHub repository (Dockerfile builder; the image's `CMD` is
   `scripts/start.sh`), service named `web`, branch as agreed; add **PostgreSQL**.
2. `web` variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `DEMO_MODE=true`, `PORT=3000`;
   healthcheck path `/api/health`; Generate Domain (port 3000). `APP_ORIGIN`, the client-IP header
   and (demo only) `FILE_URL_SECRET`/`DATA_ENCRYPTION_KEY` are derived; the deploy log's `[setup]`
   lines say what was derived and what is missing.
3. On start `web` runs the self-check, migrations (advisory-locked), reference data, the demo data
   when the database is empty, then Next.js on `$PORT`. Restarts and redeploys never reseed or wipe.
4. Second service from the same repository named `worker`: `APP_ROLE=worker`, the same
   `DATABASE_URL` and `DEMO_MODE`, `APP_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}`, no domain.
5. Uploads: a Railway **Bucket** named `Bucket` and `S3_ENDPOINT=${{Bucket.ENDPOINT}}`,
   `S3_BUCKET=${{Bucket.BUCKET}}`, `S3_REGION=${{Bucket.REGION}}`,
   `S3_ACCESS_KEY_ID=${{Bucket.ACCESS_KEY_ID}}`, `S3_SECRET_ACCESS_KEY=${{Bucket.SECRET_ACCESS_KEY}}`
   on both services (a complete set switches `FILE_STORAGE=s3` on).

Container rehearsal without Docker: `tests/e2e/demo-mode.cjs` (header comment) checks the running
build: one-click sign-in for two roles, banner, reset, and no demo UI with demo mode off.

**First administrator (production, no demo data):** without a terminal, set the `BOOTSTRAP_*`
variables on `web` and deploy; the one-time link appears in the deploy log (remove the variables
afterwards). With a terminal, open the `web` service shell (`railway ssh`) and run `BOOTSTRAP_ADMIN_EMAIL=you@<domain> BOOTSTRAP_ADMIN_NAME="Your Name"
BOOTSTRAP_ORG_NAME="Bryel's Care Corporation" BOOTSTRAP_SITE_CODE=NFD BOOTSTRAP_SITE_NAME="<site>"
pnpm admin:bootstrap`. It prints a single-use link (72 h) to set your password; it never sets
or prints a password and refuses once any account is active (`docs/deployment-railway.md` §14a).

The full production topology (bucket, backups, staging/production separation) is in
`docs/deployment-railway.md` and arrives with later phases.

## Code map

| Path | Contents |
|---|---|
| `src/app/(app)/` | Authenticated pages per module (thin server components and server actions) |
| `src/app/print/` | Print layouts: label jobs (`print/labels`), generated documents (`print/documents`), Batch Manufacturing Record, delivery receipt |
| `src/modules/documents/` | Template versions, code renderers (`renderers/`), generated documents, label templates, label jobs, print stations, reprint control; job handler `jobs/render.ts` (`documents.render`) |
| `src/modules/scan/`, `src/lib/scan/` | Scan payload grammar (ADR-017, shared by server and client) and the scan result card service |
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
| `docs/railway-for-dummies.md` | Owner's step-by-step guide: put the demo on Railway from the web dashboard, updates, reset, troubleshooting, going live |
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
