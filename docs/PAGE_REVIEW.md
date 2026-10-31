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
| `/maintenance` | ☐ | |
| `/maintenance/plans/[planId]` | ☐ | |
| `/maintenance/plans/new` | ☐ | |
| `/maintenance/plans` | ☐ | |
| `/maintenance/spare-parts` | ☐ | |
| `/maintenance/work-orders/[workOrderId]` | ☐ | |
| `/maintenance/work-orders/new` | ☐ | |
| `/maintenance/work-orders` | ☐ | |

## Setup (master data, recipes) (38)

| Screen | Status | Notes |
|---|---|---|
| `/masterdata/equipment/[id]` | ☑ | name first, code grey, plain kind words, PageIntro (2026-10-31) |
| `/masterdata/equipment/new` | ☑ | 3 visible fields (name, kind, making area); EQP- number; dates and rules under More details |
| `/masterdata/equipment` | ☑ | name first, plain kinds, 'Can it be used?', empty state with button |
| `/masterdata/formulas/[id]` | ☐ | |
| `/masterdata/formulas/[id]/revisions/[revisionId]` | ☐ | |
| `/masterdata/formulas/new` | ☐ | |
| `/masterdata/formulas` | ☐ | |
| `/masterdata/inspection-plans/[id]` | ☑ | "Quality checks" wording, name first, version Explain; test codes optional (made from names), extras under More details |
| `/masterdata/inspection-plans/new` | ☑ | 2 visible fields (which item, when); name and QCP- number by the system |
| `/masterdata/inspection-plans` | ☑ | renamed Quality checks, name first, empty state with button |
| `/masterdata/lines/[id]` | ☑ | Making area / line; name + team visible; code and notes under More details |
| `/masterdata/lines` | ☑ | Making areas; add = name (+ team, site only if >1); LINE- number |
| `/masterdata/lists` | ☑ | renamed Choice lists, PageIntro (codes were already automatic) |
| `/masterdata/locations/[id]` | ☑ | name first; name, type, inside visible; code/section/pickable under More details |
| `/masterdata/locations` | ☑ | name first, code grey; add = name, type, inside (warehouse only if >1); LOC- number |
| `/masterdata/materials/[id]` | ☑ | name first, See stock button, same 3-question form; status changes folded |
| `/masterdata/materials/new` | ☑ | 3 questions (name, kind buttons, buy/count buttons) + usual supplier and pack; rest under More details with defaults by kind |
| `/masterdata/materials` | ☑ | name first, kind, unit, stock links to /inventory/items/material/<id>; extra filters folded |
| `/masterdata/products/[id]` | ☐ | |
| `/masterdata/products/[id]/skus/[skuId]` | ☐ | |
| `/masterdata/products` | ☐ | |
| `/masterdata/reason-codes/[id]` | ☑ | renamed Reasons; words + where offered + note; code read-only under More details |
| `/masterdata/reason-codes` | ☑ | renamed Reasons; add = words + where; code made from the words |
| `/masterdata/routings/[id]` | ☐ | |
| `/masterdata/routings/[id]/revisions/[revisionId]` | ☐ | |
| `/masterdata/routings/new` | ☐ | |
| `/masterdata/routings` | ☐ | |
| `/masterdata/sites/[id]` | ☑ | name first; name, address, city visible; code/time zone under More details; teams by name only (DEP-) |
| `/masterdata/sites` | ☑ | add = name (+ address, city); site code made from the name's initials |
| `/masterdata/suppliers/[id]` | ☑ | name first, plain labels (pay within, order to delivery, QA status), materials by name |
| `/masterdata/suppliers/new` | ☑ | 4 visible fields (name, contact, phone, email); SUP- number; rest under More details |
| `/masterdata/suppliers` | ☑ | name first, code grey, plain columns, empty state says what to do |
| `/masterdata/uom` | ☑ | renamed Units; add = name + what it measures; short name made from the name |
| `/masterdata/warehouses/[id]` | ☑ | name first, special places by name, code under More details |
| `/masterdata/warehouses` | ☑ | add = name + what is kept (site only if >1); WH- number |
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
| `/production/[batchId]/closure` | ☐ | |
| `/production/[batchId]/finish` | ☐ | |
| `/production/[batchId]` | ☐ | |
| `/production/board` | ☐ | |
| `/production/defects` | ☐ | |
| `/production/new` | ☐ | |
| `/production/orders/[workOrderId]/materials` | ☐ | |
| `/production/orders/[workOrderId]` | ☐ | |
| `/production/orders/[workOrderId]/step/[n]` | ☐ | |
| `/production/orders/[workOrderId]/weigh` | ☐ | |
| `/production/orders/new` | ☐ | |
| `/production/orders` | ☐ | |
| `/production` | ☐ | |
| `/production/plan/[planId]` | ☐ | |
| `/production/plan` | ☐ | |
| `/production/staging/[batchId]` | ☐ | |
| `/production/staging` | ☐ | |
| `/production/today` | ☐ | |
| `/production/work-orders/[workOrderId]` | ☐ | |
| `/production/work-orders/new` | ☐ | |
| `/production/work-orders` | ☐ | |

## Quality (30)

| Screen | Status | Notes |
|---|---|---|
| `/quality/batches/[batchId]` | ☐ | |
| `/quality/bulk` | ☐ | |
| `/quality/capa/[capaId]` | ☐ | |
| `/quality/capa/new` | ☐ | |
| `/quality/capa` | ☐ | |
| `/quality/changes/[changeId]` | ☐ | |
| `/quality/changes/new` | ☐ | |
| `/quality/changes` | ☐ | |
| `/quality/check/[batchId]` | ☐ | |
| `/quality/check` | ☐ | |
| `/quality/complaints/[complaintId]` | ☐ | |
| `/quality/complaints/new` | ☐ | |
| `/quality/complaints` | ☐ | |
| `/quality/deviations/[deviationId]` | ☐ | |
| `/quality/deviations/new` | ☐ | |
| `/quality/deviations` | ☐ | |
| `/quality/holds/[holdId]` | ☐ | |
| `/quality/holds/issue` | ☐ | |
| `/quality/holds/new` | ☐ | |
| `/quality/holds` | ☐ | |
| `/quality/inspections/[inspectionId]` | ☐ | |
| `/quality/inspections` | ☐ | |
| `/quality/label-verification` | ☐ | |
| `/quality/lots/[lotId]` | ☐ | |
| `/quality` | ☐ | |
| `/quality/recall` | ☐ | |
| `/quality/recalls/[recallId]` | ☐ | |
| `/quality/recalls/new` | ☐ | |
| `/quality/recalls` | ☐ | |
| `/quality/trace` | ☐ | |

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
