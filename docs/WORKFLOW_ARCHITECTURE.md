# Workflow architecture: the connected pipeline

| | |
|---|---|
| Status | §2 built in slice R1 (ADR-081); §4 and §5 are the proposal for R3–R4 (owner approval needed) |
| Read with | `docs/data-model.md` (state machines), ADR-074/080 (production order), `docs/process-maps.md` |

## 1. The pipeline

```
Expected delivery → Receiving → Quality inspection → Raw materials available → Production
  → In-process checks → QC release → Packaging → Finished goods → Customer order → Dispatch
```

Each arrow is already a validated state transition in an existing module. The redesign does **not**
add a second status field: the pipeline is a read model over the records that already carry state.

| Stage | Record and states (existing state machine) | Moves on when | Screen that does the work |
|---|---|---|---|
| Expected deliveries | `purchase_orders`: approved, sent, partially_received (`PO_TRANSITIONS`) | a goods receipt is posted against it | `/procurement/expected` → Receive |
| Receiving | `goods_receipts`: draft (`RECEIPT_TRANSITIONS`) | Post (creates lots in quarantine, labels) | `/inventory/receipts?status=draft` |
| Awaiting inspection | `inventory_lots` kind material, `quarantine` (+ on_hold flagged) | QA releases or rejects (`LOT_TRANSITIONS`) | `/quality` |
| Raw materials available | material lots `released` with stock | weighed into a batch (ledger `postMovement`) | `/inventory?kind=material` |
| Production | `batches`: planned, materials_staged, in_process (`BATCH_TRANSITIONS`) | Finish | `/production/orders/[id]` (order hub, ADR-080) |
| Quality check | `batches`: awaiting_qc, quarantined | QA decision (release / reject / rework) | `/quality` |
| Packaging | `packs` from batch output: open, verified | close (boxes created and labelled) | `/warehouse/packs` |
| Finished goods | product lots `released` with stock | allocated to an order (FEFO) | `/inventory?kind=product` |
| Orders to dispatch | `sales_orders`: confirmed, allocated (to pick), picking, packed, partially_shipped (`ORDER_TRANSITIONS`) | Dispatch posts the shipment and delivery receipt | `/sales/board`, `/sales/picking`, `/sales/dispatch` |

Exception paths (all existing, all with reason, actor and time): PO cancel, receipt reverse, lot hold /
reject / recall, batch reject / rework, pick or dispatch undo, order cancel. Posted stock is never
edited; corrections are reversals (ADR-006).

## 2. Operations Center read model (built, ADR-081)

`getOperationsCenter(ctx, { all })` in `src/modules/analytics/operations-center.ts`:

- **Scope:** the current site, or all of the user's sites with `?scope=all` (`resolveScope`, which calls
  `requireSite` for each). Never another site.
- **Per stage:** `count`, `parts` (split by state; parts always add up to count), `attention` (late,
  on hold or expiring; never added to count) and links. Definitions: `docs/PRD.md` A-UX-04.
- **Permissions:** a stage is only computed when the caller holds the module view permission
  (`procurement.purchase_order.view`, `procurement.goods_receipt.view`, `inventory.lot.view`,
  `production.batch.view` or `production.work_order.view`, `inventory.pack.view`,
  `sales.sales_order.view`).
- **Active batches:** up to 50 batches in planned … quarantined, furthest along first, each linking to its
  production order (or the full batch record for a batch without an order).
- **No writes.** Counts are live queries; nothing is cached or stored, so a valid transition anywhere is
  reflected on the next page load.

Tests: `tests/integration/analytics/operations-center.test.ts`.

## 3. Automation already in place (unchanged by R1)

| Rule from the brief (Part II §12) | Where it happens today |
|---|---|
| Approved receiving and inspection update available raw materials | Receipt post creates lots in quarantine; QA release changes `quality_status` (quality module) |
| Production release reserves material lots | Work order approval reserves lots (`work-orders-reserve.ts`); materials list (ADR-080 G2) |
| Completing a step unlocks the next and records who/when | `stepDone`, `process_step_records` (ADR-080 G2) |
| QA release makes finished goods allocatable | FEFO allocation only considers released lots |
| Scanning a box or moving stock updates location and history | `postMovement` (ledger) |
| Customer orders suggest eligible released stock | FEFO allocation (sales) |
| Dispatch updates fulfilment and creates delivery documents | dispatch service + delivery receipt |
| Alerts for low stock, expiry, overdue, blocked, approvals | notification rules, expiry job, curing reminder, To approve |

All are transactional; commands that can be retried carry idempotency keys (`src/lib/idempotency.ts`).

## 4. Proposal: workflow instance reference (R4, needs approval)

The brief asks each workflow to have a reference, type, current step, assignee, site, related records and
history. Today this exists per record (PO, receipt, production order, sales order) but not as one chain.
Proposal, with no change to posting logic:

- A read-only **"Journey"** panel on each record page computed from existing links (PO → receipts → lots
  → batches that consumed them → finished lot → boxes → orders → shipments), reusing the genealogy queries
  of traceability.
- **Assignee/team on production orders and receipts** (new nullable columns, migration additive) so
  "My work" becomes assigned work (UX-15). Who assigns is an owner decision (A-UX-05).
- No separate `workflow_instances` table until the panel proves insufficient (avoid two sources of truth).

## 5. Proposal: one record layout (R3)

Header (reference, type, product/customer, site, status, assignee) · progress strip · current work with one
primary action · related records · activity. The production order hub (ADR-080) is the model; apply it to
purchase order, goods receipt, sales order and shipment in that order.

**Built (R3 header, 2026-10-30).** `RecordHeader` in `src/ui/record.tsx` (type · mono reference · site,
title, status chip, meta, progress strip, one primary action, quiet secondary links) is used by
`procurement/orders/[id]`, `inventory/receive/[grId]`, `sales/[orderId]` and `sales/shipments/[shipmentId]`.
Assignee is not shown yet (needs the workflow-instance/assignment model, UX-22). Strip stages are pure
mappings in `src/ui/record-steps.ts`, tested against the real transition tables
(`tests/unit/record-steps.test.ts`):

| Record | Stages ("current" = where the record is now) | Stopped states (last step "blocked") |
|---|---|---|
| Purchase order | Draft · Approval (submitted) · Approved · Sent · Received (partly/fully) · Closed; after-the-fact POs have no Sent stage | Cancelled → Created ✓ · Cancelled ✕ |
| Goods receipt | Draft · Posted | Cancelled → Draft ✓ · Cancelled ✕; Reversed → Draft ✓ · Posted ✓ · Reversed ✕ |
| Sales order | Draft · Approval (submitted, pending approval) · Confirmed · Allocated · Pick & pack (picking, packed) · Shipped (partly/fully) · Invoiced · Closed | Cancelled → Created ✓ · Cancelled ✕ |
| Shipment | Picking (draft) · Picked · Packed · Dispatched · Delivered | Cancelled → Created ✓ · Cancelled ✕; Reversed/Returned → Picking…Dispatched ✓ · Reversed/Returned ✕ |

Primary-action rule: the header carries the page's existing single-click command or link for the current
status (Submit, Post receipt, Allocate, Start/Continue pick, Verify packing, Receive delivery, Print labels,
Print delivery receipt). Commands that need typed input (approve with note, send with email choice,
dispatch with driver/plate, acknowledgment, cancel/reverse with reason) stay in their card; the header
then shows one "Next: …" sentence pointing to it. No new action, permission or service was added.
