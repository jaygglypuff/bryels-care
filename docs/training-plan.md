# Training plan and SOP mapping (US-9-08)

Status: draft for owner approval (Wave 4 W4F, 2026-10-25). Owner: product-manager, with the
devops-engineer for the platform sessions. Companion to `docs/operations-runbook.md` §2.9
(onboarding checklist, training outline, SOP alignment, feedback loop). This document does not
repeat §2.9. It turns it into a schedule, a register and the forms people fill in.

**For business owners, in plain words:** every person learns only the screens their job needs,
on the practice (staging) system, with made-up data. They then do their first real task with a
supervisor watching. A person gets "post", "approve" or "admin" rights in the live system only
after this is recorded. Each quick guide (the "?" on a screen) must match the screen and name
the company SOP it belongs to. QA fills in the SOP numbers. The team never writes SOP content.

## 1. Principles

| # | Rule | Source |
|---|---|---|
| 1 | Training happens on staging with the fictional seed data, never on production data | `docs/testing.md` §8, runbook §2.9(b) |
| 2 | One session per role group per phase going live; each session ends with a scenario done by the trainee | runbook §2.9(b) |
| 3 | `post`, `approve` and `admin` permissions are granted in production only after onboarding steps 1 to 6 are recorded | runbook §2.9(a), A-OPS-16 |
| 4 | Quick guides are versioned with the code (`docs/help/*.md`). A guide that differs from the screen is a defect fixed in the same release | runbook §2.9, US-2-27 |
| 5 | SOP wording, effective dates and read-and-understood records are the company's (QA process owner) | runbook §2.9(c) |

## 2. Sessions per role (go-live set: Phases 1 to 4)

Durations are proposals (A-W4F-08). The trainer is the persona that owns the flow, paired with
the company's process owner. "Scenario" is what the trainee does alone on staging to pass.

| # | Session | Roles | Guides used | Scenario to pass | Duration | Trainer + company co-trainer |
|---|---|---|---|---|---|---|
| T1 | Platform basics | all | (none) "Help & guides" page | sign in, switch site, open "?" on a task screen, read the error banner `requestId` aloud | 20 min, part of every session | site manager |
| T2 | Administration | `owner_director`, `system_admin` | (runbook §2) | invite a fictional user, assign a role and site, reset MFA, read the Diagnostics page, run a retention dry run | 2 h | devops-engineer, operations contact |
| T3 | Receiving and put-away | `warehouse_operator`, `procurement`, `site_manager` | Receive materials, Put away a received lot | receive two lines of one delivery, print labels, put away one lot after release | 1.5 h on the floor | warehouse-procurement-specialist, warehouse lead |
| T4 | Moves and counts | `warehouse_operator`, `stock_counter`, `site_manager` | Scan to move, Count | move a box by three scans and undo it, count one zone blind, recount a variance | 1.5 h on the floor | warehouse-procurement-specialist, warehouse lead |
| T5 | Planning | `production_planner`, `site_manager` | Plan and release a work order, Stage materials | create, plan and release a work order, create a batch, stage it | 1.5 h | manufacturing-process-engineer, production lead |
| T6 | Batch execution | `production_operator`, `production_planner` | Line clearance, Weigh and dispense an ingredient, Batch record (BMR) | sign a clearance with a checker, weigh five ingredients (one outside tolerance), complete the steps, post to quarantine | 2 × 2 h, one full staging batch | manufacturing-process-engineer, production lead |
| T7 | QA decisions | `qa_qc` | QA release or rejection, Batch record (BMR), Log and handle a customer complaint | review an inspection, release one batch, reject one lot, raise a deviation, close the BMR, place and release a legal hold (two people) | 2 h | quality-regulatory-specialist, QA process owner |
| T8 | Orders and fulfilment | `sales_cs`, `warehouse_operator`, `finance` | Enter and confirm a sales order, Pick, pack and dispatch, Receive a customer return | enter and confirm an order, allocate, pick, verify packing as a second person, dispatch, record the signed DR, receive a return | 1.5 h | product-manager, sales lead |
| T9 | Imports and reports | `system_admin`, `procurement`, `site_manager`, `owner_director` | Import a spreadsheet, Run, export and schedule a report | import a 20-row fictional material file through all five steps, run and export a report, schedule it | 1 h | data-migration persona, operations contact |
| T10 | Refresher | all | changed guides of the release | read the change notes, redo one scenario | 30 min, yearly and after a flow change | site manager |

Phases 5 to 8 add sessions when they go live (runbook §2.9(b) row "5–8").

## 3. Schedule template (fill per site)

| Week | Day | Session | Site | Trainees (names) | Room or floor area | Devices (scanner, printer, tablet) | Trainer | Co-trainer |
|---|---|---|---|---|---|---|---|---|
| T-21 | | T2 | all | | | laptop | | |
| T-14 | | T3, T4 | | | receiving bay | scanner, label printer | | |
| T-14 | | T5, T6 | | | weighing room | tablet, scale | | |
| T-10 | | T7 | | | QA office | laptop | | |
| T-10 | | T8 | | | dispatch dock | scanner, A4 printer | | |
| T-7 | | T9 | all | | | laptop | | |
| T-3 | | catch-up for absentees | | | | | | |

Rule: nobody starts T0 without T1 and the session for their role, unless the site manager
records why (for example, an absent person who will work under supervision).

## 4. SOP register (guide → company SOP)

Each quick guide's front matter has a `sop:` line. Until QA supplies the number, the guide
says "Not yet mapped" and this row stays open. **Company responsibility: verify with
authorised personnel before production use.** The QA process owner fills in the last four
columns. The team then changes the guide's `sop:` line to the SOP number in the same release.

| Guide (screen key) | File | Flow | Company SOP number and title | SOP status (draft / approved / effective) | Effective date | Read-and-understood records complete |
|---|---|---|---|---|---|---|
| Receive materials (`inventory.receive`) | `docs/help/receive.md` | W01 | | | | |
| Put away a received lot (`inventory.putaway`) | `docs/help/putaway.md` | W01 | | | | |
| Scan to move (`inventory.move`) | `docs/help/move.md` | W02 | | | | |
| Count (`inventory.count`) | `docs/help/count.md` | W03 | | | | |
| Plan and release a work order (`production.work_order`) | `docs/help/work-order.md` | W05-01..03 | | | | |
| Stage materials for a batch (`production.staging`) | `docs/help/staging.md` | W05-04..05 | | | | |
| Line clearance (`production.line_clearance`) | `docs/help/line-clearance.md` | W05-06 | | | | |
| Weigh and dispense an ingredient (`production.weighing`) | `docs/help/weighing.md` | W05-07..09 | | | | |
| Batch record (BMR), closure and paper pages (`production.bmr`) | `docs/help/bmr.md` | W05-15..17 | | | | |
| QA release or rejection (`quality.release`) | `docs/help/qa-release.md` | W06 | | | | |
| Enter and confirm a sales order (`sales.order`) | `docs/help/order.md` | W09-01..05 | | | | |
| Pick, pack and dispatch (`sales.fulfilment`) | `docs/help/pick-pack-dispatch.md` | W09-06..10 | | | | |
| Log and handle a customer complaint (`quality.complaint`) | `docs/help/complaint.md` | W07 | | | | |
| Receive a customer return (`sales.return`) | `docs/help/return.md` | W09-11 | | | | |
| Import a spreadsheet (`platform.import`) | `docs/help/import.md` | migration plan §9 | | | | |
| Run, export and schedule a report (`analytics.reports`) | `docs/help/run-a-report.md` | `docs/reports-and-templates.md` | | | | |

The SOP areas that need revision before each phase are listed in runbook §2.9(c). Status of
this register is reported at every gate and is go-live checklist item 13.

## 5. Attendance and competency record (one per session)

```
Session: T__  <title>          Site: ____   Date: ____-__-__   Start–end: __:__–__:__
Trainer: __________________    Co-trainer (company): __________________
Guides used (version): ______________________________________________
Staging release (from /admin/diagnostics, Health card): ____________

| # | Name | Role | Present (y/n) | Scenario passed (y/n) | Notes (what to repeat) | Trainee initials |
|---|------|------|---------------|-----------------------|------------------------|------------------|
| 1 |      |      |               |                       |                        |                  |

First supervised real task (onboarding step 5), filled after go-live:
| Name | Task and record number | Supervisor | Date | Supervisor initials |

Trainer signature: __________   Site manager signature: __________
```

The signed sheet is scanned and attached to the user (runbook §2.9(b) evidence rule). The
system administrator grants `post`/`approve`/`admin` only after seeing it.

## 6. Operator feedback loop

| When | How | Who collects | Becomes |
|---|---|---|---|
| End of every session | "What was unclear?" two questions on the attendance sheet | trainer | guide fix or training change before T0 |
| Hypercare T+1 to T+14 | daily stand-up (`docs/data-migration-plan.md` §12.6); adoption metrics (scan rate, manual-entry rate) | product-manager | issue log item; guide fix in the next release |
| After hypercare | support channel (runbook §16) plus a monthly 15-minute review per site | site manager | backlog story, guide revision, or an SOP change request to QA |

A guide revision bumps its `version` and `updated_at`. The change goes through the normal code
review: the author opens it and a second person approves (A-W2F-06).

## 7. Assumptions (need owner confirmation)

| Id | Assumption | Default |
|---|---|---|
| A-W4F-08 | Session lengths and group sizes above fit shift patterns; sessions run in paid shift time | as in §2; at most 8 trainees per floor session |
| A-W4F-09 | SOP numbers are supplied by the QA process owner before T-7; guides ship with "Not yet mapped" until then | open rows in §4 |
| A-W4F-10 | Training records are kept as scanned attendance sheets attached to the user | §5 form |
