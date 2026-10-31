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
| `/finance/bills/[id]` | ☑ 2026-10-31 | Supplier first; next step by state (check against order and delivery, approve, save to the books, pay); match results in words; cancel / cancel (kept on record) in ⋯ More; password kept. |
| `/finance/bills/new` | ☑ 2026-10-31 | Supplier, delivery, their bill number (from their paper), date, prices; kind and note folded; our number automatic. |
| `/finance/bills` | ☑ 2026-10-31 | "Supplier bills" (money we owe): supplier first, ₱ right, plain status chips; "does not match" next step. |
| `/finance/credit-notes/[id]` | ☑ 2026-10-31 | "Credit (money back)": next step by state; save to the books with password; cancels in ⋯ More. |
| `/finance/credit-notes/new` | ☑ 2026-10-31 | 3 visible fields (why, explain, how much); customer return and whole-invoice credit folded. |
| `/finance/credit-notes` | ☑ 2026-10-31 | "Credits (money back)": customer first, amount right; empty state says start from the invoice. |
| `/finance/expenses/[id]` | ☑ 2026-10-31 | Person first; next step (add receipt, send, decide, save to the books, pay back); take back / cancel in ⋯ More. |
| `/finance/expenses/new` | ☑ 2026-10-31 | "Claim money I spent": 4 fields (what for, how much, when = today, kind); site folded (default current). |
| `/finance/expenses` | ☑ 2026-10-31 | Person first, ₱ right, plain claim states; next step for approvers. |
| `/finance/invoices/[id]` | ☑ 2026-10-31 | Customer first; next step by state (send, approve, save to the books, record payment); items as rows; credit, print, cancels in ⋯ More; password kept. |
| `/finance/invoices` | ☑ 2026-10-31 | Customer first, ₱ right; deliveries without an invoice folded after 3; plain states (sent – not paid yet, late). |
| `/finance` | ☑ 2026-10-31 | "Money": money customers owe us / money we owe, "how late" buckets, next step, money screens with plain names. |
| `/finance/payments/[id]` | ☑ 2026-10-31 | Name first, money in/out; what it pays; save to the books with password; cancels in ⋯ More. |
| `/finance/payments/new` | ☑ 2026-10-31 | 4 visible fields (who, how much, when = today, how) + which invoices (oldest first); references, withheld, note folded. |
| `/finance/payments` | ☑ 2026-10-31 | Name first with in/out arrow, ₱ right, "kept for later" amount. |
| `/finance/periods` | ☑ 2026-10-31 | "Close the month": month names, next step (close last month / decide reopen), older months folded; password and open-papers check kept. |
| `/finance/statements/[customerId]` | ☑ 2026-10-31 | "They owe us" big, how-late buckets, unpaid invoices as rows, print as next step; other day in ⋯ More. |
| `/finance/statements` | ☑ 2026-10-31 | Customer search, name first, amount owed right (largest first). |
| `/finance/tax` | ☑ 2026-10-31 | "Tax rates": rows in words; add-rate form 4 fields + password; code picked or made from the name (never typed); second-person check kept. |

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
| `/procurement/expected/[poId]` | ☑ 2026-10-31 | Redirect only (to Receive with the order filled in); no screen of its own. |
| `/procurement/expected` | ☑ 2026-10-31 | "Deliveries coming": supplier first, due date right, row opens Receive; late next step. |
| `/procurement/forecast` | ☑ 2026-10-31 | "Sales guess": product first, guess in words, quality folded; change-a-guess form 4 fields, site folded; second-person approval kept. |
| `/procurement/orders/[id]` | ☑ 2026-10-31 | Supplier first; next step by state (send for approval, approve, send to supplier, receive); items as rows with ₱; print, supplier answer, close, cancel in ⋯ More. |
| `/procurement/orders/new` | ☑ 2026-10-31 | 4-step wizard: supplier by name with search → items (friendly units, pack/price shown) → arrival date (lead-time default) → check and send; extras folded; number automatic. |
| `/procurement/orders` | ☑ 2026-10-31 | Supplier first, ₱ right, plain states; search; download in ⋯ More. |
| `/procurement` | ☑ 2026-10-31 | "Purchasing": next step, plain tiles, late deliveries as rows. |
| `/procurement/performance` | ☑ 2026-10-31 | "How suppliers do": one row per supplier, plain measures; "no data yet" never 0 %. |
| `/procurement/reorder` | ☑ 2026-10-31 | "Running low": buy-about sentence per item, friendly-unit amount, hide with reason; minimums form folded (friendly units); check again in ⋯ More. |
| `/procurement/requests/[id]` | ☑ 2026-10-31 | "Request to buy": items as title; next step (send, decide, make purchase order); cancel in ⋯ More. |
| `/procurement/requests/new` | ☑ 2026-10-31 | "Ask to buy something": item by name, how much (friendly units), needed by (+7 days), why; supplier/price folded. |
| `/procurement/requests` | ☑ 2026-10-31 | "Requests to buy": items first, who asked, estimate right. |
| `/procurement/returns/[id]` | ☑ 2026-10-31 | "Return to supplier": next step (add lots, approve, goods left); add a lot with 2 fields; cancel in ⋯ More. |
| `/procurement/returns/new` | ☑ 2026-10-31 | Supplier by name with search; why + explain; delivery and their return number folded. |
| `/procurement/returns` | ☑ 2026-10-31 | "Send back to supplier": supplier first, money back right. |
| `/procurement/suppliers/[id]` | ☑ 2026-10-31 | Supplier with plain status; items with QA yes/no; price/minimum/days form 5 visible fields; "order from this supplier" next step. |
| `/procurement/suppliers` | ☑ 2026-10-31 | "Suppliers we may buy from": waiting for QA as rows, search, plain supplier status. |

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
