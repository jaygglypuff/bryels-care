# Risk register

Owner: product-manager (business sections). Co-owners: principal-architect (delivery and
platform rows), security-engineer (security rows), devops-engineer (platform and cost rows).
Status: Phase 0 draft for Gate 0. Re-scored at every gate (`docs/team-charter.md`).
Related: `docs/PRD.md` (assumptions A-PRD-nn, questions Q-A/B/C-nn), `docs/process-maps.md` §7,
`docs/architecture.md` §15, `docs/security.md`, `docs/offline-sync.md` §10,
`docs/data-migration-plan.md`, `docs/decision-log.md`.

Plain-language summary for owners: this is the list of things that could make the project
late, wrong, unsafe or unused, with a score for each, the person who watches it, the thing we
do about it and the early sign that tells us it is happening. The ten highest scores are in
section 2. Every risk in the brief's own risk table is here (section 4 shows the mapping).

## 1. How to read this register

### 1.1 Columns

| Column | Meaning |
|---|---|
| ID | `R-nn`, never reused; closed risks stay in the table with status Closed |
| Category | delivery, data integrity, security, adoption, regulatory/validation, platform, people, cost |
| L (likelihood) | 1 rare, 2 unlikely, 3 possible, 4 likely, 5 almost certain, judged assuming the listed mitigation is delivered as planned |
| I (impact) | 1 negligible, 2 minor, 3 moderate (a phase slips or a site works around it), 4 major (wrong stock, money or records; go-live at risk), 5 severe (unsafe product decision, legal exposure, data loss, project stops) |
| Score | L × I (1 to 25) |
| Team owner | persona from `docs/team-charter.md` that keeps the mitigation on track |
| Business owner | the person on the Bryel's Care side who decides or supplies what the mitigation needs (role labels until names are given, Q-RISK-01) |
| Mitigation | what we do, and the document section where it is specified |
| Early-warning trigger | a measurable sign that the risk is materialising; the owner raises it at the next review when seen |
| Status | Open (mitigation not started), Mitigating (in progress), Monitoring (mitigation delivered, watching the trigger), Accepted (owner accepts the residual risk, recorded in section 6), Closed |
| Review | how often the row is re-scored |

### 1.2 Score bands (A-RISK-01)

| Band | Score | Handling |
|---|---|---|
| Critical | 15 to 25 | Named in every gate report; owner acknowledges the mitigation and residual score at each gate |
| Managed | 8 to 14 | Team owner reports at each gate; mitigation tracked in `docs/backlog.md` |
| Watch | 1 to 7 | Reviewed monthly; promoted when the trigger fires |

## 2. Top 10 by score

| Rank | ID | Risk | Score | Why it is at the top now |
|---|---|---|---|---|
| 1 | R-12 | Data migration quality (opening balances, missing expiry, duplicates, unlabelled stock) | 16 | No internal lots, labels or locations exist today (A-PROC-02); the physical count becomes the ledger's first truth |
| 2 | R-40 | Connectivity gaps in production and warehouse areas while the MVP is online-first | 16 | Offline arrives in Phase 7; floor connectivity is unknown (Q-A-02) |
| 3 | R-39 | Hardware incompatibility: scanners, printers, scales, phones | 16 | Hardware is unknown (Q-A-03); G2 acceptance runs on the company's devices |
| 4 | R-27 | Operator adoption on shared devices (sign-in, MFA, idle lock friction leading to shared accounts) | 16 | Shared floor devices assumed (A-PRD-08); traceability depends on the right person being signed in |
| 5 | R-04 | Formula, tolerance and routing data not supplied; Phase 3 runs on fictional values | 16 | Tolerances are not documented today (A-PROC-03); the team must never invent them |
| 6 | R-02 | Scope creep after G0 | 16 | The brief lists fifteen modules; the MVP is three flows |
| 7 | R-03 | Decision-gate delays | 16 | Ten blocking questions and 21 ADRs wait on the owner at G0 |
| 8 | R-11 | Incorrect stock from concurrent scans, retries or offline replay | 15 | Severe impact; mitigations are designed but not yet built or tested |
| 9 | R-26 | Poor adoption by operators | 15 | Operator-first is the product's first principle; failure here makes every other control fictional |
| 10 | R-31 | Regulatory validation not performed before reliance | 15 | The system is not a substitute for qualified QA, regulatory or accounting review (F-19) |

## 3. Register

### 3.1 Delivery

| ID | Risk | Category | L | I | Score | Team owner | Business owner | Mitigation (where) | Early-warning trigger | Status | Review |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R-01 | Trying to build all modules at once; nothing reaches go-live | delivery | 2 | 5 | 10 | principal-architect | Owner/Director | MVP boundary `docs/PRD.md` §5.1; phases and gates `docs/team-charter.md`; vertical slices (CLAUDE.md, ADR-001) | A slice spans more than two modules without an ADR; a phase starts before its gate is approved | Mitigating | Each gate |
| R-02 | Scope creep after G0 (general ledger, payroll calculation, portal, pipeline or integrations pulled into the MVP) | delivery | 4 | 4 | 16 | product-manager | Owner/Director | Out-of-scope list `docs/PRD.md` §5.3 and §5.4; change requests enter `docs/backlog.md` and are re-phased at the next gate; configurability over custom work (PRD §2.2) | More than 10 % new stories added inside a running phase; any request to compute pay or post journals before G6 | Mitigating | Each gate |
| R-03 | Decision-gate delays: owner or reviewers unavailable to approve gates and answer blocking questions | delivery | 4 | 4 | 16 | principal-architect | Owner/Director | Defaults become binding when unanswered (`docs/PRD.md` §13); gate packs prepared for asynchronous review (`docs/team-charter.md` Gates); questions grouped by blocking vs configurable (`docs/PRD.md` §9) | A gate open more than 10 working days; a blocking question (Q-A-nn) unanswered 2 weeks after G0 | Open | Weekly until G1, then each gate |
| R-04 | Formula, tolerance, yield and routing data not supplied by process owners; Phase 3 runs on fictional seed values and cannot go live | delivery | 4 | 4 | 16 | manufacturing-process-engineer | Production process owner, QA process owner | Tolerance mandatory per line with no default (A-PRD-18/19, A-PROC-03); Q-PR-01 to Q-PR-12 (`docs/process-maps.md` §7.2); go-live blocked until an approved FormulaRevision and RoutingRevision exist per product (`docs/data-migration-plan.md` §4, §7) | No approved FormulaRevision for the pilot product 4 weeks before G3; process-owner workshop not scheduled by the end of Phase 2 | Open | Monthly, then each gate |
| R-05 | Time-clock export file format unknown; attendance import built against a guess | delivery | 3 | 3 | 9 | hr-payroll-specialist | HR, IT/operations contact | Mapping layer absorbs any layout (A-PRD-32, A-PROC-16/39); Q-A-06; representative anonymised files required before the Phase 5 build (`docs/PRD.md` §10 sequencing 5) | No sample file received by the start of Phase 5; more than one time-clock model in use | Open | Monthly |
| R-06 | Accounting or payroll qualified reviewer not available to validate rules and approvals, so G6 cannot close | delivery | 3 | 4 | 12 | finance-specialist, hr-payroll-specialist | Owner/Director, Accountant | ADR-020/021 keep finance operational and payroll import-first; reviewers named per `docs/PRD.md` §13 item 5; Phase 6 planned only after Q-A-04/05 are answered | Reviewer not named by G5; reviewer has not seen the rule catalogue 4 weeks before G6 | Open | Each gate |
| R-08 | Early go-live after G4 without the Phase 9 activities (migration rehearsal, restore drill, security review) pulled forward | delivery | 3 | 4 | 12 | product-manager | Owner/Director | `docs/PRD.md` §10 sequencing 7; command-line loader available before the Phase 5 wizard (`docs/data-migration-plan.md` §9.4); rehearsals §11; G9 checklist items attached to the G4 decision | Owner sets a go-live date earlier than G4 + 4 weeks; no rehearsal booked when Phase 4 starts | Open | Each gate |
| R-09 | Slice effort underestimated because "done" includes model, permissions, states, audit, tests, docs and deployment notes | delivery | 3 | 3 | 9 | principal-architect | Owner/Director | Definition of done (CLAUDE.md; `docs/team-charter.md` working agreement 2); Slice 1 sized in `docs/PRD.md` §11; CI gates (ADR-013) | A slice runs more than 2 weeks; CI red for more than 2 days; stories closed without negative tests | Mitigating | Weekly |
| R-10 | Paper records differ from the digital process (BMR template, intermediates, curing, second line clearance), so operators distrust or bypass the digital record | delivery | 4 | 3 | 12 | manufacturing-process-engineer | Production process owner, QA process owner | Template mapping workshop and approved SOPs; hybrid paper record (A-PROC-37, A-PRD-14); print tests at G3; A-PROC-04/05/32 confirmed with process owners | Pilot batch at G3 needs handwritten additions; a paper BMR is kept in parallel after G3 | Open | Each gate |

### 3.2 Data integrity

| ID | Risk | Category | L | I | Score | Team owner | Business owner | Mitigation (where) | Early-warning trigger | Status | Review |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R-11 | Incorrect stock from concurrent scans, retries or offline replay (double posting, negative stock, wrong lot) | data integrity | 3 | 5 | 15 | backend-engineer | Warehouse lead | Append-only ledger with row locks (ADR-006; `docs/data-model.md` §5.4 to §5.6); idempotency keys (`docs/security.md` §4.10); replay protocol (`docs/offline-sync.md` §4); concurrency and replay tests (`docs/testing.md`; AC-11, AC-16, AC-20) | Nightly reconciliation reports any non-zero difference; `IDEMPOTENCY_KEY_REUSED` errors spike; any negative-balance exception | Mitigating | Weekly in Phases 2 and 7, then monthly |
| R-12 | Data migration quality: opening balances wrong, expiry or supplier lot missing, duplicate masters, unlabelled stock | data integrity | 4 | 4 | 16 | product-manager (plan), database-architect (tooling) | Site managers, QA process owner, Accountant | Cleansing and validation (`docs/data-migration-plan.md` §7), duplicate rules (§8), count-and-tag (§10), rehearsals with acceptance checks MC-01 to MC-16 (§11), rollback (§13) | Rehearsal error rate above 2 % of rows; count vs spreadsheet variance above the site threshold; more than 1 % of containers without a scannable label after cutover | Open | Monthly; weekly from T-30 |
| R-13 | Unapproved formula or process changes reach production | data integrity | 2 | 5 | 10 | quality-regulatory-specialist | QA process owner | Versioned, effective-dated revisions with approval (`docs/data-model.md` §4; A-PROC-41); batch snapshot (§4.4; AC-13); `masterdata.formula.approve` restricted (`docs/permissions-matrix.md` §2.2) | A formula edit without a matching approval audit event; a batch referencing a non-approved revision (must be impossible; tested) | Mitigating | Each gate |
| R-15 | Balance projection drifts from the ledger | data integrity | 2 | 4 | 8 | database-architect | Warehouse lead | Same-transaction projection update and nightly reconciliation (`docs/data-model.md` §5.2, §5.6); alert on differences (`docs/deployment-railway.md`) | Reconciliation differences on two consecutive nights | Mitigating | Monthly |
| R-16 | Unit-of-measure and conversion errors (g vs kg, mL vs g without density, mixed units in spreadsheets) | data integrity | 3 | 4 | 12 | database-architect | Production process owner, Procurement | Dual quantities (ADR-010); dimensional checks (FR-masterdata-03); unit column mandatory and density-less conversions rejected at import (`docs/data-migration-plan.md` §7) | Import rows rejected for unit reasons above 5 %; a material with both mass and volume balances | Open | Monthly |
| R-17 | Legacy identifiers collide with new numbering rules or are duplicated in source data | data integrity | 3 | 3 | 9 | database-architect | Production process owner, QA process owner | New numbers generated, legacy kept in `legacy_number` (`docs/data-migration-plan.md` §6); Q-A-08; numbering never retroactive (`docs/security.md` §2.11) | Duplicate legacy numbers in an extract; a request to reuse paper numbers as system numbers | Open | Monthly |
| R-18 | Shadow spreadsheets continue after go-live, so system and spreadsheet disagree (brief principle 5) | adoption | 4 | 3 | 12 | product-manager | Owner/Director, Site managers | Spreadsheets frozen read-only at cutover (`docs/data-migration-plan.md` §12.2); stock card and reports from Phase 2 (FR-inventory-02, FR-documents-09); action center from Phase 5 | A stock adjustment justified by "the spreadsheet says"; a figure compiled outside the system for the owner after hypercare | Open | Weekly in hypercare, then monthly |

### 3.3 Security

| ID | Risk | Category | L | I | Score | Team owner | Business owner | Mitigation (where) | Early-warning trigger | Status | Review |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R-14 | Site data leakage (one site sees or changes another site's records through URL, body, filter or export) | security | 2 | 5 | 10 | security-engineer | Owner/Director | Scoped services (ADR-005); threat model `docs/security.md` §2.3; mandatory negative tests (`docs/permissions-matrix.md` §8); RLS as defense in depth decided at the end of Phase 2 (ADR-022) | Any failing `authz.cross_site.*` test; `authz.denied` events carrying foreign site ids; export row counts above the user's scope | Mitigating | Each gate |
| R-19 | Payment webhook fraud or duplicates (Phase 8) | security | 2 | 4 | 8 | security-engineer | Owner/Director, Accountant | Signature verification, replay store, amount check, server-side confirmation (`docs/security.md` §2.10, §4.11); sandbox tests at G8 | Signature failures or amount mismatches in the webhook log; an order marked paid without a provider event | Open (Phase 8) | Each gate from G7 |
| R-20 | Session left open on a shared floor device; actions attributed to the wrong person | security | 3 | 4 | 12 | security-engineer | Site managers | Idle timeout per device class (A-PRD-26; A-SEC-08/09); sign-out on every operator screen and cache clearing at logout (`docs/security.md` §2.2, §3.5); device labels; quick-switch PIN evaluated in Phase 1b | A user acting outside their shift in the audit log; one session used by both conductor and checker; a request for a shared generic account | Open | Each gate |
| R-21 | Payroll and personal data exposed to the wrong role or exported in bulk | security | 2 | 5 | 10 | security-engineer | HR, Owner/Director | Restricted permissions with re-authentication and TOTP (`docs/permissions-matrix.md` §6; `docs/security.md` §3.6, §3.7); field encryption (`docs/data-model.md` §3.8); audited exports; weekly access report (Phase 5) | Restricted exports above 5 per user per week; `hr.employee_personal_data_viewed` by non-HR roles | Mitigating | Each gate |
| R-22 | Malicious or malformed uploads and imports (macros, polyglots, formula injection, oversized files) | security | 2 | 3 | 6 | security-engineer | IT/operations contact | `docs/security.md` §2.5, §2.6, §4.6, §4.7; row and size caps (A-SEC-15, A-SEC-18) | Upload rejections spike from one user; worker memory alarms during imports | Mitigating | Each gate |
| R-23 | Secret exposure, or loss of the backup decryption key | security | 2 | 5 | 10 | devops-engineer | Owner/Director, IT/operations contact | Environment-only secrets, rotation, two key holders (`docs/security.md` §6); restore rehearsal before G9 (`docs/deployment-railway.md`); gitleaks in CI | A gitleaks finding; a restore rehearsal that cannot decrypt; a key holder leaves the company | Open | Each gate; monthly after go-live |
| R-24 | Vulnerable dependencies in the supply chain | security | 4 | 2 | 8 | devops-engineer | – | Audit in CI, Renovate, Trivy (`docs/security.md` §4.12); exceptions recorded in section 6 of this register with an expiry date | CI audit failing; an exception past its expiry | Mitigating | Monthly |
| R-25 | Customer portal attack surface (Phase 8): credential stuffing, tenant crossover, abuse | security | 3 | 4 | 12 | security-engineer | Owner/Director, Sales lead | Separate auth boundary (ADR-011); `docs/security.md` §2.10 and §7 portal rows; G8 security review and penetration test (§8.2) | Portal login failure rate rising; any `authz.portal.tenant_isolation` test failure | Open (Phase 8) | Each gate from G7 |

### 3.4 Adoption

| ID | Risk | Category | L | I | Score | Team owner | Business owner | Mitigation (where) | Early-warning trigger | Status | Review |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R-26 | Poor adoption by operators (too many steps, small targets, slow scanning, unclear states) | adoption | 3 | 5 | 15 | ux-ui-designer | Site managers, Owner/Director | Operator mode and task-oriented flows (`docs/ux-system.md`); G2 acceptance on the company's hardware; quick guides and training (Phase 9); feedback loop in hypercare (`docs/data-migration-plan.md` §12.6) | Fewer than 80 % of movements posted by scan in week 2 after go-live; paper logbooks reappear; manual code entry above 20 % of scans | Open | Each gate; weekly in hypercare |
| R-27 | Operator adoption on shared devices: sign-in, MFA and idle locks create friction, leading to shared accounts and lost attribution | adoption | 4 | 4 | 16 | ux-ui-designer, security-engineer | Site managers, IT/operations contact | MFA limited to privileged roles (A-PRD-34); shorter floor timeouts without MFA for operator roles (A-PRD-26); quick-switch PIN evaluation in Phase 1b (`docs/security.md` §9 question 2); device registration (`docs/offline-sync.md` Q-OFF-02); hardware and device policy answers (Q-A-03) | A request for a generic "warehouse" login; more than one user per device per hour on average; sign-in taking above 15 s on floor devices | Open | Each gate; weekly in hypercare |
| R-28 | Two-person verification (conductor ≠ checker) not staffable on small shifts | adoption | 3 | 3 | 9 | manufacturing-process-engineer | Production process owner, QA process owner | site_manager may act as checker (A-PROC-06); waiver with owner approval (A-PROC-35); `requires_checker` per routing step (`docs/data-model.md` §3.2); Q-PR-07 | Dispensing waits for a checker above 15 minutes median; a request to disable the checker on critical lines | Open | Each gate |
| R-29 | Supervisors and owners distrust system figures and revert to manual compilation | adoption | 3 | 3 | 9 | analytics-specialist | Owner/Director | KPI definitions with drill-down and reconciliation to source (AC-21; `docs/analytics-kpis.md`); stock card reconciles to the ledger | The owner asks for figures compiled outside the system after Phase 5 | Open | Each gate from G5 |
| R-52 | Customer-specific requirements (labels, carton counts, certificates) unknown until orders fail at packing | adoption | 3 | 3 | 9 | warehouse-procurement-specialist | Sales lead | CustomerRequirement records (A-PRD-31); Q-B-14; migration source S-09 (`docs/data-migration-plan.md` §3) | An order blocked or returned for a requirement not in the system; a requirement discovered at packing | Open | Each gate from G4 |

### 3.5 Regulatory and validation

| ID | Risk | Category | L | I | Score | Team owner | Business owner | Mitigation (where) | Early-warning trigger | Status | Review |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R-31 | Regulatory validation not performed (cosmetics labelling and claims, record-keeping, electronic records, retention) before the company relies on the system | regulatory/validation | 3 | 5 | 15 | quality-regulatory-specialist | QA process owner, Owner/Director | Not a substitute for qualified review (`docs/PRD.md` §5.4; F-19); configuration flagged for review (A-PRD-13/14; A-PROC-25/37); reviewers named per `docs/PRD.md` §13 item 5; go-live checklist item at G9 | No named regulatory reviewer by G3; a label template approved without QA review; the go-live checklist item unsigned | Open | Each gate |
| R-32 | Payroll or tax errors if calculation is relied on before validation | regulatory/validation | 2 | 5 | 10 | hr-payroll-specialist, finance-specialist | Accountant, HR | Import-first and reporting-first (ADR-021); effective-dated rule catalogue (`docs/modules/hr-attendance-payroll.md`); reviewer sign-off before any payroll reliance (G6) | A payroll calculation feature requested before reviewer sign-off; a statutory value typed into code | Mitigating | Each gate |
| R-33 | Data privacy and retention obligations (for example the Philippine Data Privacy Act) not confirmed by counsel | regulatory/validation | 3 | 4 | 12 | security-engineer | Owner/Director, legal or HR adviser | Retention as configuration (`docs/security.md` §7; A-SEC-24 to A-SEC-31); data-subject procedure (`docs/operations-runbook.md`) | No privacy officer or counsel named by G9; retention policies still at placeholder values at go-live | Open | Each gate |
| R-34 | Electronic sign-offs treated as validated e-signatures by customers or auditors | regulatory/validation | 2 | 4 | 8 | quality-regulatory-specialist | QA process owner | Attestation only (A-PRD-14); hybrid paper record (A-PROC-37); Q-A-07 | A customer or auditor asks for validated e-signature evidence; SOP wording calls the sign-off a signature | Open | Each gate from G3 |
| R-35 | Misleading forecasts or reorder suggestions acted on without review | regulatory/validation | 3 | 3 | 9 | analytics-specialist | Owner/Director, Procurement | Descriptive analytics first; suggestions require human review (brief Module 4 and analytics governance); actual, estimate and forecast labelled | A PO raised directly from a suggestion without review; a forecast shown without data-sufficiency or confidence notes | Open | Each gate from G5 |

### 3.6 Platform

| ID | Risk | Category | L | I | Score | Team owner | Business owner | Mitigation (where) | Early-warning trigger | Status | Review |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R-36 | Railway, storage or backup assumptions wrong (backup not restorable, bucket limits, region latency to the sites) | platform | 3 | 4 | 12 | devops-engineer | Owner/Director, IT/operations contact | ADR-014; backup to bucket and restore drill (`docs/deployment-railway.md`); RPO/RTO (A-PRD-33); latency measured from site networks at G1 | Restore drill fails or exceeds RTO; backup job failures two nights running; p95 page latency from a site above 2 s | Open | Each gate; monthly after go-live |
| R-38 | PDF rendering memory (headless Chromium) exceeds worker limits on Railway | platform | 3 | 3 | 9 | backend-engineer | – | `@react-pdf/renderer` fallback (ADR-016); measured in Phase 3 (`docs/architecture.md` §15); PDF jobs in the worker with a per-user queue limit (A-SEC-20) | Worker out-of-memory during PDF jobs; BMR PDF p95 above 30 s in staging | Open | Weekly in Phase 3, then each gate |
| R-39 | Hardware incompatibility: scanners, printers, scales, phones (camera scanning fails, labels misprint, scale values typed wrongly) | platform | 4 | 4 | 16 | warehouse-procurement-specialist, frontend-engineer | IT/operations contact | A-PRD-05 to A-PRD-08; BarcodeDetector with ZXing fallback and keyboard-wedge support (ADR-017); G2 acceptance on company hardware; device matrix (`docs/testing.md`); label print tests (`docs/reports-and-templates.md`) | Hardware list not supplied before the Phase 2 build; camera scan success below 95 % on the matrix; label misprints above 1 % in the pilot | Open | Monthly until G2, then each gate |
| R-40 | Connectivity gaps in production and warehouse areas; the MVP is online-first until Phase 7 | platform | 4 | 4 | 16 | principal-architect | IT/operations contact, Site managers | Online-first MVP (A-PRD-09); idempotent API from Phase 2 (ADR-018); offline list (`docs/offline-sync.md` §3); Q-A-02 and Q-OFF-01; Wi-Fi survey and access points before G2 | Failed postings due to network above 2 % per day; operators report waiting for signal; no Wi-Fi survey by the Phase 2 start | Open | Each gate; weekly in hypercare |
| R-41 | Postgres used as both queue and store degrades under load | platform | 2 | 3 | 6 | devops-engineer | – | pg-boss adequate at this scale (ADR-015); queue depth and latency monitoring; revisit if exceeded (`docs/architecture.md` §15) | Job wait time p95 above 60 s; database CPU above 70 % sustained | Mitigating | Monthly |
| R-42 | Module boundaries erode inside the monolith | platform | 3 | 3 | 9 | principal-architect | – | Lint-enforced boundaries (ADR-013); architect review of cross-module changes (`docs/architecture.md` §4, §15) | A lint exception added; a module importing another's internals | Mitigating | Monthly |
| R-43 | Business rules leak into server actions or UI | platform | 3 | 3 | 9 | backend-engineer | – | Actions are adapters; no Drizzle import outside `modules/` and `db/` (`docs/architecture.md` §4, §15) | A rule found only in the UI during review; a server action longer than an adapter | Mitigating | Monthly |
| R-44 | iOS/Safari limitations for camera scanning and PWA storage (no BarcodeDetector, IndexedDB eviction) | platform | 3 | 3 | 9 | frontend-engineer | IT/operations contact | ZXing fallback (ADR-017); persistent storage and outbox export before clearing (`docs/offline-sync.md` §2; A-OFF-06); device matrix | iOS failures in the device matrix; outbox loss reports | Open | Each gate from G2 |
| R-45 | Thermal label printing through the browser unreliable (page size, drivers, curved containers) | platform | 3 | 3 | 9 | warehouse-procurement-specialist | IT/operations contact | Label PDFs at fixed sizes (A-PRD-05); print tests at G2; Q-WH-04; printer-language adapter kept as an option (`docs/PRD.md` §5.3) | Misprint or unreadable-scan rate above 1 %; a printer not on the tested list | Open | Monthly until G2 |

### 3.7 People

| ID | Risk | Category | L | I | Score | Team owner | Business owner | Mitigation (where) | Early-warning trigger | Status | Review |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R-07 | Key-person dependency on both sides (one owner approving, one QA releasing, one operations contact holding secrets; one architect persona holding context) | people | 3 | 4 | 12 | principal-architect | Owner/Director | Documentation is the source of truth (CLAUDE.md; `docs/decision-log.md`); deputies for QA release and gate approval; two holders of secrets and the backup key (`docs/security.md` §6); `docs/operations-runbook.md` | One person holds more than one of: gate approval, QA release, production secrets; a document older than the code it describes | Open | Each gate |
| R-30 | Training burden and staff turnover erode correct use | people | 3 | 3 | 9 | product-manager | HR, Site managers | Quick guides per task; operator mode; Phase 9 training plan; onboarding checklist in `docs/operations-runbook.md` | Error or correction rate of new users above twice the site average | Open | Monthly after go-live |
| R-46 | A single QA person becomes the bottleneck for lot and batch release (online-only decisions) | people | 3 | 3 | 9 | quality-regulatory-specialist | QA process owner, Owner/Director | Auto-release material classes configured by QA (A-PRD-15; A-PROC-10); action center queue; a deputy `qa_qc` user; SoD waiver (A-PROC-35) | Median time in `quarantine` above 48 h; production blocked waiting for release | Open | Each gate from G2 |
| R-47 | Support and hypercare ownership undefined after go-live | people | 3 | 4 | 12 | devops-engineer, product-manager | Owner/Director | `docs/operations-runbook.md`; charter G9 "support ownership and incident procedure established"; hypercare roster (`docs/data-migration-plan.md` §12.6) | No named support contact by T-7; an incident without an owner during hypercare | Open | Each gate from G4 |
| R-48 | Documentation drifts from code (persona context is lost between sessions) | people | 3 | 3 | 9 | principal-architect | – | Docs updated in the same change (CLAUDE.md); decision log; gate consistency review (`docs/team-charter.md` G0) | A document older than the module it describes; an ADR contradicted in code | Mitigating | Each gate |

### 3.8 Cost

| ID | Risk | Category | L | I | Score | Team owner | Business owner | Mitigation (where) | Early-warning trigger | Status | Review |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R-37 | Railway service limits and cost (worker memory, database size, egress, plan growth) | cost | 3 | 3 | 9 | devops-engineer | Owner/Director | Cost table (`docs/architecture.md` §2); monthly cost review; memory caps and per-user job limits (A-SEC-20); usage alerts (`docs/deployment-railway.md`) | Monthly bill above budget by 20 %; out-of-memory restarts; database above 70 % of plan storage | Open | Monthly |
| R-49 | Rework from late business facts (locale, number of sites, hardware, numbering) | cost | 3 | 3 | 9 | product-manager | Owner/Director | Blocking questions answered at G0 (`docs/PRD.md` §9.1); defaults binding when unanswered (§13); settings and numbering as data (FR-platform-04, ADR-009) | An ADR superseded after its phase is implemented; a Phase 1 setting changed after G2 | Open | Each gate |
| R-50 | Unbudgeted recurring and one-off costs (email provider, penetration test, label printers, extra devices, Railway plan) | cost | 3 | 2 | 6 | devops-engineer | Owner/Director | Cost review at G1 and G9; penetration test budget (`docs/security.md` §9 question 4); hardware list (Q-A-03) | A cost item first identified at a gate; penetration test not budgeted by G8 | Open | Each gate |
| R-51 | Data migration effort underestimated (manual cleansing, labelling every container, counting while operating) | cost | 4 | 3 | 12 | product-manager | Site managers, Owner/Director | Source volumes (`docs/data-migration-plan.md` §3); count-and-tag pilot in one zone (§10); rehearsals with timing (§11) | Rehearsal 1 takes more than twice the planned time; cleansing backlog above 10 % of rows at T-14 | Open | Monthly; weekly from T-30 |

## 4. Traceability to the brief's risk table

| Brief risk (`docs/source/master-brief.md`, Important risks and mitigations) | Register rows |
|---|---|
| Trying to build all modules at once | R-01, R-02 |
| Incorrect stock from concurrent scans or offline replay | R-11, R-15 |
| Unapproved formula/process changes | R-13, R-04 |
| Site data leakage | R-14 |
| Payroll/tax errors | R-32, R-06, R-21 |
| Misleading forecasts | R-35, R-29 |
| Poor adoption by operators | R-26, R-27, R-28, R-30 |
| Paper records differ from digital process | R-10, R-34 |
| Railway/storage/backup assumptions | R-36, R-37, R-38, R-23 |
| Payment webhook fraud/duplicates | R-19, R-25 |

## 5. Risks re-scored at each gate

| Gate | Rows that must be re-scored and reported |
|---|---|
| G0 | R-02, R-03, R-49, R-07 |
| G1 | R-20, R-27, R-36, R-23, R-09, R-42, R-43 |
| G2 | R-11, R-14, R-15, R-16, R-39, R-40, R-44, R-45, R-46 |
| G3 | R-04, R-10, R-13, R-28, R-34, R-38 |
| G4 | R-52, R-47, R-08 |
| G5 | R-05, R-29, R-35, R-21 |
| G6 | R-06, R-32, R-33 |
| G7 | R-11, R-20, R-40, R-44 |
| G8 | R-19, R-25 |
| G9 | R-12, R-17, R-18, R-26, R-31, R-33, R-36, R-47, R-51 |

## 6. Accepted exceptions log

Required by `docs/security.md` §4.12 (dependency vulnerabilities) and §8.2 (penetration-test
findings). An exception needs an owner decision, an expiry and a compensating control; expired
exceptions fail CI.

| Exception | Type | Description | Related risk | Accepted by | Date | Expiry or re-review | Compensating control |
|---|---|---|---|---|---|---|---|
| (none yet) | | | | | | | |

## 7. Review process

1. The product-manager updates this register in the same change as the gate report; the
   principal-architect reviews it for consistency with `docs/decision-log.md`.
2. Any persona may add a row by proposing it in the gate report with L, I, mitigation and
   trigger; the id is the next free `R-nn`.
3. A trigger that fires is reported at the next weekly review, with the row re-scored and, if
   it enters the Critical band, raised to the owner within one working day.
4. A row is closed only when the mitigation is delivered, its tests pass in CI where tests
   apply, and the trigger has not fired for two review periods.
5. Status Accepted requires the owner's written acceptance and an entry in section 6.

## 8. Assumptions and open questions

| ID | Assumption (default) | Needs confirmation from |
|---|---|---|
| A-RISK-01 | Score bands and handling in §1.2 | Owner/Director |
| A-RISK-02 | Default review cadence: each gate during build, monthly between gates, weekly from T-30 and during hypercare | Owner/Director |
| A-RISK-03 | Impact 5 includes any unsafe product decision or legal exposure even when probability is low; such rows are never Accepted without the QA process owner's signature | QA process owner |

| ID | Question | Why it matters |
|---|---|---|
| Q-RISK-01 | Who are the named people behind the business-owner labels (Owner/Director, IT/operations contact, Production process owner, QA process owner, Accountant, HR, Site managers, Warehouse lead, Sales lead)? | Triggers need a person to call |
| Q-RISK-02 | Is a budget reserved for a penetration test (R-25, R-50) and for label printers and spare devices (R-39)? | Cost rows cannot close otherwise |
| Q-RISK-03 | Which risks is the owner prepared to accept formally at G0 (for example R-08 early go-live) so that mitigation effort can be reallocated? | Shapes Phase 1 to 4 planning |
