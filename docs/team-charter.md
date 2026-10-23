# Team charter

Bryel's Care ERP/CRM is delivered by a multidisciplinary team of specialised Claude personas,
coordinated by the principal architect and reviewed by the company's owners and qualified
reviewers at defined gates. Persona definitions live in `.claude/agents/` and are invoked
with the Agent tool (`subagent_type: <name>`).

## Roster

| Persona (`.claude/agents/<name>.md`) | Discipline | Primary ownership |
|---|---|---|
| `principal-architect` | Architecture, delivery lead | architecture, decision log, offline strategy, backlog structure, gate reports, consistency reviews |
| `product-manager` | Product management / business analysis | PRD, stories and acceptance criteria, discovery questions, glossary, risk register, migration plan |
| `manufacturing-process-engineer` | Manufacturing (soap, lotions, cosmetics) | routings, formulas, dispensing rules, line clearance, yield, batch state machine, BMR template |
| `quality-regulatory-specialist` | QA / regulatory | dispositions, inspections, deviations/CAPA, complaints, recall, genealogy, e-record caution |
| `warehouse-procurement-specialist` | Warehouse, inventory, buying | receiving, lots/boxes, locations, FIFO/FEFO, scanning, counts, labels, suppliers, POs |
| `database-architect` | Data | ERD, schema, ledgers, migrations, concurrency |
| `backend-engineer` | Engineering (server) | domain services, API, transactions, idempotency, audit, integration tests |
| `frontend-engineer` | Engineering (client) | pages, components, PWA, scanning UI, print, e2e tests |
| `ux-ui-designer` | Design | design system, tokens, navigation, operator mode, mockups |
| `qa-test-engineer` | Quality engineering | test strategy, acceptance tests, device matrix, CI gates |
| `security-engineer` | Security | permissions matrix, threat model, auth hardening, security review |
| `devops-engineer` | DevOps / reliability | Railway, CI, migrations at deploy, backups, monitoring, runbook |
| `analytics-specialist` | Analytics | KPI catalogue, dashboards, scheduled reports, forecasting governance |
| `hr-payroll-specialist` | HR / payroll | employee data, shifts, attendance import, rule catalogue, payroll phasing |
| `finance-specialist` | Finance / accounting | finance scope, AR/AP, costing, period locks, accountant export |

Humans in the loop (Bryel's Care): Owner/Director (gate approvals), production and QA
process owners (formula, routing and BMR validation), accountant and payroll reviewer
(finance and payroll rules), HR (attendance policy), IT/operations contact (devices,
printers, connectivity, time-clock exports).

## RACI by deliverable

R = responsible (does the work), A = accountable (signs off inside the team), C = consulted,
I = informed. Owner approval is required at gates regardless of RACI.

| Deliverable | R | A | C |
|---|---|---|---|
| PRD, backlog, glossary | product-manager | principal-architect | all specialists |
| Process maps | manufacturing-process-engineer, warehouse-procurement-specialist, quality-regulatory-specialist, hr-payroll-specialist | product-manager | ux-ui-designer |
| Architecture, decision log, offline strategy | principal-architect | principal-architect | backend, frontend, devops, security |
| Data model | database-architect | principal-architect | manufacturing, quality, warehouse, finance, hr |
| Permissions matrix, security doc | security-engineer | principal-architect | product-manager, finance, hr |
| UX system, mockups | ux-ui-designer | principal-architect | frontend-engineer, warehouse-procurement-specialist |
| Reports and templates | manufacturing-process-engineer, warehouse-procurement-specialist | quality-regulatory-specialist | ux-ui-designer |
| Testing strategy | qa-test-engineer | principal-architect | security-engineer |
| Deployment and runbook | devops-engineer | principal-architect | security-engineer |
| KPI catalogue | analytics-specialist | product-manager | finance, manufacturing, warehouse |
| HR module doc | hr-payroll-specialist | product-manager | security, finance |
| Finance module doc | finance-specialist | product-manager | analytics, security |
| Code slices (Phase 1+) | backend-engineer, frontend-engineer | principal-architect | database-architect, qa-test-engineer, security-engineer |

## Gates

| Gate | After phase | Owner reviews | Team evidence |
|---|---|---|---|
| G0 | 0 Discovery and architecture | this document set, stack and architecture (ADR-001 to 014, 019 to 021, 023), ERD, permission model, MVP and roadmap, Slice 1 definition | consistency review complete |
| G1 | 1 Foundation | staging deployment, sign-in, site switching, role/permission admin, audit log, operational shell on phone and desktop | permission tests pass in CI; deploy from docs works |
| G2 | 2 Inventory MVP | receive → label → move → count on a phone with the company's hardware | concurrency and cross-site tests pass; FEFO verified |
| G3 | 3 Production + BMR | a representative soap batch run in staging with a printed BMR reviewed by production and QA | batch snapshot and traceability tests pass |
| G4 | 4 Packaging, fulfilment, CRM | order → pick → pack → ship with every box traceable | shipment posting reconciles stock |
| G5 | 5 Reporting + imports | owner KPIs reconcile; attendance file imports | reconciliation queries documented |
| G6 | 6 Procurement + HR/finance | qualified reviewers validate calculations and approvals | sensitive-access tests pass |
| G7 | 7 Offline/PWA | offline acceptance on the company's phones/tablets | conflict queue demonstrated |
| G8 | 8 Portal + payments | security review, sandbox payment tests | idempotency and refund tests pass |
| G9 | 9 Production readiness | go-live checklist signed | backup/restore and migration rehearsal recorded |

## Working agreements

1. The brief (`docs/source/master-brief.md`) and Accepted ADRs are binding; disagreements
   become a new ADR, not a silent deviation.
2. Vertical slices, test-driven, end-to-end. A slice is done when data model, permissions,
   validation, states, audit, tests, docs and deployment notes exist and CI is green.
3. Facts and assumptions are kept separate; assumptions are configurable and flagged in
   `docs/PRD.md` for owner approval.
4. No persona invents legal, tax, payroll, regulatory or quality rules. They are
   configuration validated by qualified humans.
5. Every phase ends with the report the brief requires: completed, tested, not completed,
   known risks, commands run, migrations, environment variables, exact next steps.
6. The principal architect reviews cross-module work; the security engineer reviews anything
   touching auth, scope, uploads, exports or webhooks; the QA engineer owns the definition of
   "tested".
7. Shared vocabulary comes from `docs/PRD.md` (glossary), `docs/permissions-matrix.md`
   (roles, permission strings) and `docs/data-model.md` (entities, states).
