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
| `/account` | ☑ 2026-10-31 | Intro; “needs the owner's OK” wording; password, phone code and sign-ins unchanged. |
| `/action-centre` | ☑ 2026-10-31 | “Problems & alerts”: plain tabs (To decide, Problems, Alerts for you, Phone changes to check), 44 px tabs, title first/number grey, “I'm on it”; message rules in ⋯ More. |
| `/approvals` | ☑ 2026-10-31 | Next step opens the oldest decision; title first, number grey; Problems & alerts in ⋯ More; owner banner in plain words. |
| `/dashboard/details/batches` | ☑ 2026-10-31 | Intro (“Done” = QA OK); back to Home. |
| `/dashboard/details/stock` | ☑ 2026-10-31 | “Stock to look at”: running low / use first / stopped by QA. |
| `/dashboard` | ☑ 2026-10-31 | Per-role intro sentence (owner, site manager, QA, sales, finance, operator, warehouse); ADR-081/082/083/086 layout and attentionItems kept; plain words (stopped by QA, QA check, See every step, Full history of changes); link to Reports. |
| `/notifications` | ☑ 2026-10-31 | Intro; “I'm on it” instead of Acknowledge. |
| `/sync/conflicts/[id]` | ☑ 2026-10-31 | “Phone change to check”: next step to the choice, on the phone / in the system now. |
| `/sync/conflicts` | ☑ 2026-10-31 | “Phone changes to check”, intro. |
| `/sync` | ☑ 2026-10-31 | “Working without signal”, intro. |

## Settings & people (29)

| Screen | Status | Notes |
|---|---|---|
| `/admin/approval-rules` | ☑ 2026-10-31 | “Who says OK to what”: 5 visible fields (what, when, more than, who, why) + password; rest folded; plain record types and roles. |
| `/admin/audit` | ☑ 2026-10-31 | “History of changes”: area + record number search, sentences; technical name and before/after folded. |
| `/admin/demo` | ☑ 2026-10-31 | Intro (demo only, real data never touched). |
| `/admin/devices` | ☑ 2026-10-31 | “Phones and tablets”; 44 px filter chips. |
| `/admin/diagnostics` | ☑ 2026-10-31 | “Health of the system” (IT only); tables scroll inside their card. |
| `/admin/imports/[id]` | ☑ 2026-10-31 | Next step by status; columns preview folded; rows as a list (phone); “Save … rows for good”; permission names folded. |
| `/admin/imports/legacy-documents` | ☑ 2026-10-31 | “Old paper documents”: one card per scan, product first. |
| `/admin/imports` | ☑ 2026-10-31 | “Load data from a spreadsheet”: saved matching picked from a list (no typed code); files as list; templates as 44 px buttons; legacy docs in ⋯ More. |
| `/admin/notification-rules` | ☑ 2026-10-31 | “Who gets which message”: 4 visible fields; site, name, severity, email folded; Add a rule folded. |
| `/admin/numbering` | ☑ 2026-10-31 | “How record numbers look”: list with example; change form 4 fields; pattern/digits folded; waiting changes shown with OK. |
| `/admin` | ☑ 2026-10-31 | Redirects to People (/admin/users). |
| `/admin/retention` | ☑ 2026-10-31 | “Keeping and deleting old records”, plain card titles; tables scroll in card. |
| `/admin/roles/[id]/clone` | ☑ 2026-10-31 | “New job, copied from …”: name only; technical code made from the name (folded). |
| `/admin/roles/[id]` | ☑ 2026-10-31 | Plain role name; “What this job may do” as sentences per area; permission strings folded as technical names; stop/delete in ⋯ More. |
| `/admin/roles` | ☑ 2026-10-31 | Jobs as a list (Owner, Site manager, Machine operator…); permission matrix folded. |
| `/admin/security` | ☑ 2026-10-31 | “Sign-in safety”; assumption ids and permission names removed from view. |
| `/admin/sessions` | ☑ 2026-10-31 | “Who is signed in”; Can approve / Extra code checked chips. |
| `/admin/settings` | ☑ 2026-10-31 | One group at a time (chips), label + one sentence + “Now:”; key and assumption under Technical name; “Needs the owner's OK”; history folded; next step for waiting changes. |
| `/admin/templates/[id]` | ☑ 2026-10-31 | Layout name first, versions with plain status; next step for QA; JSON folded for IT. |
| `/admin/templates/labels/[id]` | ☑ 2026-10-31 | Label name first; next step (QA OK); printer details folded; stop in ⋯. |
| `/admin/templates/labels/new` | ☑ 2026-10-31 | Name (code made from it), for, size, printed fields; layout/barcode/copies/dpi folded. |
| `/admin/templates/new` | ☑ 2026-10-31 | What it is for + name; code made from the name. |
| `/admin/templates` | ☑ 2026-10-31 | “Labels and printouts”: labels and layouts as lists; printers and recent printouts folded; new layout/printers in ⋯ More. |
| `/admin/templates/stations` | ☑ 2026-10-31 | “Label printers”: name + printer name; code made from the name; in-use/notes folded. |
| `/admin/users/[id]` | ☑ 2026-10-31 | Next step (give a job / waiting for sign-in / unlock); plain role names; account actions in ⋯ More; permission strings folded. |
| `/admin/users/invite` | ☑ 2026-10-31 | “Add a person”: 4 fields; warehouse limit folded; plain job names. |
| `/admin/users` | ☑ 2026-10-31 | “People who use the app”: plain statuses and job names; roles/CSV in ⋯ More. |
| `/documents/[id]` | ☑ 2026-10-31 | Kind + number title; plain banners (cancelled, replaced). |
| `/management` | ☑ 2026-10-31 | Plain section texts; 44 px links. |

## Reports (12)

| Screen | Status | Notes |
|---|---|---|
| `/analytics/[area]` | ☑ 2026-10-31 | Plain titles (Making products, Stock numbers, Quality numbers, Sales numbers), intro, plain chart/list titles, no KPI codes. |
| `/analytics/definitions` | ☑ 2026-10-31 | “What each number means”; codes only as technical name. |
| `/analytics/kpi/[code]` | ☑ 2026-10-31 | Plain title, no code in subtitle; calculation folded. |
| `/analytics/overview` | ☑ 2026-10-31 | Intro; plain card titles (PLAIN_KPI); no codes in chart subtitles. |
| `/analytics` | ☑ 2026-10-31 | Reports landing: three tiles (sales 4 weeks, batches done, stock to look at), one weekly chart, What sells best (new read model getTopProducts), more reports in plain words. |
| `/analytics/trends` | ☑ 2026-10-31 | “Compare over time”: plain number names, 44 px checkboxes. |
| `/reports/[code]` | ☑ 2026-10-31 | Plain title; site + dates visible, other filters folded; Print green, Excel/CSV/email in ⋯ More; rows as cards on phones; definitions folded. |
| `/reports` | ☑ 2026-10-31 | “Lists to download or print”: plain names per area as list; planned lists folded. |
| `/reports/runs/[runId]` | ☑ 2026-10-31 | “Download” the emailed file; plain status. |
| `/reports/schedules/[id]` | ☑ 2026-10-31 | Plain summary; history as list; stop/start in ⋯ More. |
| `/reports/schedules/new` | ☑ 2026-10-31 | 4 visible fields (how often, day, time, who); name/sites/file type/filters folded. |
| `/reports/schedules` | ☑ 2026-10-31 | “Lists sent by email” as list. |

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
| `/help` | ☑ 2026-10-31 | Five role guides “Your day in 5 steps” (own role first), Words we use, task guides folded (/help#key opens them). |

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
| `/operations` | ☑ 2026-10-31 | Intro; From delivery to dispatch; product first on phone cards; 44 px site switch. |
| `/floor` | ☑ 2026-10-31 | TV header says what it is for (vw sizes; a TV, not a phone screen). |

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

## Notes from the Home, Settings & people, Reports and Help pass (2026-10-31)

- New read model `getTopProducts` (src/modules/analytics/top-products.ts) for "What sells best" on the Reports page: confirmed orders only (same rule as "Orders confirmed"), money masked like the order-value number, site-scoped; tests in `tests/integration/analytics/top-products.test.ts`.
- Shared grade-5 helpers: `src/ui/role-names.ts` (Owner, Site manager, Machine operator, Warehouse, QA, Sales, Finance; per-role Home sentence), `src/ui/permission-words.ts` (permission strings as "Stock: see, add, approve"; "Needs the owner's OK" for restricted), `src/ui/name-and-code.tsx` (codes made from names: roles, labels, layouts, printer places, column matchings).
- Help: five role guides (`docs/help/role-*.md`, "Your day in 5 steps") and `docs/help/words.md`; task guides stay (the "?" on screens and `/help#key`).
- Settings without a written description show their current value as the sentence; 118 of 170 settings in `src/lib/settings.ts` still need a one-sentence `description` from their module owner.
- Menu labels to rename in `nav.ts` (not changed here): "Dashboards" → "Reports", "Report library" → "Lists to download or print", "Scheduled reports" → "Lists sent by email", "Trends" → "Compare over time", "KPI definitions" → "What each number means", "Users" → "People", "Sessions" → "Who is signed in", "Security" → "Sign-in safety", "Audit log" → "History of changes", "Approval rules" → "Who says OK to what", "Numbering" → "How record numbers look", "Templates & labels" → "Labels and printouts", "Notification rules" → "Who gets which message", "Imports" → "Load data from a spreadsheet", "Legacy documents" → "Old paper documents", "Devices" → "Phones and tablets", "Sync conflicts" → "Phone changes to check", "Retention & holds" → "Keeping and deleting old records", "Diagnostics" → "Health of the system", "Sync & offline" → "Working without signal".
