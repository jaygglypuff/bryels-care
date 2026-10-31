# UX audit A: Production, Quality, Maintenance (live app, 2026-10-31)

Auditor: independent UX audit, read-only. Live app: https://bryels-care-production.up.railway.app (demo data).
Screenshots: `/tmp/claude-0/-home-user-bryels-care/103807bc-c37f-572c-a3d5-4a6ebca2aac4/scratchpad/ux-audit/A/*.png` (names in the tables). Nothing was submitted, saved, approved, printed or posted.
Roles used: operator.nfd (Rhea Mendoza), checker.nfd (Jun Dela Cruz), qa.nfd (Nina Quiambao), planner.nfd (Cora Villamor), manager.nfd (Dino Reyes), owner (Ana Villanueva), floor.nfd (TV). Viewports: phone 390x844 (most), tablet 820x1180 (3 screens), desktop 1440x900 (floor TV, template lookup).

Note on method: Chromium inside the audit container got 404s for Next.js chunks whose path has `%5B…%5D` (bracket routes), while curl got 200 for the same URLs. I worked around it in the test harness (re-fetching those chunks). I believe this is a quirk of the audit network, not of the app, but if real users ever see "This page could not be loaded" on batch, weigh or step pages, check that CDN/proxy rule first.

## Summary

- Screens audited: **69 scored screen/role rows** (32 Production incl. 3 Home variants and the floor TV, 29 Quality, 8 Maintenance), plus 2 print/label screens. 3 operator screens were also checked at tablet 820. That covers 55 of the 59 routes in PAGE_REVIEW for these categories. Not reachable because no data exists: `/production/plan/[planId]` (no plans), `/production/staging/[batchId]` (nothing to stage), `/quality/recalls/[recallId]` (no recalls). `/quality/check` and the floor TV were also checked.
- **Pass all applicable criteria: 15. Fail at least one: 54.**
- The owner is right: **the old batch workspace (`/production/[batchId]`) with "Scan the packaging or label lot BC:LOT:…", "Quantity issued", "Location (if several)", "Issue to packaging" and "Complete step 6" is still the screen an operator gets from Home.** On the live data, 2 of the operator's 4 Home "Continue" buttons go there.

### Top 10 problems, ranked by impact on a first-time operator

1. **Home "Continue" opens the old batch workspace for batches that have no production order.** B-26-0004 (Acapulco, step 6 Packaging and labeling) opens `/production/[id]` with the old packaging form: type/scan a `BC:LOT:…` code, "Quantity issued", "Location (if several) e.g. PKG-01", "Issue to packaging", "Complete step 6". B-26-0005 (Guava, step 2) opens the old weighing workspace ("Dispense each ingredient against the formula", "allowed 3,704.6–3,741.8 g", "Check this weighing"). Root cause: `flowPath()` in `src/modules/production/flow-facts.ts:172-174` falls back to `/production/${batchId}` when `workOrderId` is null. The same fallback is in `production-order-next.ts:61`, `floor-tasks.ts:156,167` and `curing.ts:42`. Screens: `op-home.png`, `op-batch-B4.png`, `op-batch-B5.png`, `tab-op-batch-B4.png`.
2. **Second-person checks and "Check quality" still go to the old page even for batches that do have an order.** `production-order-next.ts:65` (Start for materials ready), `:68` (Redo), `:76` ("Check <step>" for the checker) and `flow-facts.ts:207` ("Check quality") all link to `/production/${id}`. The checker (Jun) sees no "Check" task on Home at all: his Home is identical to the operator's ("Weigh the ingredients" ×3), even though B-26-0005 has 2 weighings that need a checker's signature. `checker-home.png`.
3. **Packaging is not on Get materials for the new-flow batches, and the step lets you print labels before anything is made.** For B-26-0006 (order WO-26-00002), Get materials says "take each item… also the wrappers and labels", but it lists **only raw materials, no Packaging section** (`op-materials-B6.png`). Step 6 shows no wrapper lot. While the batch is still at step 2 (weighing), step 6 shows a "Not yet: Finish Weighing first" banner, yet "Print labels for this batch (123 labels)" and the "wrappers used / spoiled" fields are live. The Finish page of B-26-0004 does the same. Pressing Print fixes the lot number, made date and expiry (ADR-092), so it should not be possible this early. `op-step6-B6.png`, `op-finish-B4.png`.
4. **The QA decision rule differs between two QA screens for the same batch.** `/quality/check/B-26-0003` lets Nina tick and press "OK to use", with a note that the record "will say: tested and OK'd by the same person". `/quality/batches/B-26-0003` says "'OK to use' is not possible yet: you entered test results… (separation of duties)". `/quality/check` also says "This batch has no test list. Type the tests on the full QA review page (⋯ More)", which sends QA to the other screen. `qa-check-detail.png`, `qa-batches-B3.png`.
5. **Weighing asks the operator to type part of a code.** "Last 4 of the lot on the label", with an A–F/0–9 hex keypad. The label is supposed to be scanned. `op-weigh-B6.png`.
6. **The order hub has several green buttons and links to old screens.** Next step "Weigh", plus a "Weigh" on each batch row, plus "Save to daily log". The Batches tab has "Open the full batch record" (goes to the old `/production/[id]`), and the "More details" fold has "full order record WO-26-00002" (goes to the old `/production/work-orders/[id]`). The status stepper breaks the word "Approv/ed" over two lines on a phone. `op-hub-WO2.png`.
7. **The same order shows different status words on sibling screens.** WO-26-00001 is "Draft" on `/production/orders` but "Planned" on `/production/work-orders` and the board. WOM-2610-027 is "Approved" vs "Released" ("Released · to stage", "Release and reserve materials", "Plan work order" on the board). The planner and manager cannot tell which is true. `mgr-orders.png`, `mgr-workorders.png`, `mgr-board.png`.
8. **Step and recipe text from configuration is not in grade-5 words, on the screens operators read most.** Examples: "Weighing area line clearance", "Transfer to quarantine storage area", "Move finished goods to quarantine until QA disposition", "Wrap bars, print lot and expiry, reconcile wrappers used and destroyed", "mix to trace", "(Wrappers destroyed)". Step 7 also shows a green "Go to Finish" while the "Not yet" banner is up. `op-step7-B6.png`, `op-step1-B6.png`.
9. **The finished-goods label is an internal lot label, and nobody tells the operator which label or printer to use.** The approved template LT-FG-100X50 (100×50 mm) shows a QR code, "Qty at print 20.00 kg" and a black bar "STATUS AT PRINT: QUARANTINE". Step 6 says "stick one label on each bar". If that is meant literally, every soap bar would carry a "QUARANTINE" label. The step never says which printer, label stock or size to load. After printing there is no in-flow "scan to check the labels" step (label checking is the warehouse screen `/quality/label-verification`). `own-label-testpage-phone.png`, `label-testpage-pdf-1.png`.
10. **The planner's Home is an older start-page layout.** Four tiles ("Scan / look up", "Production orders", "QA queue: Review quarantined lots and batches awaiting QC", "Dispatch orders: Pick allocated stock…") with the footer "all figures from posted transactions". There is no per-role sentence about planning and no next step. `pln-home.png`. Related: QA's nav badge "Quality check 11" while the Quality check list shows 2 batches (the 11 mixes 9 lots and 2 batches). `qa-check-detail.png`.

Other notable findings:
- Data and logic: `/quality/inspections` shows "Batches waiting for their tests to start: B-26-0006, B-26-0007", which are still at weighing (`qa-inspections.png`). DEV-26-0001 is "New – QA to look", yet a fix-and-prevent plan (CAPA-26-001) from it is already "Being fixed / Overdue" (`qa-deviations-detail.png`). Lot L-2610-00011 shows "from Bukidnon Aloe Farms" in the QA queue but "SUPPLIER Cebu Chemicals" on the lot page (`qa-queue.png`, `qa-queue-detail.png`).
- The `/production/board` phone page is 5,400 px tall, mostly empty, with code-first cards ("WOM-2610-028" above the product name), "WO", and move selects ("Planned: Plan work order"). `mgr-board.png`.

## Screen table

Legend: ✓ pass, ✗ fail, – not applicable. Criteria: 1 intro sentence · 2 one next-step box/one green button · 3 forms ≤5 fields · 4 no typed codes · 5 grade-5 words · 6 names before codes · 7 phone layout · 8 empty/error states · 9 consistency with siblings · 10 not an old screen.

### Production (incl. operator flow and floor TV)

| # | Route | Role / VP | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Note | Screenshot |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | `/dashboard` (operator Home) | operator, phone + tablet | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✗ | ✗ | 2 of 4 Continue buttons go to the old `/production/[id]`. KPI "Weighing 3" while 4 cards show. "My work" link is 17 px high. | op-home, tab-op-home |
| P2 | `/dashboard` | checker, phone | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✓ | – | ✗ | ✗ | Same as the operator. No "Check" task for weighings waiting for his signature. | checker-home |
| P3 | `/dashboard` | planner, phone | ✗ | ✗ | – | ✓ | ✗ | – | ✓ | – | ✗ | ✗ | Old tile start page: "quarantined lots… awaiting QC", "allocated", "posted transactions". | pln-home |
| P4 | `/production/orders` (My work) | operator, phone | ✓ | ✗ | – | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | Many green Continue buttons. Code glued to the name ("2 batchesWO-26-00002"). Filter tabs and name links are 17–25 px high. | op-orders |
| P5 | `/production/orders` | manager, phone | ✓ | ✗ | – | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | Inline green "Approve" buttons in the list. Statuses differ from work-orders and the board. | mgr-orders |
| P6 | `/production/orders/[id]` WO-26-00002 | operator, phone | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | 3 green Weigh + Save. Stepper "Approv/ed" wraps. Links "Open the full batch record" and "full order record" go to old screens. | op-hub-WO2, op-hub-WO2-tab-* |
| P7 | `/production/orders/[id]` WOM-2610-027 | operator, phone | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | "Ask Dino Reyes to plan it" plus who can help. Good. | op-hub-WOM27 |
| P8 | `/production/orders/[id]` WOM-2610-026 | operator, phone | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Waiting-for-QA box, but a daily-log form with a green Save still shows on an order in QA. | op-hub-WOM26 |
| P9 | `.../materials` | operator, phone | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | No Packaging section although the intro promises wrappers and labels. Box says "Start the batch with the Start check" but the button says "Weigh". | op-materials-B6 |
| P10 | `.../weigh` | operator, phone | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | – | ✓ | ✓ | "Last 4 of the lot on the label" plus hex keypad. Ingredient chips scroll inside their own row (OK). | op-weigh-B6, op-weigh-viewport* |
| P11 | `.../step/1` | operator, phone | ✓ | ✓ | – | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | Title "Weighing area line clearance". | op-step1-B6 |
| P12 | `.../step/4` | operator, phone | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | – | ✓ | ✓ | "Mould used" is a free-text field. "mix to trace". "See how (WI-SOAP-MIX)" code. | op-step4-B6 |
| P13 | `.../step/6` packaging | operator, phone + tablet | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | – | ✗ | ✓ | Print button live before weighing is done. No wrapper lot shown. "reconcile", "Wrappers destroyed". | op-step6-B6, tab-op-step6-B6 |
| P14 | `.../step/7` | operator, phone | ✓ | ✗ | – | ✓ | ✗ | ✓ | ✓ | – | ✗ | ✓ | "Transfer to quarantine storage area… until QA disposition". Green "Go to Finish" while "Not yet". | op-step7-B6 |
| P15 | `/production/[batchId]` B-26-0004 (step 6) | operator, phone + tablet | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | **Old workspace**: BC:LOT scan, Quantity issued, Location, Issue to packaging. "line clearance", "BMR". Weigh-out table cut off on tablet. | op-batch-B4, tab-op-batch-B4 |
| P16 | `/production/[batchId]` B-26-0005 (step 2) | operator, phone | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | **Old weighing workspace**: "Dispense… against the formula", ranges, "Check this weighing". 18 inputs on the page. | op-batch-B5 |
| P17 | `/production/[batchId]` released BM-2610-0025 | owner, phone | ✓ | ✗ | – | ✓ | ✗ | ✗ | ✓ | – | ✓ | – | Record view. "quarantine until QA disposition", "Output lot". Batch number as title. | own-batch-released-BM25 |
| P18 | `/production/[batchId]` B-26-0003 (awaiting QC) | owner, phone | ✓ | ✗ | – | ✓ | ✗ | ✗ | ✓ | – | ✓ | – | No next-step box, only a "Waiting for quality approval" banner, no name of who. | own-batch-awaitqc-B3 |
| P19 | `/production/[batchId]/finish` B-26-0004 | operator, phone | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | Print labels offered while step 6 is not done. "Back" goes to the old workspace. | op-finish-B4 |
| P20 | `/production/[batchId]/closure` B-26-0004 | operator, phone | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | Operator can open it (should be QA/manager). "site NFD", "Controlled reopen", "Amendments", "transcription", "SOP", page code B-26-0004-P01. Paper-page Issue/Void buttons. | op-closure-B4 |
| P21 | `/production` | manager, phone | ✓ | ✗ | – | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | Batch number first, "F-GBS-01 rev 1". "New batch" goes to the old /production/new. | mgr-production |
| P22 | `/production/board` | manager, phone | ✓ | ✗ | – | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | Page 5,400 px tall. Code-first cards. "WO", "Plan work order", "Release and reserve materials", "Materials staged". Filter selects. | mgr-board |
| P23 | `/production/defects` | manager, phone | ✗ | – | ✓ | ✓ | ✓ | – | ✓ | ✗ | ✓ | ✓ | No "This screen is for" sentence. Empty state "Nothing recorded yet." does not say what to do. "Reject rate = …" formula. | mgr-defects |
| P24 | `/production/today` | manager, phone | ✗ | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✓ | Title "Today" vs nav "Today's count". | mgr-today |
| P25 | `/production/new` | manager, phone | ✓ | ✗ | – | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | **Old**: "Create batch 1" per order (two green), codes first, buttons 34 px. | mgr-prod-new |
| P26 | `/production/orders/new` | planner, phone | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | 4 fields, rest folded. Passes. | pln-orders-new, pln-orders-new-more |
| P27 | `/production/plan` | manager/planner, phone | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | "SKU", "OPEN WOS", "allocations", "FR-analytics-08". Minimum stock pick by code ("ACS-135 · …"). Tab-separated table text. | mgr-plan |
| P28 | `/production/staging` | manager, phone | ✓ | – | – | ✓ | ✗ | – | ✓ | ✓ | ✗ | ✗ | Title "Stage materials" vs nav "Get materials by scanning". Subtitle "pick reserved lots to the staging area"; empty text "its work order is released". | mgr-staging |
| P29 | `/production/work-orders` | manager, phone | ✓ | ✗ | – | ✓ | ✗ | ✗ | ✓ | – | ✗ | ✗ | Older list. "release with material reservation". Lowercase raw statuses (draft, planned, released). | mgr-workorders |
| P30 | `/production/work-orders/[id]` | manager, phone | ✓ | ✗ | – | ✓ | ✗ | ✗ | ✓ | – | ✗ | ✗ | Older order view: "FORMULA REVISION", "ROUTING REVISION", "Demo work order". | mgr-wo-detail |
| P31 | `/production/work-orders/new` | manager, phone | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | – | ✗ | ✗ | Older form, 11 fields. "Formula F-0004", "V-REV", "LOTION-1 · …" codes first. | mgr-wo-new |
| P32 | `/floor` | floor.nfd, 1440 | ✓ | – | – | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | Clear TV. "· Anyone" under each card is unclear. Next up shows an order that cannot start (no batch planned). | floor-tv |

### Quality

| # | Route | Role / VP | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Note | Screenshot |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q1 | `/quality` | qa, phone | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Supplier differs from the lot page (data). | qa-queue |
| Q2 | `/quality/lots/[id]` L-2610-00011 | qa, phone | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | "Quarantine cage QUA-01", "Stop it (QA hold)", "Place on hold is not possible while the lot is on hold". | qa-queue-detail |
| Q3 | `/quality/check` | qa, phone | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | Nav badge 11 vs 2 batches listed. | qa-check |
| Q4 | `/quality/check/[batchId]` | qa, phone | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | Next-step box has no button ("box Decision"). OK allowed here but blocked on Q5. Sends QA to "full QA review page". | qa-check-detail |
| Q5 | `/quality/batches/[batchId]` | qa, phone | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ | ✓ | "separation of duties", "YIELD", "line clearance", "quarantine". Lot links 14–20 px high. | qa-batches-B3 |
| Q6 | `/quality/bulk` | qa, phone | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | – | ✓ | ✓ | Lot code glued to name. Tick boxes 20 px. Dates as 2028-09-29. | qa-bulk |
| Q7 | `/quality/capa` | qa, phone | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | Pass. | qa-capa |
| Q8 | `/quality/capa/[id]` | qa, phone | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | 2 green "Mark as done", 34 px buttons, "Action(s) 1, 2 are not verified". | qa-capa-detail |
| Q9 | `/quality/capa/new` | qa, phone | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | Pass. | qa-capa-new |
| Q10 | `/quality/changes` | qa, phone | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | Pass. | qa-changes |
| Q11 | `/quality/changes/[id]` | qa, phone | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | – | ✓ | ✓ | Waiting box gives no name ("QA approval"). "USP", "CoAs", "risk: medium". Green "Link" at 34 px. | qa-changes-detail |
| Q12 | `/quality/changes/new` | qa, phone | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | Pass. | qa-changes-new |
| Q13 | `/quality/complaints` | qa, phone | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | "We sent them this" glued to the date. Minor. | qa-complaints |
| Q14 | `/quality/complaints/[id]` | qa, phone | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | – | ✓ | ✓ | Two green buttons. Lot links 20 px. "(CUS-001)". | qa-complaints-detail |
| Q15 | `/quality/complaints/new` | qa, phone | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | – | ✓ | ✓ | Customers shown with "(CUS-004)". Checkbox 20 px. | qa-complaints-new |
| Q16 | `/quality/deviations` | qa, phone | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | "Out-of-specification result (OOS)". Minor. | qa-deviations |
| Q17 | `/quality/deviations/[id]` | qa, phone | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | – | ✗ | ✓ | Green button twice. Lower-case "minor/major/critical". "Classify the severity first (start the investigation)". CAPA exists before the investigation. | qa-deviations-detail |
| Q18 | `/quality/deviations/new` | qa, phone | ✗ | ✗ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | No h1, no intro sentence. Redirect text only. | qa-deviations-new |
| Q19 | `/quality/holds` | qa, phone | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | Pass. | qa-holds |
| Q20 | `/quality/holds/[id]` | qa, phone | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | Trailing "·" after HDM-2610-002. Minor; counted as pass. | qa-holds-detail |
| Q21 | `/quality/holds/new` | qa, phone | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | No green submit visible on first load. Radio buttons 13 px. | qa-holds-new |
| Q22 | `/quality/holds/issue` | qa, phone | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | No visible primary button (5 fields). | qa-holds-issue |
| Q23 | `/quality/inspections` | qa, phone | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✗ | ✓ | Asks QA to start tests on batches still at weighing. | qa-inspections |
| Q24 | `/quality/inspections/[id]` | qa, phone | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | – | ✓ | ✓ | 11 fields. "Taken from (place) QUA-01 (24950 g)" code pick. "IP-MAT-0012-IN", "PLACEHOLDER". | qa-inspections-detail |
| Q25 | `/quality/label-verification` | qa, phone | ✓ | ✓ | – | ✗ | ✓ | ✗ | ✓ | – | ✓ | ✓ | Areas shown only as codes (A-01, HLD-01, RCV, REJ). | qa-labelverif |
| Q26 | `/quality/recall` | qa, phone | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | Pass. | qa-recall |
| Q27 | `/quality/recalls` | qa, phone | ✓ | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | Pass, with a good empty state. | qa-recalls |
| Q28 | `/quality/recalls/new` | qa, phone | ✓ | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | Pass. | qa-recalls-new |
| Q29 | `/quality/trace` | qa, phone | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | "What is this?" is 32 px. | qa-trace |

### Maintenance

| # | Route | Role / VP | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Note | Screenshot |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| M1 | `/maintenance` | manager, phone | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | Two green buttons (Report + Open the job). The regular-maintenance job title repeats "PM-0002:". | mgr-maint |
| M2 | `/maintenance/plans` | manager, phone | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | Pass. | mgr-maint-plans |
| M3 | `/maintenance/plans/[id]` | manager, phone | ✓ | ✓ | – | ✓ | ✗ | ✗ | ✗ | – | ✓ | ✓ | "SPR-0002" in the steps. Job link 19–20 px. Checkbox 20 px. | mgr-maint-plans-detail |
| M4 | `/maintenance/plans/new` | manager, phone | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | Checkbox 20 px. | mgr-maint-plans-new |
| M5 | `/maintenance/spare-parts` | manager, phone | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | "Remove" buttons 34 px next to each part (risky). | mgr-maint-spare |
| M6 | `/maintenance/work-orders` | manager, phone | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | Pass. | mgr-maint-wo |
| M7 | `/maintenance/work-orders/[id]` | manager, phone | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | "The job is done" appears twice in green. 34 px buttons. | mgr-maint-wo-detail |
| M8 | `/maintenance/work-orders/new` | manager, phone | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | Checkboxes 20 px. | mgr-maint-wo-new |

### Print / labels

| # | Route | Role / VP | Note | Screenshot |
|---|---|---|---|---|
| L1 | `/labels` | manager, phone | Label printer queue is empty. It does not mention batch labels from step 6. | mgr-labels |
| L2 | `/print/labels/test/[FG template]` | owner, phone + PDF | Only safe way to preview the batch label (pressing "Print labels for this batch" creates a label job and fixes the lot, so I did not press it). The 100×50 mm label shows QR, "TEST-0001", item, Batch, Made, Expiry, "Qty at print 20.00 kg", "STATUS AT PRINT: QUARANTINE". `page.pdf()` put the label small in the middle of a Letter page (`@page` size was not applied in the default PDF), so "print at 100 %" needs real-printer verification. | own-label-testpage-phone, label-testpage-pdf-1 |

Passing all applicable criteria (15): P7, P26, P32 (floor TV), Q1, Q7, Q9, Q10, Q12, Q19, Q20, Q26, Q27, Q28, M2, M6. All other 54 scored rows fail at least one criterion.

## Walkthrough log

### A. Operator (operator.nfd, Rhea), phone 390
1. Sign in, land on `/dashboard` "Good day, Rhea". 4 task cards. (op-home)
2. Card 1 "Packaging and labeling · Acapulco · B-26-0004 · Step 6 of 7" → **Continue** → `/production/01a18d48-6e90-…` = **old batch workspace**. Step 6 form: "Scan the packaging or label lot [BC:LOT:…]", "Released: L-2610-00019 (Soap wrapper 135 g, 3,000 pcs at PKG-01)", "Quantity issued", "Location (if several) e.g. PKG-01", **Issue to packaging**, Notes, Checked by, "No wrappers or labels are recorded for this batch. Scan or type the lot you used.", disabled "Complete step 6". This is where it goes wrong: exactly the old layout the owner reported. (op-batch-B4, tab-op-batch-B4)
   - On that page: "⋯ More" holds Help: weighing, Help: clean-area check, Print batch record, Close the batch and paper pages. "? How to do this step" opened nothing I could capture.
   - Finish for this batch (`/production/[id]/finish`) shows "Not ready to finish" **plus a live "Print labels for this batch (123 labels)"**. Its "Back" goes to the old workspace. (op-finish-B4)
   - Closure (`/closure`) is open to the operator: dense QA/compliance page. (op-closure-B4)
3. Card 2 "Weigh the ingredients · Guava · B-26-0005" → **Continue** → `/production/01a18d48-6eda-…` = **old weighing workspace** ("Dispense each ingredient against the formula", ranges, "Check this weighing", "Weigh 33.33% Lye Solution", "Complete step 2"). (op-batch-B5)
4. Cards 3–4 (B-26-0006/7, order WO-26-00002) → **Continue** → new `/production/orders/[wo]/weigh?batch=…`. Good one-ingredient-at-a-time screen, but it asks for "Last 4 of the lot on the label" with a hex keypad. (op-weigh-B6, op-weigh-viewport*)
5. Bottom tab **My work** → `/production/orders`: same 4 cards, then the order list: WO-26-00002 "Weigh", WOM-2610-027 "Open", WOM-2610-026 "Waiting for the quality check: Nina Quiambao, Teresa Ocampo". (op-orders)
6. WO-26-00002 hub: green Weigh (next step) plus Weigh per batch plus daily-log form. Tabs: Materials (needed/set aside/used, OK); Batches ("Open the full batch record" goes to old `/production/[id]`); More details ("full order record WO-26-00002" goes to old `/production/work-orders/[id]`). (op-hub-WO2*)
7. Get materials (`/materials?batch=B-26-0006`): 4 raw materials "Taken by Ana Villanueva". **No wrappers or labels listed**, although the intro tells the operator to take them. (op-materials-B6)
8. Steps by URL for B-26-0006: step 1 (done, "Weigh" button), step 4 (form shown under the "Not yet" banner), **step 6** (Print labels live, wrappers used/spoiled fields, no wrapper lot), step 7 ("Go to Finish" green under "Not yet"). (op-step1/4/6/7-B6)
9. WOM-2610-027 hub: "approved but no batch is planned yet. Ask Dino Reyes to plan it." Good. WOM-2610-026 hub: waiting for QA, names shown. Good, but a daily-log Save form is still there. (op-hub-WOM27, op-hub-WOM26)
10. Curing/resting: no batch is in a wait step in the demo data (floor TV "0 batches curing or resting"), so not walkable. Code check: `curing.ts:42` sends no-order batches to the old page.

### B. Second operator / checker (checker.nfd, Jun), phone
1. Home = identical 4 cards and wording to Rhea's. Jun did the weighings on B-26-0005 and cannot check his own. Rhea is the one who could check them, but **neither Home shows a "Check" task**. The only way to check is the old page's "Check this weighing" (reached via Continue on B-26-0005). (checker-home, op-batch-B5)

### C. QA (qa.nfd, Nina), phone, up to (not including) the decision
1. Home: "2 finished batches wait for the QA check" → `/quality/check` (2 batches; nav badge says 11). (qa-home, qa-check)
2. **Check this batch** → `/quality/check/B-26-0003`: product first, counts, "Nothing left the normal path", "This batch has no test list. Type the tests on the full QA review page (⋯ More)", Decision: tick box + "OK to use" (enabled after tick) / Not yet / Not OK. I stopped before pressing. (qa-check-detail)
3. ⋯ More → full QA review `/quality/batches/B-26-0003`: says **OK is not possible (separation of duties)**, which contradicts step 2. (qa-batches-B3)
4. `/quality/inspections` lists batches still at weighing as "waiting for their tests to start". (qa-inspections)
5. Problem report DEV-26-0001 (B-26-0004): "Start looking into it". Severity select is lower-case. The linked CAPA is already "Being fixed". (qa-deviations-detail)
6. Lot decision `/quality/lots/[id]`, holds and the rest of the Quality screens: see the table.

### D. Planner and manager
1. Planner Home: old tile layout (P3). Quick path → `/production/orders/new`: 4 fields (What to make, How many pieces, Needed by, Start date); More details has batch size, number of batches, finish by, line, notes. Good. (pln-orders-new*)
2. Manager → Menu → Planning tools: `/production` (batch list, "New batch" goes to the old /production/new), `/production/work-orders` (older list and statuses), `/production/work-orders/new` (11-field older form), `/production/board` (code-first, "Plan work order"), `/production/staging`, `/production/plan` (SKU table). (mgr-*)

### E. Packaging and labels: answers to the owner's questions
| Question | What the live app does |
|---|---|
| Where does the operator get the packaging? | New flow: Get materials should list wrappers under "Packaging" (ADR-092), but for the live batches B-26-0006/7 **no Packaging section appears**, so nothing tells them. Old flow (B-26-0004 via Home Continue): a hint "Released: L-2610-00019 (Soap wrapper 135 g, 3,000 pcs at PKG-01)" and then they must scan/type `BC:LOT:…`, type a quantity and location, and press "Issue to packaging". |
| How do they know which label to use? | Step 6 says "Stick one label on each bar or box. The label shows the product, lot number, made date and expiry." No label name, size, stock or printer is shown. The system silently uses the approved finished-goods template LT-FG-100X50. |
| How do they print it? | "Print labels for this batch (123 labels)" on step 6 (and on Finish) creates a label job, then shows "Open the labels and print", which goes to `/print/labels/[jobId]` and the browser print dialog. The button is live even before weighing is done. `/labels` (the printer queue) does not show these jobs. I did not press it (it writes data). |
| What does the print preview look like? | Using the template test page (safe, sample data): a 100×50 mm label with a QR code, item name/code, Batch, Made, Expiry, "Qty at print 20.00 kg", black bar "STATUS AT PRINT: QUARANTINE", "Scan to verify current status". PDF: the label sits small on a Letter page. Screenshots: own-label-testpage-phone.png, label-testpage-pdf-1.png. |
| How do they scan it? | Not in the production flow. Packaging step: "no scan" by design. Label checking is the warehouse screen "Check labels in an area" (`/quality/label-verification`), area chips by code only. The QR on the label opens the lot status. |

## Old screens still reachable

| Old screen | Exact path to reach it |
|---|---|
| `/production/[batchId]` old batch workspace, **step 6 packaging form** ("Scan the packaging or label lot BC:LOT:…", "Quantity issued", "Location (if several)", "Issue to packaging", "Complete step 6") | Operator Home → card "Packaging and labeling · Acapulco Soap 135 g · B-26-0004" → **Continue**. Also: bottom tab My work → same card → Continue. Also: Finish page of B-26-0004 → Back. Also: floor TV/production list → B-26-0004. |
| `/production/[batchId]` old **weighing workspace** ("Dispense…", "Check this weighing") | Operator Home → card "Weigh the ingredients · Guava · B-26-0005" → **Continue**. Checker's only way to sign weighings. |
| `/production/[batchId]` (any batch) | Order hub → tab **Batches** → "Open the full batch record". Code paths also: "Start" for materials-ready batches, "Redo", "Check <step>", "Check quality" (`production-order-next.ts:65,68,76`; `flow-facts.ts:187,207`; `floor-tasks.ts:156`; `curing.ts:42`; `board.ts:212`; `process.ts:137`). |
| `/production/work-orders/[id]` older order view | Order hub → **More details** (bottom fold) → "full order record WO-26-00002". Also Menu → Planning tools → Production orders, full detail. |
| `/production/work-orders/new` older 11-field form | `/production/work-orders` → "New production order". |
| `/production/new` "Create batch 1" | `/production` (Planning tools → All batches) → "New batch". Also Planning tools → "Make a batch without an order". This is how batches without an order (which then fall into the old workspace) get made. |
| `/production/staging` "Stage materials" | Planning tools → "Get materials by scanning". |
| `/production/board` (WO/stage words) | `/production/orders` → "Board"; Planning tools. |
| `/production/[batchId]/closure` (paper pages, reopen) | Old workspace → ⋯ More → "Close the batch and paper pages". Reachable by the operator. |
| Planner Home tile layout | Sign in as planner.nfd. |
| `/quality/batches/[id]` "full QA review" with its own, different OK rule | `/quality/check/[id]` → ⋯ More, as instructed by the "no test list" text. |

## Fix list

1. **Close the fallback to the old workspace.** In `src/modules/production/flow-facts.ts` (`flowPath`, line 172, and lines 187, 191, 193, 207), `src/modules/production/production-order-next.ts` (61, 65, 68, 76), `floor-tasks.ts` (156, 167), `curing.ts` (42) and `board.ts` (212), route no-order batches to the new step/weigh/materials screens. Either make those routes batch-based (e.g. `/production/batches/[batchId]/step/[n]`), or give every legacy batch a production order with a data migration (fictional seed and real data both). Then make `/production/[batchId]` read-only (record view, no step forms) or redirect it to the current step screen.
2. **Give second-person checks their own new screen and Home task.** Add a "Check <step>/<weighing>" task kind in `floor-tasks.ts` for users other than the doer, linking to a new-flow check screen (`/production/orders/[wo]/step/[n]?batch=…&check=1`) instead of `/production/${id}`.
3. **Packaging on Get materials.** Investigate why B-26-0006/7 have no packaging lines: no `production.packaging.per_piece` setting, no recipe packaging line, or batches made before migration 0031. Either back-fill or show a clear "No wrappers set up for this product: ask <planner> (setup: packaging per piece)" line on Get materials and step 6 (`src/app/(app)/production/orders/[workOrderId]/materials`, `step/[n]/packaging-box.tsx`).
4. **Lock printing until it makes sense.** In `packaging-box.tsx` (`LabelPrint`) and the Finish page, disable the Print labels button with a reason ("You can print labels when the bars are cut: step 5 done"). Enforce the same in `printBatchLabels` in `src/modules/production/packaging-flow.ts` (server-side gate plus a test). Hide step forms under "Not yet" banners in the step page, and do not make "Go to Finish" green while "Not yet".
5. **Say which label, which printer, what size** on step 6: template name and size from the template, and printer/station name from `/labels` station. Have the label job appear in the `/labels` queue. Ask the regulatory adviser and owner (A-G5-02) whether the per-bar label should be the internal LT-FG lot label with "STATUS AT PRINT: QUARANTINE" or a consumer-pack label. This is a decision, not a UI tweak.
6. **One QA rule.** Make `/quality/check/[batchId]` and `/quality/batches/[batchId]` read the same `canRelease` result (same blocking reasons, same wording). Remove "Type the tests on the full QA review page" by adding the hand-entry test row to the check page. Put a green button inside the "What to do next" box.
7. **Weigh: no typed code.** Replace "Last 4 of the lot on the label" plus the hex keypad with a scan button (camera), keeping "type it" under More details for a damaged label (`/production/orders/[workOrderId]/weigh`).
8. **One status vocabulary for orders.** Map work-order states to one set of words (Draft / Approved / In progress / Quality check / Done) in a shared helper, and use it on `/production/work-orders`, `/production/board` (and the board's move-select labels "Plan work order", "Release and reserve materials") and `/production/orders`.
9. **Step names and descriptions from configuration**: add a plain-words "operator name" and "operator description" to routing steps, or a glossary substitution (line clearance → "clean-area check", transfer to quarantine → "move to the hold area", disposition → "QA decision", reconcile/destroyed → "count/spoiled"). Seed data in `src/db/seed*.ts` should use them. The routing wording itself is configuration owned by QA, so flag it for their review.
10. **Hub: one green button.** Make the per-batch "Weigh" buttons secondary, and make the daily-log Save secondary or fold it under "What happened today?". Fix the stepper wrap ("Approv/ed") with shorter labels or a vertical stepper on phones. Remove or relabel "Open the full batch record" and "full order record" so they do not lead into old screens.
11. **Planner Home**: give `production_planner` the per-role dashboard (ADR-081/086) with an intro sentence and next step (orders to plan, approved orders without a batch). Currently it falls back to the old tile page (`src/app/(app)/dashboard`).
12. **Data and logic issues for the QA screens**: don't create batch inspections before Finish (or hide them from "waiting to start" until the batch is in QA); block CAPA creation from a deviation still "New", or show the deviation as "QA is looking into it"; make the lot page supplier match the receipt; make the "Quality check" nav badge count batches only, or label it "11 to check (9 lots, 2 batches)".
13. **Phone tap targets**: name links in `/production/orders` lists (17–25 px), "My work" link on Home (17 px), checkboxes in forms (20 px), radio buttons on `/quality/holds/new` (13 px), lot links in the QA review (14–20 px), and 34 px buttons on CAPA/maintenance/production new. All should be at least 44 px.
14. **Names before codes**: `/production`, `/production/board`, `/production/new`, the old order list/form, area chips on `/quality/label-verification`, `(CUS-00x)` in complaint pickers, code glued to the name in the My work list ("2 batchesWO-26-00002": missing separator).
15. **Missing intros or empty states**: `/production/defects` (add intro, and an empty state saying who writes rejects and where), `/production/today` (title should be "Today's count", as in the nav), `/quality/deviations/new` (h1 plus intro).
16. **Restrict `/production/[batchId]/closure` to QA/manager** (server permission check plus a negative test). The operator can currently open it.
