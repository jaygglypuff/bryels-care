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
