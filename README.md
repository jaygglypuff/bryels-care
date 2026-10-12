# Bryel's Care ERP + CRM

A multi-site, mobile-first, offline-capable operations platform for Bryel's Care Corporation,
a cosmetics and personal-care manufacturer (soap, lotions and related products). It covers
identity and sites, master data, inventory and scanning, procurement, production with Batch
Manufacturing Records, quality and traceability, packaging and dispatch, sales/CRM, HR and
attendance, operational finance, analytics, and a future customer portal.

**Status: Phase 0 (discovery and architecture) delivered, awaiting Gate 0 approval.**
No product code exists yet by design; the brief requires architecture, data model and
permission design to be reviewed before sensitive modules are implemented.

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
| `docs/PRD.md` | Vision, actors, domains, MVP, phased roadmap, facts vs assumptions, discovery questions, glossary |
| `docs/process-maps.md` | As-is and to-be workflows for the eight core flows, exception paths, approval gates |
| `docs/architecture.md` | Component map, module boundaries, API conventions, security boundaries, jobs, offline |
| `docs/decision-log.md` | Architecture decision records with alternatives and status |
| `docs/data-model.md` | ERD, entities, keys, indexes, constraints, ledger invariants, migration strategy |
| `docs/permissions-matrix.md` | Role × action × site-scope matrix and sensitive-field rules |
| `docs/ux-system.md` | Navigation, responsive behaviour, design tokens, component rules, states, accessibility |
| `docs/design/style-tile.html` | Static visual direction: tokens, shell, owner dashboard, operator scan screen |
| `docs/offline-sync.md` | Cached data, command queue, idempotency, conflicts, retry policy |
| `docs/reports-and-templates.md` | Document templates (BMR, labels, DR, pick list), print specs, revision rules |
| `docs/testing.md` | Test strategy, invariants, device matrix, acceptance procedures |
| `docs/deployment-railway.md` | Services, Postgres, storage, secrets, migrations, backups, rollback |
| `docs/operations-runbook.md` | Routine admin, failed jobs/imports, sync conflicts, incidents, restore |
| `docs/risk-register.md` | Risks, likelihood, impact, owner, mitigation, trigger |
| `docs/data-migration-plan.md` | What history is migrated, identifier rules, reconciliation, sign-off |
| `docs/backlog.md` | Phased epics and user stories with acceptance criteria; Slice 1 definition |
| `docs/analytics-kpis.md` | KPI definitions, formulas, time basis, sources, drill-down |
| `docs/modules/hr-attendance-payroll.md` | HR scope, attendance import design, rule configuration, open questions |
| `docs/modules/finance.md` | Finance scope decision, costing model, accounting export |
| `docs/team-charter.md` | The delivery team, responsibilities, RACI, gates and working agreements |

## The team

Delivery is run as a multidisciplinary team of specialised Claude agents defined in
`.claude/agents/`. Each persona owns documents and code areas listed in
`docs/team-charter.md`. Invoke a persona with the Agent tool (`subagent_type: <name>`).

## Roadmap

Phases follow the brief: 0 Discovery → 1 Foundation → 2 Inventory MVP → 3 Production + BMR →
4 Packaging, fulfilment, CRM → 5 Reporting + imports → 6 Procurement + HR/finance →
7 Offline/PWA hardening → 8 Customer portal + payments → 9 Production readiness.
Exit criteria per phase are in `docs/PRD.md`.

## Local setup, commands, environment variables, deployment

Added in Phase 1 (Foundation) together with the first code. See `docs/backlog.md` for the
Slice 1 definition and `docs/deployment-railway.md` for the planned topology.
