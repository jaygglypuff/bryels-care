# Go-live checklist, support roster and hypercare exit review (US-9-09)

Status: working document for Gate 9 (Wave 4 W4F, 2026-10-25). Owner: principal-architect for
the gate, with the devops-engineer and the product-manager. The 16 gate items and their
evidence are defined once in `docs/operations-runbook.md` §17a.1. The cutover steps are in
§17a.2, and hypercare is in `docs/data-migration-plan.md` §12.6. This document is the timeline
and the forms people sign. It does not change those definitions.

**For business owners, in plain words:** going live has three parts. First, prove everything
is ready: each line below is signed by a named company person. Then run the switch-over day.
Then support everyone closely for 14 days (hypercare). Hypercare ends only when the numbers
have been clean for five days in a row, people are actually using the scanners, few problems
are left open, and you sign the support handover. If a line is not signed, there is no
go-live. Stopping on a failed check is not a failure. Going live past a failed check is.

## 1. Timeline

| When | What | Who | Done (initials, date) |
|---|---|---|---|
| T-28 | Production Railway project created per `docs/deployment-railway.md` §14 repeated for production; PITR enabled (the restore window starts at the first base backup, so do it early) | devops-engineer, operations contact | |
| T-28 | Backup cron service live (`APP_ROLE=backup`, `WITH_BACKUP_TOOLS=1`, schedule `17 18 * * *`); `BACKUP_STATUS_SOURCE=table` on `web` | devops-engineer | |
| T-21 | Restore drill on staging from the newest production dump; `restore_drills` row passed and signed off by the owner (§17a.1 item 2; runbook §13.6) | devops-engineer, owner | |
| T-21 | Retention values confirmed by the reviewers and loaded on Admin → Retention & holds; one legal hold placed and released by two people (§17a.1 item 7; runbook §21) | security-engineer, owner, QA process owner | |
| T-21 | External uptime monitor live and tested; alert routes simulated (§17a.1 item 9; runbook §12.4–12.5) | devops-engineer, operations contact | |
| T-21 to T-7 | Training sessions T1–T9 per `docs/training-plan.md` §3; SOP register (§4 there) filled by QA | product-manager, QA process owner | |
| T-14 | Master data loaded and signed (`docs/data-migration-plan.md` §12) | data owners | |
| T-7 | Migration rehearsal R2 passed (MC-01..MC-16) (§17a.1 item 5) | principal-architect | |
| T-3 | Support roster (§2 below) published to every site; support channel tested with one test ticket per site | product-manager | |
| T-1 | Go/no-go meeting: all 16 items of §17a.1 signed (§3 below) | owner | |
| T0 | Cutover per runbook §17a.2 (pre-load dump with `--hold`, read-only mode, load, checks, go-live declaration) | devops-engineer, loaders, QA | |
| T+1 to T+14 | Hypercare (§4 below); daily log | product-manager, site managers | |
| T+14 | Exit review (§5 below) | owner, principal-architect | |

## 2. Support roster template (T+1 to T+14 and after)

Tiers and hours follow runbook §16 (A-OPS-01, A-OPS-02). The owner confirms the hours and the
night-shift arrangement (runbook §16 open question 3).

| Date | Shift (Manila time) | Site | On the floor (team, T+1..T+3) | L1 key user | L2 system administrator (phone) | L3 engineer on call | Operations contact (backups, restores) | Owner informed of S1 |
|---|---|---|---|---|---|---|---|---|
| | 06:00–14:00 | NFD | | | | | | |
| | 14:00–22:00 | NFD | | | | | | |
| | 06:00–14:00 | RVS | | | | | | |

Rules: one support channel and a ticket id per request (runbook §16). S1 means the system is
down or data integrity is at risk: phone the L2 and the operations contact at once (runbook §12).
Restricted data is never sent over chat. Swaps are written into the roster before the shift.

## 3. Gate 9 sign-off sheet

Each line is item n of runbook §17a.1. Evidence is attached to the cutover record.

| # | Item (short) | Evidence attached (ref) | Business signer (name) | Signature | Date |
|---|---|---|---|---|---|
| 1 | Security review and pen-test findings closed or accepted | | | | |
| 2 | Restore drill passed within RTO, RPO measured | `restore_drills` id: | | | |
| 3 | Multi-site authorization suite green | CI run: | | | |
| 4 | Devices and offline acceptance (or n/a Phase 7) | | | | |
| 5 | Migration rehearsal R2 passed | | | | |
| 6 | Business acceptance AC-10..AC-23 for the go-live phases | | | | |
| 7 | Retention confirmed, legal hold tested | purge run id (dry run): | | | |
| 8 | TOTP for privileged users, no shared accounts, devices registered | | | | |
| 9 | Alerts routed and tested, uptime monitor live | simulation record: | | | |
| 10 | Support tiers and incident process agreed, every role named | | | | |
| 11 | Hypercare roster published | §2 above | | | |
| 12 | Training delivered, onboarding complete, guides match the screens | `docs/training-plan.md` §5 sheets | | | |
| 13 | SOPs approved and effective | `docs/training-plan.md` §4 | | | |
| 14 | Rollback rehearsed | | | | |
| 15 | Production environment checklist, rotation dates, backup key custody rehearsed | | | | |
| 16 | Owner go decision | | Owner/Director | | |

## 4. Hypercare daily log (one row per day)

The checks come from `docs/data-migration-plan.md` §12.6. The "clean" column feeds the exit
criterion "reconciliation clean 5 consecutive days".

| Day | Date | Reconciliation (ledger vs projection) rows | Clean (y/n) | Spot counts done (10 per site) | Count variances open | % movements by scan | Manual-entry rate | Open issues S1 / S2 / S3+ | Backup of the night succeeded (Diagnostics) | Notes and decisions | Initials |
|---|---|---|---|---|---|---|---|---|---|---|---|
| T+1 | | | | | | | | / / | | | |
| T+2 | | | | | | | | / / | | | |
| … | | | | | | | | / / | | | |
| T+14 | | | | | | | | / / | | | |

Where the numbers come from: reconciliation from the Reconciliation card on Admin →
Diagnostics (or `inventory.reconcile` on demand). Backups from the Backups card. Scan rate and
manual-entry rate from the adoption figures of `docs/data-migration-plan.md` §12.6 (R-26
triggers in `docs/risk-register.md`).

## 5. Hypercare exit review template (T+14)

```
Hypercare exit review                      Date: ____-__-__   Sites: ________
Chair: Owner/Director ____________   With: principal-architect, devops-engineer, product-manager, site managers

Exit criteria (all must be "met"; source docs/data-migration-plan.md §12.6, backlog US-9-09)
| # | Criterion                                                        | Evidence (log rows, report)   | Met / not met |
|---|------------------------------------------------------------------|-------------------------------|---------------|
| 1 | Reconciliation clean for 5 consecutive days (days __ to __)      | §4 log                        |               |
| 2 | Adoption at or above the R-26 triggers (scan rate __ %, manual entry __ %) | §4 log, risk register R-26 |               |
| 3 | Open issues ≤ 5, all minor (S3/S4); no open S1/S2                 | issue log export              |               |
| 4 | Every night's backup succeeded; offsite copy present             | Diagnostics Backups card      |               |
| 5 | Support handover complete: runbook §1 table names every role, roster for the next month published, L2 trained | runbook §1, §2 above |   |
| 6 | Quick guides corrected for every flow change made during hypercare | docs/help versions          |               |

Open issues carried into normal support
| Ticket | Severity | Summary | Owner | Due |

Decisions
[ ] Hypercare ends; normal support (runbook §16) starts on ____-__-__
[ ] Hypercare is extended to ____-__-__ because: ______________________

Support handover signed by
Owner/Director: ______________   Operations contact: ______________   System administrator: ______________
```

## 6. Assumptions (need owner confirmation)

| Id | Assumption | Default |
|---|---|---|
| A-W4F-11 | Shift times in the roster template | 06:00–14:00 and 14:00–22:00 Manila; owner confirms and adds a night shift if production runs one |
| A-W4F-12 | The adoption thresholds of the exit review are the R-26 triggers of the risk register | as recorded there; the owner may set different targets at T-7 |
