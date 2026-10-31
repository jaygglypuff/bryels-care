# Page-by-page review (grade-5 standard, ADR-088)

Every screen is checked against the standard below. Status: ☐ not yet · ◐ in progress · ☑ done (date).

## The standard

1. One sentence under the title: what this screen is for (`PageIntro`).
2. Forms: at most 5 fields visible; everything else has a default and sits under "More details" (`MoreDetails`).
3. Never type a code: the system makes every code (editable only under More details).
4. One green button for the next step (`NextStep` on records); secondary actions in "⋯ More".
5. Grade-5 words (glossary in `docs/USABILITY_TEST.md` and `docs/CONSULTANT_REVIEW.md` §5); "What is this?" (`Explain`) for the six kept words.
6. Works on a phone (390 px): no sideways scroll, nothing covered, buttons ≥ 44 px.
7. Empty, loading and error states say what to do and who to ask.

Total screens: 250.

## Home (10)

| Screen | Status | Notes |
|---|---|---|
| `/account` | ☐ | |
| `/action-centre` | ☐ | |
| `/approvals` | ☐ | |
| `/dashboard/details/batches` | ☐ | |
| `/dashboard/details/stock` | ☐ | |
| `/dashboard` | ☐ | |
| `/notifications` | ☐ | |
| `/sync/conflicts/[id]` | ☐ | |
| `/sync/conflicts` | ☐ | |
| `/sync` | ☐ | |

## Settings & people (29)

| Screen | Status | Notes |
|---|---|---|
| `/admin/approval-rules` | ☐ | |
| `/admin/audit` | ☐ | |
| `/admin/demo` | ☐ | |
| `/admin/devices` | ☐ | |
| `/admin/diagnostics` | ☐ | |
| `/admin/imports/[id]` | ☐ | |
| `/admin/imports/legacy-documents` | ☐ | |
| `/admin/imports` | ☐ | |
| `/admin/notification-rules` | ☐ | |
| `/admin/numbering` | ☐ | |
| `/admin` | ☐ | |
| `/admin/retention` | ☐ | |
| `/admin/roles/[id]/clone` | ☐ | |
| `/admin/roles/[id]` | ☐ | |
| `/admin/roles` | ☐ | |
| `/admin/security` | ☐ | |
| `/admin/sessions` | ☐ | |
| `/admin/settings` | ☐ | |
| `/admin/templates/[id]` | ☐ | |
| `/admin/templates/labels/[id]` | ☐ | |
| `/admin/templates/labels/new` | ☐ | |
| `/admin/templates/new` | ☐ | |
| `/admin/templates` | ☐ | |
| `/admin/templates/stations` | ☐ | |
| `/admin/users/[id]` | ☐ | |
| `/admin/users/invite` | ☐ | |
| `/admin/users` | ☐ | |
| `/documents/[id]` | ☐ | |
| `/management` | ☐ | |

## Reports (12)

| Screen | Status | Notes |
|---|---|---|
| `/analytics/[area]` | ☐ | |
| `/analytics/definitions` | ☐ | |
| `/analytics/kpi/[code]` | ☐ | |
| `/analytics/overview` | ☐ | |
| `/analytics` | ☐ | |
| `/analytics/trends` | ☐ | |
| `/reports/[code]` | ☐ | |
| `/reports` | ☐ | |
| `/reports/runs/[runId]` | ☐ | |
| `/reports/schedules/[id]` | ☐ | |
| `/reports/schedules/new` | ☐ | |
| `/reports/schedules` | ☐ | |

## Finance (19)

| Screen | Status | Notes |
|---|---|---|
| `/finance/bills/[id]` | ☐ | |
| `/finance/bills/new` | ☐ | |
| `/finance/bills` | ☐ | |
| `/finance/credit-notes/[id]` | ☐ | |
| `/finance/credit-notes/new` | ☐ | |
| `/finance/credit-notes` | ☐ | |
| `/finance/expenses/[id]` | ☐ | |
| `/finance/expenses/new` | ☐ | |
| `/finance/expenses` | ☐ | |
| `/finance/invoices/[id]` | ☐ | |
| `/finance/invoices` | ☐ | |
| `/finance` | ☐ | |
| `/finance/payments/[id]` | ☐ | |
| `/finance/payments/new` | ☐ | |
| `/finance/payments` | ☐ | |
| `/finance/periods` | ☐ | |
| `/finance/statements/[customerId]` | ☐ | |
| `/finance/statements` | ☐ | |
| `/finance/tax` | ☐ | |

## Home & help (1)

| Screen | Status | Notes |
|---|---|---|
| `/help` | ☐ | |

## Inventory & warehouse (38)

| Screen | Status | Notes |
|---|---|---|
| `/inventory/[lotId]/move` | ☐ | |
| `/inventory/[lotId]` | ☐ | |
| `/inventory/adjustments/[id]` | ☐ | |
| `/inventory/adjustments/new` | ☐ | |
| `/inventory/adjustments` | ☐ | |
| `/inventory/availability` | ☐ | |
| `/inventory/containers/[id]` | ☐ | |
| `/inventory/containers/new` | ☐ | |
| `/inventory/containers` | ☐ | |
| `/inventory/counts/[id]` | ☐ | |
| `/inventory/counts/[id]/sheet` | ☐ | |
| `/inventory/counts` | ☐ | |
| `/inventory/items/[kind]/[id]` | ☐ | |
| `/inventory/locations/[id]` | ☐ | |
| `/inventory/locations` | ☐ | |
| `/inventory/lots/[lotId]/edit` | ☐ | |
| `/inventory/lots/expiry` | ☐ | |
| `/inventory/lots` | ☐ | |
| `/inventory/lots/reservations` | ☐ | |
| `/inventory/move` | ☐ | |
| `/inventory/movements/[id]` | ☐ | |
| `/inventory/movements` | ☐ | |
| `/inventory` | ☐ | |
| `/inventory/receipts` | ☐ | |
| `/inventory/receive/[grId]/edit` | ☐ | |
| `/inventory/receive/[grId]` | ☐ | |
| `/inventory/receive` | ☐ | |
| `/inventory/receive/put-away` | ☐ | |
| `/inventory/scan` | ☐ | |
| `/inventory/stock-card/[lotId]` | ☐ | |
| `/inventory/wip` | ☐ | |
| `/labels/jobs/[jobId]` | ☐ | |
| `/labels/new` | ☐ | |
| `/labels` | ☐ | |
| `/warehouse/packs/[packId]` | ☐ | |
| `/warehouse/packs` | ☐ | |
| `/warehouse` | ☐ | |
| `/warehouse/repack` | ☐ | |

## Maintenance (8)

| Screen | Status | Notes |
|---|---|---|
| `/maintenance` | ☑ 2026-10-31 | Intro; next step = late maintenance or open repair job; plain KPIs; name-first lists; secondary links in ⋯ More. |
| `/maintenance/plans/[planId]` | ☑ 2026-10-31 | "Machine: what to do" title, number small; next step = make the job; pause/stop in ⋯ More; edit folded. |
| `/maintenance/plans/new` | ☑ 2026-10-31 | "Plan new regular maintenance": 5 fields (machine, what, every N days default 30, who, steps); rest under More details. |
| `/maintenance/plans` | ☑ 2026-10-31 | "Regular maintenance"; name-first list with due chips (Late/Due soon); 44 px filter tabs. |
| `/maintenance/spare-parts` | ☑ 2026-10-31 | Name-first list, "running low" + next step to reorder; add form folded, 2 visible fields, site hidden when one. |
| `/maintenance/work-orders/[workOrderId]` | ☑ 2026-10-31 | "Repair job": next step Start / The job is done / waiting for technician (+ who can help); pause/cancel in ⋯ More. |
| `/maintenance/work-orders/new` | ☑ 2026-10-31 | "Report a broken machine": 5 fields (machine, what is wrong, urgency, technician, broken now); rest folded. |
| `/maintenance/work-orders` | ☑ 2026-10-31 | "Repair jobs"; machine + problem first, number grey; status/urgency chips with icons. |

## Setup (master data, recipes) (38)

| Screen | Status | Notes |
|---|---|---|
| `/masterdata/equipment/[id]` | ☐ | |
| `/masterdata/equipment/new` | ☐ | |
| `/masterdata/equipment` | ☐ | |
| `/masterdata/formulas/[id]` | ☐ | |
| `/masterdata/formulas/[id]/revisions/[revisionId]` | ☐ | |
| `/masterdata/formulas/new` | ☐ | |
| `/masterdata/formulas` | ☐ | |
| `/masterdata/inspection-plans/[id]` | ☐ | |
| `/masterdata/inspection-plans/new` | ☐ | |
| `/masterdata/inspection-plans` | ☐ | |
| `/masterdata/lines/[id]` | ☐ | |
| `/masterdata/lines` | ☐ | |
| `/masterdata/lists` | ☐ | |
| `/masterdata/locations/[id]` | ☐ | |
| `/masterdata/locations` | ☐ | |
| `/masterdata/materials/[id]` | ☐ | |
| `/masterdata/materials/new` | ☐ | |
| `/masterdata/materials` | ☐ | |
| `/masterdata/products/[id]` | ☐ | |
| `/masterdata/products/[id]/skus/[skuId]` | ☐ | |
| `/masterdata/products` | ☐ | |
| `/masterdata/reason-codes/[id]` | ☐ | |
| `/masterdata/reason-codes` | ☐ | |
| `/masterdata/routings/[id]` | ☐ | |
| `/masterdata/routings/[id]/revisions/[revisionId]` | ☐ | |
| `/masterdata/routings/new` | ☐ | |
| `/masterdata/routings` | ☐ | |
| `/masterdata/sites/[id]` | ☐ | |
| `/masterdata/sites` | ☐ | |
| `/masterdata/suppliers/[id]` | ☐ | |
| `/masterdata/suppliers/new` | ☐ | |
| `/masterdata/suppliers` | ☐ | |
| `/masterdata/uom` | ☐ | |
| `/masterdata/warehouses/[id]` | ☐ | |
| `/masterdata/warehouses` | ☐ | |
| `/masterdata/work-instructions/[id]` | ☐ | |
| `/masterdata/work-instructions/new` | ☐ | |
| `/masterdata/work-instructions` | ☐ | |

## Operations (2)

| Screen | Status | Notes |
|---|---|---|
| `/operations` | ☐ | |
| `/floor` | ☐ | |

## Purchasing (17)

| Screen | Status | Notes |
|---|---|---|
| `/procurement/expected/[poId]` | ☐ | |
| `/procurement/expected` | ☐ | |
| `/procurement/forecast` | ☐ | |
| `/procurement/orders/[id]` | ☐ | |
| `/procurement/orders/new` | ☐ | |
| `/procurement/orders` | ☐ | |
| `/procurement` | ☐ | |
| `/procurement/performance` | ☐ | |
| `/procurement/reorder` | ☐ | |
| `/procurement/requests/[id]` | ☐ | |
| `/procurement/requests/new` | ☐ | |
| `/procurement/requests` | ☐ | |
| `/procurement/returns/[id]` | ☐ | |
| `/procurement/returns/new` | ☐ | |
| `/procurement/returns` | ☐ | |
| `/procurement/suppliers/[id]` | ☐ | |
| `/procurement/suppliers` | ☐ | |

## Production (21)

| Screen | Status | Notes |
|---|---|---|
| `/production/[batchId]/closure` | ☑ 2026-10-31 | Intro; check names in plain words (QA decision, problem reports, pieces made, batch record); button "Close the batch and make the final batch record". |
| `/production/[batchId]/finish` | ☑ 2026-10-31 | Intro; rejects folded under "Any rejects?" (good pieces, samples, left-over wrappers visible); wrappers reconcile; "Open this batch's labels" (ADR-088 §3). |
| `/production/[batchId]` | ☑ 2026-10-31 | Batch full record: intro + "What is this?" for batch record (BMR); yield/theoretical/tolerance/dispense words replaced; planned batch button now "Get materials"; readable audit lines for finish and label lot. |
| `/production/board` | ☑ 2026-10-31 | Intro; 6 filters folded under "Filter the board"; footer in plain words; columns scroll inside the board only. |
| `/production/defects` | ☑ 2026-10-31 | Rejects: intro; subtitle shortened. |
| `/production/new` | ☑ 2026-10-31 | New batch: intro (system numbers it); "work order" → "production order". |
| `/production/orders/[workOrderId]/materials` | ☑ 2026-10-31 | Get materials: title and intro; wrappers/labels listed under Packaging with lot, shelf, pieces and "for wrapping (not weighed)"; "What is this?" for lot (ADR-088 §3). |
| `/production/orders/[workOrderId]` | ☑ 2026-10-31 | Order hub: intro; next-step card already one green button; planned batch opens Get materials; daily log rejects folded. |
| `/production/orders/[workOrderId]/step/[n]` | ☑ 2026-10-31 | Step cards: plain one-line subtitle per step kind (step names stay configuration); packaging step shows the taken wrapper lot, "How many did you use?/spoiled?", "Print labels for this batch (N labels)"; no scan. |
| `/production/orders/[workOrderId]/weigh` | ☑ 2026-10-31 | Weigh: intro ("weigh out"); wrappers never on this screen. |
| `/production/orders/new` | ☑ 2026-10-31 | New production order: intro; 3 fields + product, the rest under More details; system numbers the order. |
| `/production/orders` | ☑ 2026-10-31 | Orders / My work: intro per role. |
| `/production` | ☑ 2026-10-31 | Batches list: intro; "Awaiting QC" → "Quality check". |
| `/production/plan/[planId]` | ☑ 2026-10-31 | Plan: intro; "work order" → "production order". |
| `/production/plan` | ☑ 2026-10-31 | Plan list: intro; words. |
| `/production/staging/[batchId]` | ☑ 2026-10-31 | Older scan staging: intro says most sites use Get materials; words. |
| `/production/staging` | ☑ 2026-10-31 | Older scan staging list: intro; words. |
| `/production/today` | ☑ 2026-10-31 | Today's count: intro; subtitle shortened. |
| `/production/work-orders/[workOrderId]` | ☑ 2026-10-31 | Older order view: intro points to Production orders; "work order" → "production order" in all visible text. |
| `/production/work-orders/new` | ☑ 2026-10-31 | Older order form: intro; words. |
| `/production/work-orders` | ☑ 2026-10-31 | Older list: intro; words. |

## Quality (30)

| Screen | Status | Notes |
|---|---|---|
| `/quality/batches/[batchId]` | ☑ 2026-10-31 | Product first; next step (start tests / decide); weighing, tests, history as phone lists; OK to use / Not OK; OK with conditions folded. |
| `/quality/bulk` | ☑ 2026-10-31 | "Decide many lots at once": filter folded, name-first tick list, note folded, password kept. |
| `/quality/capa/[capaId]` | ☑ 2026-10-31 | "Fix-and-prevent plan": next step by state; things to do (fix now / prevent) with who and date; cancel in ⋯ More. |
| `/quality/capa/new` | ☑ 2026-10-31 | 4 visible fields (short name, problem, who looks after it = me, finish by); source/site folded, no code. |
| `/quality/capa` | ☑ 2026-10-31 | "Fix-and-prevent plans"; title first, number grey; download in ⋯ More. |
| `/quality/changes/[changeId]` | ☑ 2026-10-31 | "Change request": next step by state (write effects, send, decide, make, confirm); cancel in ⋯ More. |
| `/quality/changes/new` | ☑ 2026-10-31 | 4 visible fields (short name, what changes, what, why); version link, site, date folded. |
| `/quality/changes` | ☑ 2026-10-31 | "Change requests"; title first; plain status chips with icons. |
| `/quality/check/[batchId]` | ☑ 2026-10-31 | Product first; next step; OK to use / Not yet / Not OK – don't use; note folded; maker/tester rules kept. |
| `/quality/check` | ☑ 2026-10-31 | "Batches waiting for QA check"; next step to the oldest; batch number grey. |
| `/quality/complaints/[complaintId]` | ☑ 2026-10-31 | "Complaint from <customer>": next step by state; trace, letter, plan, return in ⋯ More. |
| `/quality/complaints/new` | ☑ 2026-10-31 | 5 visible fields (customer, kind, product, label number optional, what they say); rest folded. |
| `/quality/complaints` | ☑ 2026-10-31 | Customer + problem first; plain status ("New – QA to look", "Answered – to close"). |
| `/quality/deviations/[deviationId]` | ☑ 2026-10-31 | "Problem report": next step (start looking / close); stop a lot folded; plan in ⋯ More. |
| `/quality/deviations/new` | ☑ 2026-10-31 | "Report a problem": 2 fields (step, what happened). |
| `/quality/deviations` | ☑ 2026-10-31 | "Problem reports"; what happened first; download in ⋯ More. |
| `/quality/holds/[holdId]` | ☑ 2026-10-31 | "Stopped by QA: <item>": next step let go / not OK (second QA person); lots as list. |
| `/quality/holds/issue` | ☑ 2026-10-31 | "Take out stopped stock": lot picked by name (scan folded); exception banner kept. |
| `/quality/holds/new` | ☑ 2026-10-31 | "Stop a lot": lot picked by name (scan folded), 4 fields. |
| `/quality/holds` | ☑ 2026-10-31 | "Stopped by QA" list; exception screen in ⋯ More. |
| `/quality/inspections/[inspectionId]` | ☑ 2026-10-31 | "Quality check: <item>": next step by state; samples list; Is it OK?; second-person check kept; cancel in ⋯ More. |
| `/quality/inspections` | ☑ 2026-10-31 | "Quality checks (tests)"; item first; plain states. |
| `/quality/label-verification` | ☑ 2026-10-31 | "Check the labels in an area": next step, 44 px area chips, scan field. |
| `/quality/lots/[lotId]` | ☑ 2026-10-31 | Item first; next step "decide"; only fitting choices; OK to use / Stop / Not OK; history as list. |
| `/quality` | ☑ 2026-10-31 | QA queue: next step to the oldest batch/lot; name-first lists; older decisions folded; other screens in ⋯ More. |
| `/quality/recall` | ☑ 2026-10-31 | "Who received it": pick the product by name (scan folded); customers list; details folded; start recall = green. |
| `/quality/recalls/[recallId]` | ☑ 2026-10-31 | "Product recall": next step per state; lots and customers as lists; downloads/cancel in ⋯ More. |
| `/quality/recalls/new` | ☑ 2026-10-31 | 3 visible fields (kind, short name, why); class and obligations folded. |
| `/quality/recalls` | ☑ 2026-10-31 | "Product recalls"; title first; plain status chips. |
| `/quality/trace` | ☑ 2026-10-31 | "Where it came from and where it went": pick by name; scan/supplier lot folded; customers list. |

## Sales & customers (25)

| Screen | Status | Notes |
|---|---|---|
| `/sales/[orderId]` | ☐ | |
| `/sales/board` | ☐ | |
| `/sales/customers/[id]` | ☐ | |
| `/sales/customers/new` | ☐ | |
| `/sales/customers` | ☐ | |
| `/sales/dispatch` | ☐ | |
| `/sales/new` | ☐ | |
| `/sales/orders/[orderId]/edit` | ☐ | |
| `/sales/packing/[shipmentId]` | ☐ | |
| `/sales` | ☐ | |
| `/sales/picking/[pickId]` | ☐ | |
| `/sales/picking` | ☐ | |
| `/sales/price-lists/[id]/edit` | ☐ | |
| `/sales/price-lists/[id]` | ☐ | |
| `/sales/price-lists/new` | ☐ | |
| `/sales/price-lists` | ☐ | |
| `/sales/quotations/[id]/edit` | ☐ | |
| `/sales/quotations/[id]` | ☐ | |
| `/sales/quotations/new` | ☐ | |
| `/sales/quotations` | ☐ | |
| `/sales/returns/[returnId]` | ☐ | |
| `/sales/returns/new` | ☐ | |
| `/sales/returns` | ☐ | |
| `/sales/shipments/[shipmentId]` | ☐ | |
| `/sales/shipments` | ☐ | |
