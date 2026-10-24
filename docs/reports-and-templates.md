# Reports and templates

| | |
|---|---|
| Status | Draft for Gate G0 (Phase 0). Needs review by Bryel's Care production, QA and warehouse process owners, the accountant (customer-facing documents) and the IT contact (printers). |
| Owners (team) | `manufacturing-process-engineer` (lead; BMR, dispensing sheet, traveler, production documents), `warehouse-procurement-specialist` (labels, scan payloads, pick/pack/DR, stock card, PO). Accountable: `quality-regulatory-specialist` (signatures, e-records, reprint control). Consulted: `ux-ui-designer` (layout, `docs/ux-system.md` §10). |
| Sources | `docs/source/master-brief.md` (module 7, module 8, "Reports and print templates" table, AC-18); `docs/source/bmr-acapulco-soap.jpeg` (current paper BMR); `docs/decision-log.md` (ADR-009, 014, 015, 016, 017); `docs/data-model.md` §3.2, §3.3, §3.5, §3.6, §3.7, §3.10, §4.4; `docs/process-maps.md` W01, W02, W05, W06, W08, W09, W10, §5; `docs/permissions-matrix.md` §3.7; `docs/security.md` §2.7; `docs/ux-system.md` §9.12, §10. |
| Date | 2026-10-16 |

**Binding caution.** Every formula value, tolerance, test, specification, procedure text, label claim, legal wording and retention period that appears in this document is an **example to be configured** and must be **verified with authorized personnel before production use**. The system stores them as versioned configuration; it does not decide them. Electronic sign-offs described here are authenticated records (attestations), **not validated electronic signatures**; see §11.

How to read: owners and process owners start with §2.1 (how the paper BMR maps), §2.5 (paper versus electronic), §8 (what labels say) and §13 (what we need you to confirm). Engineers read everything; §1 is the engine contract, §10 the print contract, §12 the test plan.

---

## 1. Template engine design

### 1.1 Entities (from `docs/data-model.md` §3.2, §3.3, §3.10)

| Entity | Role in the engine | Key columns used here |
|---|---|---|
| `document_templates` | One row per document kind and variant (for example `BMR-SOAP-STD`, `LBL-RM-100x50`). | `code`, `name`, `template_kind`, `page_size`, `orientation`, `site_id` (null = all sites) |
| `document_template_versions` | Versioned, approved, effective-dated definition (`ver` + `approval` sets). | `version_no`, `status`, `effective_from/to`, `definition` (jsonb, §1.2), `definition_checksum`, `approved_by/at` |
| `label_templates` | Physical label configuration bound to a `document_templates` row of kind `label`. | `applies_to`, `symbology`, `media_width_mm`, `media_height_mm`, `dpi`, `document_template_id` |
| `generated_documents` | One row per render (first print, reprint, regeneration, export). | `document_template_version_id`, `document_kind`, `source_entity_type/id`, `source_revision_at`, `document_number`, `status`, `superseded_by_id`, `record_revision_no`, `source_state`, `watermark`, `file_attachment_id`, `checksum_sha256`, `page_count`, `generated_by/at`, `background_job_id`, `reprint_of_id`, `reprint_reason_code_id`, `reprint_note`, `parameters` |
| `label_jobs` | A print request for 1..n copies of a label for one entity; carries reprint reason. | `label_template_id`, `entity_type/id`, `copies`, `status`, `printer_name`, `reprint_of_id`, `reprint_reason_code_id`, `generated_document_id`, `document_template_version_id`, `printed_by/at`, `station_device_registration_id`, `voided_at/by`, `void_reason`, `idempotency_key` |
| `file_attachments` | The PDF object in the bucket (ADR-014) and any scanned paper pages. | `bucket_key`, `checksum_sha256`, `content_type`, `attachment_kind`, `is_sensitive` |
| `numbering_rules` | Human-readable document numbers (ADR-009). | rule `DOC` = `DOC-{YY}-{SEQ}`, SEQ width 7, organization scope (`docs/data-model.md` §9.2, A-RPT-03); DR, PO, GR, SO numbers come from their own rules |
| `reason_codes` | Reprint reasons (`applies_to` contains `reprint`). | `code`, `requires_note` |
| `audit_events` | `documents.generated_document.generated`, `documents.generated_document.downloaded`, `documents.generated_document.reprinted`, `documents.generated_document.superseded`; label jobs: `documents.label_job.printed`, `documents.label_job.reprinted`, `documents.label_job.voided` (names per `docs/data-model.md` §8.1, `module.entity.event`). | |

Batches additionally freeze `batches.bmr_template_version_id` at creation (`docs/data-model.md` §4.4): a BMR is always rendered with the template version the batch started with, even after a newer version is approved.

### 1.2 Template definition (`definition` jsonb, schema `document_template/v1`)

Decision (A-RPT-01, needs principal architect and security engineer confirmation): the database stores **layout configuration and bindings**, not arbitrary HTML. The HTML/CSS of ADR-016 is produced by **code-defined renderers** in `src/modules/documents/renderers/<id>-v<n>.ts` (built with an escaping HTML builder, see §1.4.1; user text is always escaped, `docs/security.md` §4). A template version pins a renderer id and configures it. Free HTML in the database was rejected because a template author could inject script or external resources into a worker that reads internal data; a sandboxed HTML "custom block" can be added later behind a feature flag if a real need appears.

```json
{
  "schema_version": "document_template/v1",
  "renderer": { "id": "bmr", "version": 1 },
  "dataset": "bmr/v1",
  "page": { "size": "A4", "orientation": "portrait", "margin_mm": { "top": 24, "right": 15, "bottom": 20, "left": 15 } },
  "header": { "show_logo": true, "title": "BATCH MANUFACTURING RECORD", "identity_fields": ["batch_number", "product_name", "formula_code_rev"] },
  "footer": { "show_qr": true, "uncontrolled_copy_text": "Printed copies are uncontrolled unless signed", "show_hash": true },
  "sections": [
    { "id": "header_block", "enabled": true },
    { "id": "materials", "enabled": true, "columns": ["inci_name", "common_name", "material_code", "lot", "supplier_lot", "expiry", "theoretical", "tolerance", "actual", "uom", "dispensed_by", "checked_by", "timestamps", "deviation_flag"], "group_by": "phase_code" },
    { "id": "process_steps", "enabled": true, "show_instruction_text": true },
    { "id": "checklist", "enabled": true },
    { "id": "packaging_reconciliation", "enabled": true },
    { "id": "output_yield", "enabled": true },
    { "id": "qc", "enabled": true },
    { "id": "deviations", "enabled": true },
    { "id": "disposition_signatures", "enabled": true, "break_before": "page", "handwritten_lines": true },
    { "id": "remarks", "enabled": true },
    { "id": "attachments", "enabled": true },
    { "id": "audit_appendix", "enabled": true, "break_before": "page" }
  ],
  "labels": { "en": { "theoretical": "Theoretical weight/volume", "actual": "Actual weight/volume" } },
  "options": { "display_decimals_by_uom": { "g": 1, "kg": 3, "mL": 1, "pcs": 0 }, "totals_from_unrounded": true, "print_percentages": false, "watermarks": "default" }
}
```

Rules: the Zod schema for `document_template/v1` lives in `src/modules/documents/schemas`; `definition_checksum` = sha256 of the canonical JSON and is printed in the footer; unknown keys fail validation; `print_percentages` cannot be `true` on `bmr` or `dispensing_sheet` templates (A-PM-16 in `docs/permissions-matrix.md`: operators and production documents never show formula percentages).

### 1.3 Data bindings (datasets)

Each document kind has a typed dataset built by the owning module under the **caller's** `AuthContext` (scoped queries, ADR-005); the renderer is a pure function of the dataset and never touches the database. Datasets are frozen into the job payload so a reprint of the same `source_revision_at` reproduces the same bytes.

| Dataset | Built by (module, public `index.ts`) | Source entities | Permission to generate |
|---|---|---|---|
| `bmr/v1` | `production.buildBmrDataset(ctx, batchId)` | `batches` (+ `bom_snapshot`), `batch_materials`, `dispense_records`, `process_step_records`, `process_step_readings`, `equipment_uses`, `batch_outputs`, `yield_records`, `scrap_rework_records`, `deviations`, `inspections`, `test_results`, `dispositions`, `batch_state_transitions`, `audit_events` (batch scope), `file_attachments`, snapshot of `formula_revisions`, `routing_revisions`, `routing_steps`, `routing_step_parameters`, `work_instruction_revisions`, `inspection_plan_tests` | `production.batch.view` + `documents.generated_document.create` |
| `dispensing_sheet/v1` | `production` | `batches`, `batch_materials`, `stock_reservations`/`stock_allocations` (expected lots), `dispense_records`, `equipment` (scales) | as above |
| `traveler/v1` | `production` | `batches`, `process_step_records`, `routing_steps`, `work_instruction_revisions`, `routing_step_parameters` | as above |
| `boxing_note/v1` | `inventory` (pack) with `sales` for order data | `packs`, `containers`, `container_contents`, `inventory_lots`, `skus`, `sales_orders`, `customer_requirements` | `inventory.container.view` (+ `sales.sales_order.view` when order-based) |
| `pick_list/v1` | `sales` | `picks`, `pick_lines`, `stock_allocations`, `inventory_lots`, `containers`, `locations` | `sales.pick.view` |
| `delivery_receipt/v1` | `sales` | `delivery_receipts`, `shipments`, `shipment_lines`, `containers`, `sales_orders`, `customers`, `customer_addresses` | `sales.delivery_receipt.view` |
| `label/<applies_to>/v1` | `inventory` (lots, containers, locations, samples), `production` (batches, equipment) | see §8 | `inventory.label_job.create` |
| `stock_card/v1` | `inventory` | `stock_movements`, `inventory_balances`, `inventory_lots`, `locations` | `inventory.movement.view` |
| `attendance_exception_report/v1` | `hr` | `attendance_imports`, `attendance_import_rows`, `attendance_exceptions`, `attendance_events`, `employees` (number, name only) | `hr.attendance_import.view` |
| `purchase_order/v1` | `procurement` | `purchase_orders`, `purchase_order_lines`, `suppliers`, `supplier_materials`, `warehouses` | `procurement.purchase_order.view` (prices masked without pricing view) |
| `report/<code>/v1` | `analytics` | report registry query | `analytics.report.export` |

### 1.4 Generation pipeline (ADR-015, ADR-016)

1. Command `documents.generate` (Zod-validated; idempotency key = client UUIDv7) checks `documents.generated_document.create` **and** the source record's `view` permission in the caller's site scope; a user who cannot view the batch cannot render its BMR (`docs/permissions-matrix.md` §3.7).
2. The service builds the dataset, computes `source_revision_at` (= source row `updated_at`, or the latest child-record `updated_at` for composite documents such as the BMR, whichever is later) and allocates `document_number` from rule `DOC` inside the transaction (A-RPT-03). Row inserted in `generated_documents` with `file_attachment_id` null, `background_job_id` set and `status = 'rendering'`.
3. pg-boss job `documents.render`, keyed by `(generated_document_id)`, runs in the worker: render static HTML → Chromium `page.pdf()` → sha256 → bucket object `org/<org-uuid>/<document-uuid>.pdf` → `file_attachments` row → update `generated_documents` (`checksum_sha256`, `page_count`, `status = 'ready'`) → audit `documents.generated_document.generated` (template version, source revision, hash). Per-user queue cap 10 pending (A-SEC-20).
4. Preview: the same HTML is served in a sandboxed iframe with the same print CSS; the page thumbnails come from the stored PDF once ready. "PDF identical to preview" is a test, not a promise (§12).
5. Download: signed URL, 5-minute TTL, bound to document id and user (A-SEC-19), `Content-Disposition: attachment`; audit `documents.generated_document.downloaded`.
6. Offline (ADR-018): generation and label printing are **Online-only**; previously downloaded PDFs may be cached read-only with an "as of" marker (Phase 7 decision in `docs/offline-sync.md`).

### 1.4.1 Phase 2 rendering as built (Wave 1, E-2-03; pending the ADR-016 final call)

| Item | As built | Differs from the design above because |
|---|---|---|
| Renderers | `src/modules/documents/renderers/<id>-v<n>.ts`: pure functions of the frozen dataset that build HTML with an escaping builder (`html.ts`); registry in `renderers/registry.ts`. Built now: `label` v1 (datasets `label/{material,wip,finished_good,location}/v1`) and `test_page` v1 (`test_page/a4/v1`) | React's static renderer cannot be imported in the Next.js server-component layer; the builder keeps renderers framework-free for the worker |
| Output | `PDF_RENDERER=disabled` (default): the row is generated, numbered (`DOC`), rendered and hashed (sha256 of the rendered HTML) synchronously; printing uses the browser dialog from `/print/labels/<job>` and `/print/documents/<id>`, which re-render the stored dataset and refuse to print if the hash differs. "Download PDF" shows the setup-required state | Headless Chromium would add roughly 300–400 MB to the image and a few hundred MB of memory per render on Railway; the browser dialog already gives "Save as PDF" and label-sized `@page` |
| Worker | `src/modules/documents/jobs/render.ts` exports `{ code: "documents.render", handler }`; idempotent; used for retries now and for PDF output when the Chromium adapter ships | job registry is being built in parallel (W1A) |
| Page x of y | CSS `@page` margin boxes (Chrome 131+); running header and footer are in the page body | no Chromium `headerTemplate` in browser print |
| Label test pages | `/print/labels/test/<label template>`: live, unrecorded, sample data, 50 mm ruler (40 mm on 50 mm media); A4 test pages are recorded documents (`test_page` kind) | T-01 needs a page before a template is approved |

### 1.4.2 BMR as built (Wave 2 W2D, E-3-06) and the integration contract

| Item | As built |
|---|---|
| Renderers | `bmr` v1 (`src/modules/documents/renderers/bmr-v1.ts`, dataset `bmr/v1`, schema in `bmr-data.ts`) and `bmr_paper_page` v1 (blank hybrid pages, dataset `bmr_paper_page/v1`), both template kind `bmr`. Pure functions of the frozen dataset (static test). The company mark is `bmr-logo.ts`, the vector of `src/ui/brand.tsx` with resolved colours (a test keeps the geometry in sync) |
| Layout | Paper BMR order: title + logo block, Dispensing and weighing (with TOTAL and blank rows when `handwritten_lines`), Procedure, Checklist (conducted / checked), then the yield / test results / final disposition / QA signature / remarks block, then the sections the paper form lacks. Section order = order in the definition. Section J does **not** start a new page in the seeded `BMR-STD` so page 1 looks like the paper form; set `break_before: "page"` on `disposition_signatures` to apply A-RPT-05 (A-W2D-03). The audit appendix starts a new page |
| Approval rule | `checkDefinition` calls the renderer's `validateDefinition`: a `bmr/v1` definition must contain `materials`, `checklist`, `qc`, `disposition_signatures` enabled (C, E, H, J), only known section ids, no duplicates; saving, submitting and approving all refuse otherwise |
| Templates | Settings `documents.bmr.template_code` (default `BMR-STD`) and `documents.bmr.paper_page_template_code` (default `BMR-PAPER`). A batch keeps the template version of its first BMR; before that it uses the version effective at batch creation, else the current approved one (§11.1 item 4) — no column on `batches` needed |
| Generation | `generateBmr` (on demand, `production.batch.view` + `documents.generated_document.create`) and closure. `source_revision_at` = latest timestamp of the batch and its records (document events excluded); if the current BMR already has that revision and watermark it is returned instead of a new number. A new revision supersedes the earlier ready BMR documents |
| Watermarks | draft/planned `DRAFT`; materials_staged/in_process `IN PROGRESS`; awaiting_qc/quarantined `UNDER QA REVIEW`; released/rejected/rework_approved `FINAL – PENDING CLOSURE` (`AMENDMENT IN PROGRESS – rev n` while reopened); closed `CONTROLLED COPY` (first closure) or `AMENDED rev n`; reprints `REPRINT n`; void / superseded documents are shown with a `VOID` / `SUPERSEDED` overlay outside the hashed body |
| Page identity | `@page` margin boxes: top right `Batch B-xx · product · DOC number · watermark`, bottom right `Batch B-xx · page x of y`. QR `BC:DOC:<document number>` in the header block and at the end; scanning it opens the batch after sign-in and batch permission |
| Reprint | Through the document record (reason mandatory, 422 without). The reprint renders the same frozen data: the footer `content <8 hex>` (sha256 of the canonical dataset) is identical to the original's; QA is notified in-app for kinds in `documents.reprint.notify_qa_kinds` (default `bmr`, A-OPS-07) |
| Print page | `/print/bmr/<batch>`: the current recorded BMR (hash-checked) with the browser print button, or an unrecorded preview that prints only "generate first" until **Generate BMR** is used; history of BMRs and paper pages. `/print/documents/<id>` prints paper pages |
| Not built | Stored PDFs, the Chromium worker, the per-user PDF queue limit (US-3-18 AC2 "11th job is 429") and thumbnails, per ADR-026; the stress test T-09 is still to be run on real printers |

**Contract for sections owned by other Wave 2 streams** (`src/modules/production/bmr-sources.ts`). Each function returns `{ available, rows }`; `available = false` when the table does not exist (the BMR prints "not captured electronically in this system version"); when the table exists but a listed column is missing the function throws `setup_required` naming the column, so a BMR never silently omits recorded data. The integrator aligns the SQL in that one file with the merged schema.

| Function | BMR section | Table and columns read (docs/data-model.md names) | Owner |
|---|---|---|---|
| `bmrLineClearanceChecks` | line_clearance | `process_step_checklist_results` (`process_step_record_id`, `routing_step_checklist_item_id`, `answer`, `note`, `answered_by`, `answered_at`) + `process_step_records`, `routing_step_checklist_items` | W2B |
| `bmrProcessReadings` | process_parameters | `process_step_readings` (`process_step_record_id`, `routing_step_parameter_id`, `value_numeric/text/boolean`, `is_within_limits`, `recorded_at`, `recorded_by`, `supersedes_id`, `correction_reason`) | W2B |
| `bmrEquipmentUses` | equipment | `equipment_uses` (`batch_id`, `equipment_id`, `process_step_record_id`, `started_at`, `operator_id`, `cleaning_status_at_start`, `calibration_due_date_at_use`, `exception_reason`) | W2B |
| `bmrYieldRecord` | packaging_reconciliation, output_yield; closure check "yield reconciliation checked" | `yield_records` (`batch_id`, `theoretical_base`, `actual_base`, `variance_base`, `variance_pct`, `labels_issued/used/destroyed`, `packaging_notes`, `recorded_by`, `checked_by`, `supersedes_id`) | W2B |
| `bmrBatchOutputs` | output_yield | `batch_outputs` (`batch_id`, `line_no`, `output_kind`, `material_id`, `lot_id`, `to_location_id`, `qty_base`) | W2B |
| `bmrInspections` | qc | `inspections` (`inspection_number`, `batch_id`, `status`, `reviewed_by`, `reviewed_at`); QC results still come from the MVP `test_results` (`batch_id`) | W2C |
| `bmrDeviations`, `openDeviationNumbers` | deviations; closure check "deviations closed"; summary | `deviations` (`deviation_number`, `status`, `batch_id`, `deviation_kind`, `severity`, `description`, `raised_by/at`, `closed_by/at`) | W2C |

Guards the integrator must keep wired: `assertPaperRecordsReviewed(tx, batchId, batchNumber)` is called by `decideBatch` (quality) before a batch leaves `awaiting_qc`; when W2C adds `awaiting_qc → quarantined` and dispositions from `quarantined`, those paths must call it too, and the disposition from `quarantined` is what lets a batch reopened to `quarantined` be closed again.

### 1.5 Header and footer on every page

Running header and footer are rendered by Chromium's `headerTemplate` / `footerTemplate` (A-RPT-02) so that `page x of y` is exact and the identity line cannot be pushed off a page by content. The body reserves the margins in §10.

| Zone | Content (all documents) | Document-specific |
|---|---|---|
| Header, left | Company mark (A-UX-03 brand asset) and legal name | — |
| Header, centre | Document title | BMR: product name and batch number in bold 11 pt |
| Header, right | `document_number` · template `code` v`version_no` · status watermark word | BMR: formula code and revision |
| Footer, left | `Generated <DD MMM YYYY HH:mm> by <display name>` · site code | DR: DR number; pick list: order number |
| Footer, centre | Record identity repeated (batch / order / shipment / lot number) | — |
| Footer, right | `Page x of y` | — |
| Footer, second line (7.5 pt) | `Template <code> v<n> · checksum <first 8 hex of definition_checksum> · file <first 8 hex of checksum_sha256> · Source rev <ISO timestamp>` · uncontrolled-copy wording (text configurable, validated by QA) | Reprints: `REPRINT n of <original document_number>` |
| Footer QR (optional, default on for BMR, traveler, DR, boxing note) | `BC:DOC:<document_number>` (A-RPT-26; `docs/security.md` §2.7). Resolving the code requires sign-in and the source record's permission; it never encodes a URL. | — |

Watermark words (A-RPT-04): `DRAFT` (source not yet final), `IN PROGRESS`, `UNDER QA REVIEW`, `CONTROLLED COPY` (final, first generation at closure), `REPRINT n`, `SUPERSEDED` (a newer generation exists for the same source), `VOID`. Mapping to batch states is in §2.6. Words are printed diagonally at 12 % opacity in the body plus as text in the header, so they survive photocopying.

### 1.6 Controlled reprint, regeneration and supersession

| Action | When | Permission | Record | Audit |
|---|---|---|---|---|
| First generation | Source reaches the state where the document is meaningful (BMR: on demand at any state; final at closure W05-20) | `documents.generated_document.create` | new `generated_documents` row | `documents.generated_document.generated` |
| Reprint | Same source revision and same template version printed again (lost copy, extra copy for a customer) | `documents.reprint.create` (S: site_manager, operators, QA, sales, finance, HR per matrix; never auditor) | new row with `reprint_of_id` → original, `reprint_reason_code_id` mandatory, note when the reason requires it; the stored PDF is re-rendered from the frozen dataset and must hash identically except for the reprint banner and footer; reprint count = chain depth | `documents.generated_document.reprinted` (sensitive) |
| Regeneration | Source changed after generation (amendment, correction appended, repack, DR acknowledged) | as first generation | new row; the previous current row is marked superseded (`documents.generated_document.void`) and keeps its file | `documents.generated_document.superseded` + `documents.generated_document.generated` |
| Void | Document generated in error (wrong template, wrong batch) | `documents.generated_document.void` (S) | status void, reason; file retained per retention | `documents.generated_document.superseded` with reason `void` |

The UI shows reprint and regeneration history on the record (`docs/ux-system.md` §9.12). A document can never be deleted; retention follows the source record class (`docs/security.md` §7, A-SEC-25).

---

## 2. Batch Manufacturing Record (BMR)

### 2.1 Field-by-field mapping of the paper BMR (`docs/source/bmr-acapulco-soap.jpeg`)

Legend: **K** kept as on paper, **D** derived (computed or looked up), **N** new field required by the brief, **H** handwritten on paper today and electronic in the to-be.

| Paper area | Paper field | Entity.column (`docs/data-model.md`) | Type | Notes |
|---|---|---|---|---|
| Title | "BATCH MANUFACTURING RECORD", logo | `document_templates.name`; logo asset (settings key `documents.logo_attachment_id`, A-UX-03) | K | |
| Header | Product Name (ACAPULCO SOAP) | `products.name` via `batches.work_order_id → work_orders.product_id`; SKU `skus.code/name` when the work order names one | K | SKU is new (brief module 7) |
| Header | Batch Number (blank, handwritten) | `batches.batch_number` (numbering rule `BATCH`) | K/H | Printed by the system; legacy paper numbers kept in a `legacy_number` field (A-PRD-04) |
| Header | Department (PRODUCTION) | `departments.name` via `production_lines.department_id` (default), overridden by `work_orders.department_id` when set | K | Q-RPT-P04 asks whether intermediates belong to another department |
| Header | Batch Formula NO (blank) | `formulas.code` + `formula_revisions.version_no` (as `ACS-F01 rev 3`) | K/H | Q-PR-01 asks for the real number |
| Header | Batch Size (17,600 g) | `batches.batch_size_base` + `uoms.code` | K | Basis = total theoretical input mass (A-PRD-19) |
| Header | Start Date (pre-printed 12 Oct 2026) | `batches.started_at` in `sites.timezone` | K/H | Set when the first line clearance is signed (W05-06), not pre-printed |
| Header | End Date | `batches.ended_at` | K/H | Set at transfer to quarantine (W05-17) |
| Header (new) | Site / line, document revision, planned and actual yield, expiry/retest date, template version | `sites.code`, `production_lines.code`, `generated_documents.document_number`, `batches.theoretical_yield_base`, `yield_records.actual_base`, `batches.expiry_date`, `batches.retest_date`, `document_template_versions.version_no` | N | Brief module 7 header list |
| Dispensing table | Ingredient (INCI Name) | `batches.bom_snapshot[].inci_name` (frozen copy of `materials.inci_name`); `common_name`, `material_code` printed alongside | K | The paper names ("Coconut Oil", "33.33% Lye Solution") are common names; INCI names must be supplied by QA (Q-RPT-Q02) |
| Dispensing table | Batch Number (of the ingredient) | `inventory_lots.lot_number` via `dispense_records.lot_id`; `inventory_lots.supplier_lot_number` printed in a second line | K/H | Internal lot is new (A-PROC-02) |
| Dispensing table | Expiration Date | `inventory_lots.expiry_date`; `retest_date` shown when expiry is null | K/H | |
| Dispensing table | Theoretical Weight/Volume (g) | `batch_materials.target_qty_base` + `uoms.code` | K | 3,723.2 / 8,687.4 / 4,964.2 / 190.9 / 34.4 g on the sample (verify with authorized personnel before production use) |
| Dispensing table (new) | Tolerance | `batch_materials.tolerance_low_base`, `tolerance_high_base`; `bom_snapshot[].tolerance_pct` | N | Printed as `± 1.0 % (3,686.0 – 3,760.4)`; no system default (A-PRD-18) |
| Dispensing table | Actual Weigh/Volume (g) | `dispense_records.net_qty_base` summed per `batch_material_id`; each record printed as a sub-row when more than one (split lots, re-weigh) with `tare_qty`, `gross_qty`, `net_qty` when captured | K/H | Voided or superseded records print struck through with the reason (append-only) |
| Dispensing table | Conducted by | `dispense_records.dispensed_by` → `users.display_name` + `dispensed_at` | K/H | |
| Dispensing table | Checked by | `dispense_records.checked_by` → `users.display_name` + `checked_at` | K/H | `checked_by <> dispensed_by` enforced in the schema |
| Dispensing table (new) | UOM, scale, deviation flag | `uoms.code`; `equipment.code` via `dispense_records.equipment_id` (+ `equipment_uses.calibration_due_date_at_use`); flag when `is_within_tolerance = false`, `exception_approved_by` set or `deviation_id` set (prints `DEV-nnn`) | N | |
| Dispensing table | TOTAL (17,600 / "–") | Σ `target_qty_base` and Σ actual, computed from unrounded values, displayed with the UOM decimals; a note "lines sum to 17,600.1 g, displayed total rounded" is printed when rounding changes the last digit (F-05, A-PRD-29) | D | |
| Procedure 1–5 | Blank numbered lines | `work_instruction_revisions.body_markdown` of each `routing_steps.work_instruction_revision_id` in the frozen routing revision, printed under the step it belongs to (§2.2 D) | K/H | Q-PR-09: SOP text or per-batch notes? Per-batch notes map to `process_step_records.notes` |
| Checklist 1 | Weighing Area Line Clearance | `process_step_records` where `routing_steps.step_kind = 'line_clearance'` and `routing_steps.area = 'weighing'` (A-PROC-32); checklist answers from `process_step_checklist_results` | K/H | |
| Checklist 2 | Weighing | step `dispensing`; conducted/checked summarised from the dispensing table | K/H | |
| Checklist 3 | Production Area Line Clearance | `line_clearance` (production) | K/H | |
| Checklist 4 | Mixing and Cutting | one or more `process` steps (mixing, moulding, cutting) with `process_step_readings` | K/H | Step parameters are not on paper; Q-PR-04 |
| Checklist 5 | Production Area Line Clearance (second) | `line_clearance` (packaging), A-PROC-32 | K/H | |
| Checklist 6 | Packaging and Labeling | step `packaging` + reconciliation (`yield_records.labels_*`, packaging `batch_materials`) | K/H | |
| Checklist 7 | Transfer to Quarantine Storage Area | step `transfer`; `batch_outputs.to_location_id` (quarantine class), `production_postings` | K/H | |
| Checklist columns | Conducted by / Checked by | `process_step_records.performed_by`, `completed_at`, `checked_by`, `checked_at` | K/H | |
| Footer | Theoretical Yield | `yield_records.theoretical_base` (basis per formula: mass or units, A-PROC-33) | K/H | |
| Footer | Actual Yield | `yield_records.actual_base`; variance `variance_base`, `variance_pct` printed next to it | K/H | |
| Footer | Expiration Date | `batches.expiry_date` (= manufacturing or packaging date + shelf life, A-PROC-08/A-PRD-28; QA override with reason) | D | |
| Footer | Test Results | `test_results` of the finished-product `inspections` (plan `inspection_plan_tests`: name, method, `spec_min/max/text`, `uom`), `value_*`, `is_within_spec` | K/H | No tests asserted (A-PROC-20) |
| Footer | Test Date / Conducted / Checked By | `test_results.tested_at`, `tested_by`, `checked_by`; `inspections.reviewed_by/at` | K/H | |
| Footer | Final Disposition Approved / Disapproved | `dispositions.decision` (`release` → "Approved", `reject` → "Disapproved", `conditional_release` → "Conditionally released (conditions printed)", `rework` → "Rework approved") via `batches.disposition_id` | K/H | Paper vocabulary kept for familiarity; system values printed in brackets |
| Footer | Name and Signature of QA, Date | `dispositions.decided_by` → display name, `dispositions.posted_at`; printed as "Electronically recorded by … on …" plus a handwritten signature line while hybrid (§2.5, §11) | K/H | |
| Footer | Remarks | `batches.remarks` | K/H | |

### 2.2 Generalized BMR structure

Sections print in this order; each can be enabled per template version (§1.2) but the renderer refuses to approve a `bmr` template that disables sections C, E, H or J.

| # | Section | Content | Data | Page-break rule |
|---|---|---|---|---|
| A | Header block (page 1) | Product, SKU, batch number, formula code/revision, routing code/revision, department, site, line, batch size, planned start/end, actual start/end, work order number, planner, supervisor, planned and actual yield, expiry/retest, BMR template version, label template version, inspection plan revision, instruction revisions used | `batches`, `work_orders`, snapshot revisions | Keep together; the "revisions used" table never splits |
| B | Batch summary and state | Current state (text), state history summary (planned → … with times), open deviations count, holds | `batch_state_transitions`, `quality_holds` | Keep with A |
| C | Materials (dispensing and weighing) | Table per §2.1, grouped by `phase_code` (for example oils, lye, additives); packaging BOM lines (`line_kind = 'packaging'`) as a second table with issued/used/damaged/returned; TOTAL rows per group and overall; rounding note | `batch_materials`, `dispense_records`, `bom_snapshot` | `thead` repeats; rows and their sub-rows `break-inside: avoid`; TOTAL row kept with the last two rows |
| D | Process steps | One block per `routing_steps` row in `step_no` order: step number, name, kind, instruction text (markdown rendered, instruction revision shown), parameter table (parameter, unit, min / target / max, actual, within-limits, recorded by, at, equipment), equipment used (code, calibration due at use, cleaning status at start), performed by/at, checked by/at, status (completed / skipped with approver), notes, in-process inspection results inline, exception references | `process_step_records`, `process_step_readings`, `equipment_uses`, `inspections` (in-process) | Step header and its parameter table `break-inside: avoid`; instruction text may flow; a block longer than one page splits after the instruction text |
| E | Checklist and sign-off summary | The paper's seven-row table generalised: step no., name, conducted by, time, checked by, time, status | `process_step_records` | Never split (≤ 30 rows) |
| F | Packaging and label reconciliation | Labels issued/used/destroyed/returned, packaging components per line, variance vs tolerance (A-PROC-19), reconciliation checker | `yield_records`, packaging `batch_materials`, `scrap_rework_records` | Keep together |
| G | Output and yield | Output lines (kind, SKU/material, lot number created, quantity, location, container count), theoretical / actual / variance, scrap and rework rows with reason codes and approval | `batch_outputs`, `yield_records`, `scrap_rework_records`, `production_postings` | Keep together |
| H | QC (finished product) | Per inspection: number, plan code/revision, sampled by/at, sample qty; results table (test, method, specification, result, unit, within spec, tested by/at, checked by); reviewer and review time; outcome; attachments listed; superseded results struck through with reason | `inspections`, `test_results`, `inspection_plan_tests` | Inspection header + results table `break-inside: avoid`; `thead` repeats |
| I | Deviations and controlled exceptions | Deviation number, severity, what it concerns (line / step / lot), raised by/at, status, closed by/at, CAPA number; exception approvals (CX-TOL, CX-MAT, CX-CAL, CX-LOT) with approver and reason | `deviations`, `audit_events` (exception approval events of the owning record, for example `production.dispense_record.over_tolerance_approved`, `production.equipment_use.override_approved`; `docs/data-model.md` §8.1) | Table, `thead` repeats |
| J | Disposition and signatures | Decision (paper vocabulary + system value), decided by, time, reason, conditions and review date (conditional), expiry/retest confirmed; signature lines: Conducted by (production), Reviewed by (QA reviewer), Approved by (QA disposition), each with printed name, electronic record time and a handwritten line while hybrid (A-RPT-06) | `dispositions`, `inspections.reviewed_by`, `batches` | `break-before: page` by default (A-RPT-05) so the signature page is stable |
| K | Remarks | `batches.remarks`; amendment notes | `batches` | With J |
| L | Attachments | Scanned paper pages (step, page no., reviewer), photos, CoA copies, lab reports: file name, kind, sha256 (first 8), uploaded by/at | `file_attachments`, `batch_paper_records` (page, transcriber, reviewer); for a lot that started on paper, the `legacy_documents` row matched by `legacy_kind = 'bmr'` and the batch's `legacy_number` (item 24, `docs/data-migration-plan.md` §14) | Table |
| M | Audit trail appendix | State transitions (from, to, actor, time, reason), corrections (`supersedes_id` chains for dispense, readings, test results, yield), voids, exception approvals, reopen/amend events, document generations and reprints of this batch | `batch_state_transitions`, record `supersedes_id` chains, `audit_events` filtered by `entity_type/entity_id` of the batch and its children, `generated_documents` | `break-before: page`; `thead` repeats; may be landscape (named page `audit`) when the template sets it |

Page 1 sketch (A4 portrait, zones only; names and numbers are fictional seed-style examples):

```
+------------------------------------------------------------------------------+
| [logo] Bryel's Care Corporation   BATCH MANUFACTURING RECORD    DOC-26-0000123 |
|        Acapulco Soap · B-S1-261012-001 · ACS-F01 rev 3   BMR-SOAP-STD v2 · DRAFT|
+------------------------------------------------------------------------------+
| A  Product / SKU | Batch no. | Formula rev | Routing rev | Dept | Site / Line  |
|    Batch size 17,600 g | Planned 12–13 Oct 2026 | Started 12 Oct 08:05 | WO …  |
|    Revisions used: formula v3 (eff. 01 Oct 2026) · routing v2 · WI-MIX v4 …    |
| B  State: IN PROCESS (step 4 of 7) · Deviations open: 0 · Holds: none           |
+------------------------------------------------------------------------------+
| C  DISPENSING AND WEIGHING (phase: oils)                                       |
|  # | INCI / common / code | Lot (supplier lot) | Exp | Theoretical | Tol |      |
|    | Actual | UOM | Scale | Dispensed by / at | Checked by / at | Dev          |
|  … rows …                                                                      |
|  TOTAL (oils)                                                                  |
+------------------------------------------------------------------------------+
| Generated 12 Oct 2026 14:02 by M. Reyes · S1 |  B-S1-261012-001  | Page 1 of 9 |
| Template BMR-SOAP-STD v2 · checksum 9f3a21c0 · file 51be07d2 · Source rev       |
| 2026-10-12T06:02:11Z · Printed copies are uncontrolled unless signed · [QR DOC] |
+------------------------------------------------------------------------------+
```

### 2.3 Page-break and layout rules specific to the BMR

1. Sections A and B always on page 1; section C starts on page 1 if at least five rows fit, otherwise on page 2.
2. Every page carries batch number, product and document number in the running header (§1.5); a page without them is a test failure (AC-18).
3. Tables repeat their header row; no row, sub-row group or signature block is split across pages.
4. Section J starts a new page by default; section M always starts a new page.
5. Struck-through values (voided or superseded records) are printed in the same cell with the reason in a 7.5 pt line beneath; the current value is printed in bold. Nothing is hidden.
6. Long instruction text is rendered from markdown with headings demoted to h3; images from `work_instruction_revisions.file_attachment_id` are embedded at a maximum height of 60 mm.
7. Blank rows are not added for handwritten completion unless the template option `handwritten_rows` (default off) is set for a hybrid site (§2.5).

### 2.4 What changes per product routing

Nothing in the renderer is product-specific. The batch snapshot drives sections C, D and E:

| Driver | Soap example (Acapulco Soap, from the paper BMR; verify with authorized personnel before production use) | Lotion example (illustrative only; to be configured by process owners) |
|---|---|---|
| `routing_steps` (count, kinds, names) | 7 steps: line_clearance (weighing), dispensing, line_clearance (production), process (mixing, moulding, cutting as sub-steps), line_clearance (packaging), packaging, transfer | line_clearance, dispensing per phase group (water, oil, additives), process (heat water phase; heat oil phase), process (emulsify), process (cool), process (add heat-sensitive), in_process_qc, hold (bulk intermediate), filling, packaging, transfer |
| `routing_step_parameters` | None on the paper form; expected: mixing time, temperature, trace, mould id (Q-PR-04) | Temperatures, times, homogenizer speed, pH / viscosity / appearance (examples only), fill weight per container with tolerance |
| `bom_lines.phase_code` groups in C | oils, lye, additives | water phase, oil phase, additives |
| Intermediates | 33.33 % Lye Solution and 6 % Green in Oil are intermediate lots with their own BMR (A-PROC-04/A-PRD-27); their lot numbers print in C and their BMR document numbers print in L | Bulk emulsion as an intermediate output lot (`batch_outputs.output_kind = 'intermediate'`), then a filling batch consumes it |
| Optional `curing`/`hold` step (A-PROC-05) | Off until confirmed | Bulk hold with minimum duration |
| Output basis (A-PROC-33) | Mass and/or bars | Filled units per container size |
| Template | `BMR-SOAP-STD` | `BMR-LOTION-STD` (same renderer, different section options and labels) |

### 2.5 Hybrid paper and electronic completion policy

The to-be process captures the BMR electronically (W05). Paper is used only where the company's SOPs require handwriting (brief module 7). Policy defaults (A-RPT-06, Q-QA-05):

| Mode (per routing step, configuration) | What happens | Record |
|---|---|---|
| `electronic` (default) | Operator and checker complete the step on the device; the printed BMR shows "Electronically recorded by <name> on <time>" | `process_step_records`, `dispense_records`, audit |
| `paper_then_transcribe` | The step is completed on a pre-printed BMR page (generated with `handwritten_rows = true`), then transcribed into the system by the operator; the page is scanned/photographed and attached to the step; a **reviewer different from the transcriber** confirms the transcription | `file_attachments` (`attachment_kind = 'paper_record_page'`) linked to the step record through `batch_paper_records` (`page_no`, `transcribed_by/at`, `reviewed_by/at`; reviewer ≠ transcriber enforced) |
| `paper_only` | Not supported for dispensing, outputs or disposition (these must be system records for traceability and stock posting); allowed only for free-text procedure notes | attachment only |

Rules: a batch cannot leave `awaiting_qc` while any `paper_then_transcribe` step lacks a reviewed attachment; both the scanned page and the transcribed record are retained; the final BMR lists the pages in section L with their hashes; the signed paper copy is the controlled record until QA validates electronic signatures (§11), and the generated PDF is the controlled record afterwards. Which copy is controlled is a QA decision, recorded as configuration `documents.controlled_record = paper | electronic`.

### 2.6 Document state versus batch state

| Batch state (`docs/data-model.md` §6.2) | Watermark | Generation allowed | Notes |
|---|---|---|---|
| draft, planned | `DRAFT` ("NOT STARTED" in the header line) | yes (planning copy, dispensing sheet) | Values may change until `planned` freezes revisions |
| materials_staged, in_process, awaiting_qc | `IN PROGRESS` | yes | Used for shift handover or hybrid pages |
| quarantined | `UNDER QA REVIEW` | yes | QA reviews on screen; printing is optional |
| released, rejected, rework_approved | `FINAL – PENDING CLOSURE` | yes | Disposition printed |
| closed | `CONTROLLED COPY` (first generation at W05-20 by the system), `REPRINT n` afterwards | yes | The closure transaction enqueues the final generation; its `generated_documents` row is linked from the closure audit event |
| closed → in_process \| quarantined (CX-REOPEN, `production.batch.admin`) → … → closed | `AMENDED rev n` | yes | Each closure after a reopen regenerates; earlier documents become `SUPERSEDED` and stay downloadable |

---

## 3. Weighing / dispensing sheet

| Item | Specification |
|---|---|
| Purpose | Worksheet for W05-05..09: what to weigh, from which expected lot, with which scale, within which tolerance; hybrid capture of actuals where the site runs `paper_then_transcribe`. Content requirement from the brief: batch, ingredient, target, tolerance, actual, UOM, lot, scale, operator, checker, deviations. |
| Produced at | W05-05 (materials staged) and on demand; regenerated after CX-MAT substitution |
| Template | `document_templates.template_kind = 'dispensing_sheet'`; dataset `dispensing_sheet/v1`; A4 portrait |
| Header | As §1.5 plus batch size, formula code/revision, dispensing sequence note, scale(s) assigned to the line with calibration due dates (`equipment.calibration_due_date`), weighing-area clearance status |
| Rows (one per `batch_materials` line in `bom_lines.sequence` order, grouped by phase) | Line no., INCI name, common name, material code, **expected lot** (`stock_allocations`/`stock_reservations` → `inventory_lots.lot_number`, supplier lot, expiry/retest, staged location), target quantity with UOM, tolerance (± % and absolute range), `requires_checker`, `is_critical`; completed sheets add actual (tare/gross/net), scale code, dispensed by/at, checked by/at, within-tolerance, deviation number |
| Totals | Σ target and Σ actual per phase and overall with the rounding note (F-05) |
| Hybrid columns | When `handwritten_rows = true`: blank actual / scale / operator / checker / time cells, 9 mm row height |
| Scannable codes | Only the footer `BC:DOC`. The sheet deliberately prints **no** `BC:LOT` codes (A-RPT-15): the operator must scan the physical container label at W05-07, otherwise a wrong container could be weighed against a correct-looking sheet |
| Never printed | Formula percentages (A-PM-16), unit costs |
| Permissions | generate: `production.batch.view` + `documents.generated_document.create`; reprint: `documents.reprint.create` |
| Page breaks | `thead` repeats; a phase group header stays with its first row; totals with the last two rows |

---

## 4. Production traveler

| Item | Specification |
|---|---|
| Purpose | The sheet that physically follows the batch through the steps (glossary, `docs/PRD.md` §12): which step is next, what to check, which equipment, where the batch is; the operator's quick reference when the device is elsewhere. |
| Produced at | W05-03 (with the batch) and regenerated at each state change on demand |
| Template kind / dataset | `traveler` / `traveler/v1`; A4 portrait, 1–3 pages |
| Content | Header (batch identity, product, batch size, line, planned dates, current state and step "n of m"); per step: step number, name, kind, equipment class or unit, required checks (parameters with limits, in-process QC tests by name only), instruction summary (first 300 characters of the instruction with its revision number), prerequisites, expected duration, operator and checker boxes (printed name when done, blank line otherwise), completion time; storage and hold instructions (curing minimum, quarantine location); contact for QA |
| Codes | Footer `BC:DOC` opens the batch execution screen for users with `production.batch.view`; no `BC:LOT` of the output (it does not exist until W05-17) |
| Hybrid | Boxes are for ticking by hand; the system record remains authoritative; a ticked traveler is attached as a paper page if the SOP requires |
| Page breaks | One step block never splits; steps 1–7 of the soap route fit on one page |

---

## 5. Packaging / boxing note and packing list

| Item | Specification |
|---|---|
| Purpose | Evidence of what went into which box (W08-05) and the list that accompanies a shipment (W09-07). One template kind (`boxing_note`) with two variants: `batch` (boxing at the end of W05) and `order` (packing for a sales order, customer overrides applied). |
| Dataset | `boxing_note/v1`: `packs`, `containers`, `container_contents`, `inventory_lots`, `skus`, `sales_orders`/`sales_order_lines` (order variant), `customers`, `customer_addresses`, `customer_requirements` (approved revision used: carton count, shipping marks, artwork version) |
| Header | Pack number, batch number or order number, customer (order variant), SKU(s), lot(s), packed date, packer, checker (`packs.checked_by`, `containers.checked_by`), config source ("customer requirement CR-… v2" or "SKU default" with the `default config used` flag for `sales_cs` review) |
| Box rows | Box id (`containers.container_number`), container kind, SKU, lot, expiry, quantity per box (`container_contents.qty_base`), `PARTIAL` marker, gross / net weight when captured (`containers.gross_weight/net_weight` + `weight_uom_id`), pallet id when on a pallet (`parent_container_id`), status (`sealed`), location at generation |
| Totals | Boxes, units, by SKU and lot; Σ gross/net; expected boxes from `skus.units_per_box` vs actual, with the reconciliation difference against lot output (W08-04 block rule) |
| Shipping marks | Customer marks text and artwork version (customer requirement `label_artwork`), printed verbatim |
| Signatures | Packed by, checked by (printed names and times); handwritten lines when hybrid |
| Versioning | Repack (W08-07) regenerates: "Packing list v2" is a new `generated_documents` row; v1 superseded; lineage printed ("replaces DOC-…") |
| Privacy | Customer-facing copy (order variant) prints internal people as role titles unless `documents.print_internal_names = true` (A-RPT-07); it never prints internal locations, costs or other customers |
| Page | A4 portrait; landscape when gross/net weights and pallet columns are on; `thead` repeats; totals block kept together |

---

## 6. Pick list

| Item | Specification |
|---|---|
| Purpose | Guide the picker through W09-06 by location, showing the FEFO/FIFO-recommended lots and boxes, and give a paper fallback for short-pick reasons. The on-screen version is primary (`docs/ux-system.md` §9.7). |
| Dataset | `pick_list/v1`: `picks`, `pick_lines` (progress), `stock_allocations`, `inventory_lots`, `containers`, `locations`, `sales_orders`, `sales_order_lines`, `customer_requirements` (min remaining shelf life, max lot age) |
| Header | Pick number, order number, customer code and name (no address on the internal copy), requested delivery date, picker, created by/at, allocation rule in force (FEFO / FIFO per SKU) |
| Rows (grouped by zone → location code in walk order) | Location code, SKU code and name, lot number, expiry, FEFO rank among allocated lots, box id (or "loose units"), quantity to pick (base and entered UOM), picked quantity (blank cell on paper; `pick_lines.qty_base` when printed after picking), short-pick reason (blank), status text |
| Blocks shown | Lines whose lot status changed since allocation print `BLOCKED – <status>` and a note to re-allocate (W09 exception path) |
| Scannable codes | Footer `BC:DOC` only (A-RPT-15): the picker must scan the physical box or lot label; printing `BC:BOX` on the list would allow confirming a pick without touching the box |
| Page | A4 portrait (landscape option for many columns); each location group header stays with its first row |
| Permissions | `sales.pick.view`; never visible to `customer_portal_user` |

---

## 7. Delivery receipt (DR) and acknowledgment

| Item | Specification |
|---|---|
| Purpose | Document that accompanies a dispatched shipment and returns signed (W09-08, W09-09). Stock is issued by the dispatch posting, never by creating or printing the DR (ADR-006; `docs/data-model.md` §6.8). The DR number comes from numbering rule `DR` and is allocated in the dispatch transaction. |
| Dataset | `delivery_receipt/v1`: `delivery_receipts`, `shipments`, `shipment_lines`, `containers`, `container_contents`, `inventory_lots`, `sales_orders`, `sales_order_lines`, `customers`, `customer_addresses`, `organizations`/`sites` (ship-from) |
| Header | Company legal name, ship-from site address, DR number, shipment number, sales order number, customer PO number, customer name and ship-to address, contact, dispatch date and time, carrier, tracking number, driver name, vehicle plate, number of packages, Σ gross weight when captured |
| Lines | SKU code and name, lot number, expiry (when the customer requires it), box ids (comma list or one row per box per `documents.dr_box_detail`), quantity shipped (entered UOM and base), ordered quantity and remaining (partial shipments, A-PROC-15) |
| Statutory and commercial content | Prices are **not** printed by default (`documents.dr_show_prices`, requires `sales.price_list.view` to enable); tax identifiers, "not valid as an official receipt"-style wording, serial requirements and any mandatory statement are **configuration validated by the accountant** (A-RPT-12); nothing legal is hard-coded |
| Received-by block | Received by (name), position, date/time, signature line, remarks (short, damaged, refused boxes) |
| Acknowledgment capture (W09-09) | Name typed, drawn signature image or photo of the signed paper copy stored as `file_attachments` (`attachment_kind = 'signature'`, `is_sensitive = true`), time; the acknowledged DR is **regenerated** with "ACKNOWLEDGED <time>" and the image embedded; this is evidence, not an electronic signature (§11, A-RPT-14) |
| Copies (A-RPT-13) | 3 by default: Customer, Driver (returned signed), File; copy name printed in the header; configurable per site |
| Reprint | `documents.reprint.create`; reason mandatory; audited (`docs/process-maps.md` §5) |
| Portal (Phase 8) | Customer may download their own acknowledged DR; it must contain no internal locations, notes, other customers, costs or employee names (role titles only) |
| Page | A4 portrait; lines table `thead` repeats; received-by block `break-inside: avoid` and kept on the last page with at least the totals |

---

## 8. Labels

### 8.1 Payload grammar (ADR-017, `docs/security.md` §2.7)

`BC:<TYPE>:<VALUE>` where `TYPE` ∈ `LOT` (`inventory_lots.lot_number`), `BOX` (`containers.container_number`), `LOC` (`locations.code`), `MAT` (`materials.code`), `SKU` (`skus.code`), `EQP` (`equipment.code`, A-PROC-42, accepted in ADR-017 and `docs/data-model.md` §9.5), `DOC` (`generated_documents.document_number`). `VALUE` matches `^[A-Z0-9][A-Z0-9._-]{0,63}$` (1–64 characters; the same CHECK as `docs/data-model.md` §9.4 and `docs/security.md` §4.9); uppercase only so QR alphanumeric mode applies (smaller codes). Numbering rules must emit only letters, digits, dot, underscore and hyphen. The payload is never a URL and never carries quantity, status or dates: those are read from the server at scan time so a stale label cannot mislead. Any other string scanned is "not recognised" (W02-01). Human-readable text under the code repeats the value, not the prefix.

### 8.2 Symbology and rendering

| Item | Rule |
|---|---|
| Default | QR Code, error correction M, module ≥ 0.5 mm at 203 dpi (4 dots), quiet zone ≥ 4 modules and ≥ 2 mm; minimum symbol 18 × 18 mm on 50 × 30 labels, 28 × 28 mm on 100 × 50, 40 × 40 mm on 100 × 150 |
| Alternative (per `label_templates.symbology`) | Code 128 subset B, X-dimension ≥ 0.25 mm (2 dots at 203 dpi), height ≥ 10 mm, quiet zone ≥ 10 X; used where the company's linear scanners cannot read QR |
| Retail barcode | `skus.gtin` as EAN-13 on finished-goods unit labels is a later option (`label_templates.symbology` already allows `ean13`; ADR-017 lists it when retail barcodes are scheduled) |
| Rendering | Vector SVG inside the HTML, generated server-side (`qrcode`/`bwip-js`-class library), never raster; the encoded text printed below in 7 pt mono for manual entry (component 5.19 in `docs/ux-system.md` §5) |

### 8.3 Label catalogue

Sizes are assumptions (A-RPT-08; A-UX-04, A-PRD-05). Every label prints: company mark (small), label kind word, the code, the human-readable id in ≥ 12 pt bold, the fields below, template code and version in 5 pt, and a short hash of `label_jobs.id` for reprint tracing.

| Label | `label_templates.applies_to` | Default media | Payload | Human-readable content | Produced at |
|---|---|---|---|---|---|
| Raw material container | `material` | 100 × 50 mm (drums, sacks); 50 × 30 mm variant for small containers | `BC:LOT` | Material code and name (common name; INCI on the 100 × 50 variant), internal lot, supplier lot, supplier code, received date, expiry **or** retest date (labelled which), quantity per container with UOM, container n of N, storage conditions (short), allergen/hazard words from `materials.allergen_notes/hazard_notes` (content validated by QA), status word at print (`QUARANTINE` / `RELEASED` / `ON HOLD` / `REJECTED`) plus "Scan to verify current status" | W01-07, reprint at W01-10 (status change), W02-07 |
| Intermediate / WIP | `wip` | 100 × 50 mm | `BC:LOT` (intermediate output lot) | Intermediate name and code, batch number that produced it, lot number, made on, use-by (= expiry), quantity, status word, "INTERMEDIATE – not for sale" | W05-17 of the intermediate batch |
| Finished goods lot (bulk / tray) | `finished_good` | 100 × 50 mm | `BC:LOT` | Product and SKU, lot number, batch number, manufactured date, expiry, quantity (units), status word (`QUARANTINE` at W05-17, `RELEASED` on reprint after W05-19), "Scan to verify current status" | W05-17, reprint at W05-19 |
| Finished goods unit (consumer pack) | not a system label | — | — | The regulatory artwork (INCI list, net content, claims, manufacturer, batch/expiry marking) is the company's regulatory responsibility and is printed by the packaging supplier or an overprinter; the system only records the artwork version used (`customer_requirements.label_artwork`, `skus.label_template_id`) and, where the printer is in scope later, prints the lot/expiry overprint fields alone (A-RPT-11) | W05-15 |
| Box / carton | `carton` | 100 × 50 mm | `BC:BOX` | Box id, SKU code and name, lot number, expiry, units in box (`PARTIAL` when flagged), packed date, packer initials, customer marks when the order variant applies, status word inherited from the lot, "Box n of N" when known | W08-02, W02-04..06 (split/merge/repack), W08-07 |
| Pallet / shipment unit | `pallet` | 100 × 150 mm | `BC:BOX` (a pallet is a `containers` row with `container_kind = 'pallet'`) | Pallet id, customer and ship-to (order variant), SKU/lot summary (up to 6 lines, then "see packing list"), box count, Σ units, Σ gross weight, dispatch date, shipment and DR numbers when dispatched | W08-06, W09-08 |
| Storage location | `location` | 100 × 50 mm (rack/bin), 100 × 150 mm (zone signs) | `BC:LOC` | Location code (large), name, warehouse code, kind word (`QUARANTINE`, `HOLD`, `REJECTED`, `RECALL`, `STAGING`, `RECEIVING`, bin), allowed statuses, "Scan before placing stock" | Location set-up (`docs/data-migration-plan.md`), reprint on demand |
| Sample | `sample` | 50 × 30 mm | `BC:LOT` of the sampled lot | `SAMPLE`, inspection number, lot number, material/product, sampled by/at, quantity, "Not for use" | W06-02 |
| Equipment | `equipment` | 50 × 30 mm | `BC:EQP` | Equipment code and name, kind, calibration due (at print), "Scan before use" | W13-01 |

Status words are evidence of the status **at print time**; the system status wins (W02-02 shows it at scan). Default policy (A-RPT-10): a disposition that changes a lot's status queues a reprint job for that lot's labels (`labels.reprint_on_status_change = on` for lots, `off` for boxes, whose status is inherited and verified by scan). Until the reprinted label is applied, the operator sees the mismatch on the scan card.

### 8.4 Label layout sketches

```
100 x 50 mm raw material (203 dpi)            50 x 30 mm sample / small container
+--------------------------------------+      +-----------------------+
| [QR 28mm]  RAW MATERIAL   Bryel's    |      | [QR 18mm] SAMPLE      |
|            RM-COCONUT-OIL            |      |           L-2610-00042|
|            Cocos Nucifera Oil        |      |          INS-26-00007 |
|            LOT  L-2610-00042  (bold) |      |  12 Oct 2026 · 50 g   |
|            Sup. lot CNO-77812 · SUP1 |      |  Not for use          |
|  Rcvd 12 Oct 2026   Exp 12 Apr 2027  |      +-----------------------+
|  20.000 kg · drum 2 of 10 · Cool,dry |
|  STATUS AT PRINT: QUARANTINE         |
|  Scan to verify current status       |
| L-2610-00042        LBL-RM-100x50 v1 |
+--------------------------------------+
```

### 8.5 Printer handling (Phase 2: browser PDF to thermal; no ZPL)

1. A label print is a `label_jobs` row (`queued`) created by the operator's action (W01-07, W08-02) or by a status-change trigger; `copies` = containers; `idempotency_key` prevents double jobs from a double tap.
2. The worker renders one PDF per job with `@page { size: <width>mm <height>mm; margin: 0 }` and one label per page (`preferCSSPageSize: true`), vector output safe at 203 or 300 dpi; a `generated_documents` row of kind `label` links the file (`rendering → ready`).
3. Printing uses the device's print dialog (desktop Chrome/Edge with the thermal printer driver; Android print service; iOS AirPrint for network printers). The media size must be selected once per printer and saved as the printer default; the print dialog must be set to "Actual size / 100 %" (no fit-to-page). A **print station** page (A-RPT-09) lists `ready` jobs for a site so phones can trigger labels that a tablet or PC next to the printer prints; the station marks the job `printed` (`printed_by`, `printed_at`, `station_device_registration_id`; audit `documents.label_job.printed`; status `printed` means "sent to the printer", because browsers cannot confirm physical output).
4. `printer_name` records which configured printer was chosen; failures (`failed`, `error_message`) appear in the Action Center; a job can be retried without creating a new label identity.
5. No vendor printer language in Phase 2 (A-PRD-05). A raw-socket ZPL/TSPL adapter is a later enhancement behind the same `label_jobs` table if the company's printers support it; the payload and layout rules stay the same.
6. Reprint: `label_jobs.reprint_of_id` + reason code (`reason_codes.applies_to ∋ 'reprint'`); audit `documents.label_job.reprinted`; the lot/box card shows the reprint count. A label that no longer matches its contents (repack, split) is voided (`label_jobs.voided_at/voided_by/void_reason`; audit `documents.label_job.voided`) and listed on the scan card as "superseded label — destroy".
7. Not configured state: "Label printing isn't set up for Site A yet" with no fake success (`docs/ux-system.md` §6).

---

## 9. Stock card, attendance exception report, purchase documents, invoices, configurable reports

| Document / report | Phase | Dataset and content | Page / format | Permission and audit |
|---|---|---|---|---|
| Stock card / movement report (FR-inventory-13) | 2 | Scope: one lot (default) or one material/SKU across lots, optionally one location; date range. Opening balance at the from-date computed from `stock_movements` (ledger, not the projection; A-RPT-16); for a lot loaded at go-live the first row is the opening-balance goods receipt (`goods_receipts.receipt_kind = 'opening_balance'`, receipt number, reason `opening_balance`) and the lot page/stock card header links the matching `legacy_documents` row (`legacy_number`, `LDOC` number) when one exists (`docs/data-migration-plan.md` §14); then each movement: date/time, `movement_number`, type, from → to location, container, quantity in / out (base UOM), running balance, `quality_status_at_posting`, source document type and number, posted by, reason code/note, `reversal_of_id` marker; closing balance; a reconciliation line comparing the closing balance to `inventory_balances` (any difference printed and flagged with `!`, never hidden) | A4 landscape; `thead` repeats; CSV/XLSX export | `inventory.movement.view` (+ `.export` for files); `platform.export.created` |
| Goods receipt document / discrepancy note (W01-06, W01-04) | 2 | `goods_receipts`, `goods_receipt_lines`, `inventory_lots` created, `supplier_lot_documents` listed; discrepancy kind and note per line; received by, posted by/at | A4 portrait | `procurement.goods_receipt.view` |
| Count sheet (blind) and variance report (W03) | 2 | Count sheet: location codes and items in scope **without quantities** when `is_blind`; variance report: expected (frozen), counted, recount, variance, reason, approver | A4 portrait / landscape | `inventory.stock_count.view` |
| Hold notice (W06-07, W07-02) | 2 | Hold number, scope (lots/boxes/locations), reason, opened by/at, instructions ("do not use, move only to hold location"); printed to attach physically | A4 or 100 × 150 mm label | `quality.hold.view` |
| Certificate of analysis (W06 exception path) | 3 | Per released lot: product/SKU, lot, batch, manufactured, expiry, tests with method, specification, result, unit, pass; approved by (QA), date; customer name when customer-specific; wording and which tests appear are QA configuration | A4 portrait | `quality.test_result.view` + `documents.generated_document.create`; customer-facing, reprint audited |
| Deviation / investigation / traceability / recall reports (W07) | 3–4 | From `deviations`, `capas`, genealogy query (point-in-time, with "as of" timestamp), `recall_cases` | A4 | `quality.*.view` |
| Attendance import exception report (W10-05, brief table) | 5 | `attendance_imports` header: import number, original file name, sha256, size, uploader, upload time, mapping code/version, period; counters (`rows_total`, accepted, duplicate, unknown employee, missing punch, out of range, error); row list (`row_no`, parsed identifier, employee number and name only (A-RPT-17), parsed time, result, message, resolution, resolved by/at, correction link); corrections appended after posting; reviewed by, posted by/at (posted ≠ uploaded where the rule requires); approver of corrections | PDF (A4 landscape) and XLSX; HR only | `hr.attendance_import.view`; export audited `hr.attendance_event.exported`; never cached on devices |
| Purchase order (W04-06) | 6 | `purchase_orders`, lines (material code, name, supplier part number, quantity and UOM, expected date, unit price and line amount when the viewer holds pricing view), supplier, ship-to warehouse address, payment terms, approved by/at (role title on the supplier copy), notes; tax lines from configuration (accountant) | A4 portrait; emailed PDF | `procurement.purchase_order.view`; `documents.generated_document.generated` |
| Supplier return note (W04-09) | 6 | Return movement, lot, quantity, reason, QA status at return | A4 | `procurement.purchase_order.view` |
| Invoice / statement of account (W09-10, ADR-020) | 6 (later) | Designed with the finance specialist in `docs/modules/finance.md`: gapless `invoice_number`, tax configuration reference, customer bill-to, lines from the dispatched shipment, totals, payment terms, bank details (sensitive); statement = open invoices and payments per customer. Mandatory legal content is accountant-validated configuration; nothing is asserted here | A4 | `finance.invoice.view`; restricted |
| Payslip (Phase 6, ADR-021) | 6 (later) | HR specialist scope; restricted; generated only after qualified sign-off | A4 | `hr.payslip.view` |
| Quotation / order confirmation (W09-01/03) | 4 | `quotes`/`sales_orders` lines, prices (pricing view), validity, terms text from configuration | A4 | `sales.quote.view` |
| Configurable reports (W11, brief module 12) | 5 | Report registry entry per report code: parameter schema (date range, site, product/SKU, customer, line, status), dataset query, default template (`template_kind = 'report'`), allowed formats. Every report prints: title, filters as entered (`generated_documents.parameters`), generated at, generated by, data refresh time, KPI definition footnotes (definition, calculation, time basis, source tables), "actual / estimate / forecast / overridden" labels on values, row count and a truncation notice above the row cap (A-RPT-18), site scope line ("Sites: S1, S2"). Drill-down is on screen, not in the PDF | PDF (A4 portrait/landscape), CSV, XLSX; scheduled delivery (`scheduled_reports`) | `analytics.report.view` / `.export`; `platform.export.created` (sensitive classes restricted) |
| Spreadsheet safety | all | CSV/XLSX cells that start with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'`; numbers exported as numbers with the base UOM in the header; no formulas; UTF-8 BOM for CSV | | `docs/security.md` |

### 9.1 Configurable reports as built (Wave 3 W3B, US-5-04, US-5-05, US-5-14)

| Item | As built |
|---|---|
| Registry | Code-defined report definitions in `src/modules/reports/defs/*` (parameters, scoped SQL, columns, footnotes, value label, time basis, sources), listed in `registry.ts`. The organization switches a report on or off and adds an owner note (`report_definitions`, `analytics.report.admin`, audit `analytics.report_definition.changed`) |
| Reports | `RPT-INV-STOCK` (stock on hand, quantities only), `RPT-INV-EXPIRY` (30/60/90 buckets), `RPT-INV-MOVEMENTS` (ledger, reversals marked), `RPT-INV-RECEIPTS`, `RPT-PRD-BATCHES` (yield from the current yield record; overall yield from summed masses), `RPT-PRD-WORK-ORDERS` (lateness), `RPT-QUA-DISPOSITIONS`, `RPT-QUA-DEVIATIONS` (text needs `quality.test_result.view`), `RPT-QUA-HOLDS`, `RPT-SAL-ORDERS`, `RPT-SAL-SHIPMENTS`, `RPT-AUD-EXTRACT`, `RPT-SEC-ACCESS` (weekly, organization-wide roles only). Catalogue entries without data yet (valuation, OTIF, HR import, supplier, finance, owner digests) are listed as planned, never run |
| Output contract | Every screen, file and print carries: title and code, filters as entered and site scope, generated at (organization time zone) and by, data freshness ("Live: read from posted records at …"), value label (Actual), footnotes (definition, time basis, sources, owner note, omitted columns), row count, totals of the listed rows, truncation notice. Screen: `reports.screen_rows` (500); files: `platform.export.max_rows` (50,000, A-RPT-18) with "Truncated" in the header instead of a refusal |
| Formats | CSV and XLSX through `src/lib/export.ts` (`runExport` gained the optional `overflow: "truncate"`, `headerExtras` and `generatedBy`); printable HTML (`/print/reports/<code>`, browser print / Save as PDF per ADR-026) and an escaped HTML file for scheduled delivery. No server PDF |
| Permissions and audit | Run: `analytics.report.view` + the module view permission at each site in scope (per assignment). Files and print: + `analytics.report.export` + the module `.export` permission where one exists. Audit `platform.export.created` and `analytics.report.exported` (files), `analytics.report.printed` (print page) |
| Scheduled delivery | `scheduled_reports` (daily / weekly / monthly at a local time, A-W3B-04), `scheduled_report_recipients`, `report_runs`, `report_run_files`. The worker rebuilds every recipient's context, skips and logs those who lost access and notifies the schedule owner, renders one file per (site scope, visible columns) group, notifies in-app and emails a sign-in link (never data). Files are downloadable only by their recipients with access re-checked, and are cleared after `reports.file_retention_days` |

---

## 10. Print specifications

| Item | Rule |
|---|---|
| Default page | A4 portrait 210 × 297 mm (`docs/ux-system.md` §10; A-UX-05 / A-RPT-25: Letter per site). Landscape allowed for stock card, pick list, audit appendix, attendance exception report, wide reports. |
| Margins | Top 24 mm (running header 14 mm + 4 mm gap), bottom 20 mm (footer two lines + QR 12 mm), left/right 15 mm; body content area 180 × 253 mm. Labels: margin 0, internal padding 2 mm, quiet zones per §8.2. |
| Fonts | Inter (variable) embedded in the worker image and the PDF; fallback Arial/Helvetica for preview; `ui-monospace`/DejaVu Sans Mono for identifiers. A4 body 10 pt / line 14 pt; table cells 8.5 pt / 11 pt; captions 7.5 pt; identity line 11 pt bold; signature names 10 pt. Labels: identifier ≥ 12 pt bold, fields ≥ 7 pt (A-UX-04 minimum), template footer 5 pt. Numbers use `font-variant-numeric: tabular-nums`, right-aligned, units in the column header. |
| Contrast and colour | Black text on white regardless of theme; status chips print as text with a 1 px border and the icon glyph; the only colour is the 12 % watermark and optional brand mark; colour is never the only carrier of meaning (reconciliation differences are also marked with `!`) |
| Print stylesheet (`src/modules/documents/print.css`, also loaded by on-screen preview) | `@media print` and the renderer root class: hide app shell, nav, buttons, sticky bars; expand collapsed sections; `table { border-collapse: collapse } thead { display: table-header-group } tfoot { display: table-footer-group } tr, .avoid-break { break-inside: avoid } .page-break { break-before: page }`; `@page { size: A4 portrait }` with named pages (`@page audit { size: A4 landscape }`) where the template allows; links show no URL; images `max-height: 60mm`; strike-through `.superseded` with reason line; `-webkit-print-color-adjust: exact` for the watermark only |
| Chromium PDF options (worker) | `format` from `page.size`, `printBackground: true`, `displayHeaderFooter: true`, `headerTemplate`/`footerTemplate` built from §1.5 with `<span class="pageNumber">`/`<span class="totalPages">`, `margin` as above, `preferCSSPageSize: true`, `scale: 1`, timeout 60 s, Chromium memory cap per ADR-016; PDF metadata Title = `<kind> <record id>`, Subject = `document_number`, Keywords = `template code vN; checksum` |
| Labels | `@page { size: <w>mm <h>mm; margin: 0 }`; one label per page; no header/footer templates; the preview shows actual size at 100 % zoom (component 5.19 in `docs/ux-system.md` §5) and a 50 mm ruler mark on the test page for scaling checks |
| Preview | Same HTML and CSS in a sandboxed iframe (`sandbox` attribute, no scripts) before the PDF exists; page thumbnails from the PDF when ready; "Print / download PDF" always downloads the stored PDF (never the live HTML) so the printed artefact is the audited one |
| File naming | `<kind>_<record-id>_<document_number>_v<generation>.pdf` (for example `BMR_B-S1-261012-001_DOC-26-0000123_v1.pdf`); labels `LBL_<applies_to>_<entity id>_<job id short>.pdf` |
| Accessibility of PDFs | Tagged PDF on (`page.pdf({ tagged: true })` where the Chromium build supports it); logical reading order follows the section order; alt text on the brand mark and QR ("QR code BC:DOC:<number>") |

---

## 11. Revision rules and approval / signature assumptions

### 11.1 Template versioning

1. Templates follow the `ver` + `approval` sets (`docs/data-model.md` §4.2): `draft → pending_approval → approved → retired`; `submitted_by ≠ approved_by`; effective-dated; approved ranges never overlap per template.
2. Permissions (`docs/permissions-matrix.md` §3.7): create/edit/submit by `site_manager`, `production_planner`, `system_admin`; **approve** only by `qa_qc` (and `owner_director`). A-RPT-21: QA therefore approves every document template in Phases 2–4, including pick lists and DRs; if that is too heavy, the owner may grant `documents.template.approve` for non-quality kinds to `site_manager` by role configuration.
3. Label templates: `masterdata.label_template.approve` (QA) approves the physical configuration; its layout is a `document_templates` row of kind `label` approved as above. A label job may only use an approved template version effective on the print date.
4. A new template version never changes an existing document: `generated_documents.document_template_version_id` is fixed, and batches keep `bmr_template_version_id` from creation (`docs/data-model.md` §4.4). A batch created under v2 renders with v2 forever; a reopen/amend does not change the template version (CX-REOPEN only regenerates the content).
5. Each generation of the same source and kind increments a per-record document revision shown as `Rev n` in the header (`generated_documents.record_revision_no`, count of non-reprint generations); reprints show `REPRINT n` and inherit the revision.
6. Test page: every approved template version has a rendered test PDF (seed dataset) attached to the version as evidence (`file_attachments.attachment_kind = 'template_test_page'`), reviewed at the gate in §12.

### 11.2 Signature and e-record assumptions (quality-regulatory rules, binding caution)

| Topic | Default (configurable) | Owner / QA confirmation |
|---|---|---|
| Electronic sign-off | An authenticated user action with re-entered credential (PIN/password, A-UX-02/A-PRD-14), stored as actor + time + record revision + audit event. The document prints "Electronically recorded by <name> on <date time> (user <code>)". It is an **attestation, not a validated electronic signature**. | QA (Q-QA-05, Q-RPT-Q01) |
| Reliance on e-records for regulated purposes | Not claimed. Formal validation (procedures, training, system validation, access control review) is required before the company relies on electronic sign-offs in place of handwritten signatures. Until then: hybrid record (§2.5), handwritten lines on the final BMR, CoA and DR. | QA |
| Checker and approver identity | Second person on the same shared device re-authenticates (A-UX-08); the same session can never act as both operator and checker (V-SOD). Printed names are `users.display_name` + user code; employee numbers never print. | QA, HR |
| Customer acknowledgment on the DR | Drawn image or photo is evidence of receipt only (A-RPT-14); legal weight is for the company and the accountant to assess. | Accountant, Sales |
| Printed copies | "Printed copies are uncontrolled unless signed" by default (wording validated by QA); a signed paper copy's controlled status is QA policy (`documents.controlled_record`). | QA |
| Corrections | Never overwrite; superseded values print struck through with reason, actor and time (§2.3); the audit appendix is part of the final BMR by default (A-RPT-23). | QA |
| Retention | PDFs and attachments retained with their source record class (`docs/security.md` §7: batch and quality records 5 years after expiry, minimum 7 years, A-SEC-25; label PDFs 90 days, job rows kept, A-RPT-20). Values are configuration validated by QA and the accountant. | QA, Accountant |
| Document QR | `BC:DOC` resolves only after sign-in and permission; a printed document never exposes a public link (A-RPT-26). | Security engineer |

---

## 12. Printer and label testing plan

Owned with `qa-test-engineer` (`docs/testing.md` holds the procedures); gates per `docs/team-charter.md`.

| # | Test | Method | Pass criterion | Gate |
|---|---|---|---|---|
| T-01 | Label scaling | Print the test page of each label template on each company printer (203 and 300 dpi); measure the 50 mm ruler mark and QR size with a ruler | ± 0.5 mm; QR module ≥ 0.5 mm | G2 |
| T-02 | Scan-back, camera | Scan every label kind with the app on the device matrix (Android Chrome, iOS Safari; `BarcodeDetector` and ZXing paths) at 10–40 cm, normal and low light, on flat and curved containers (drum, bottle) | 100 % decode of the exact payload in ≤ 1 s for ≥ 95 % of attempts | G2 |
| T-03 | Scan-back, keyboard-wedge | Scan with each USB/Bluetooth scanner into the scan field; terminator handling (A-UX-11) | payload identical, no dropped characters | G2 |
| T-04 | Durability (company test) | Labels on containers in cold room, wet area and after 7 days of handling | still scannable (T-02 criteria) | G2 |
| T-05 | Payload grammar | Unit tests: every numbering rule output matches §8.1 (`^[A-Z0-9][A-Z0-9._-]{0,63}$`); a value with lowercase, spaces or other characters outside the class, or longer than 64 characters, is rejected at rule configuration | tests pass in CI | G2 |
| T-06 | Reprint control | Reprint a label and a BMR without a reason (expect 422); with a reason (expect new row, `reprint_of_id`, audit `documents.generated_document.reprinted` / `documents.label_job.reprinted`); reprint count visible on the record | as stated | G2 (labels), G3 (BMR) |
| T-07 | Print station flow | Phone creates a label job; station prints; status transitions `queued → rendering → ready → printed`; failure surfaces in the Action Center; retry does not create a second identity | as stated | G2 |
| T-08 | BMR completeness (AC-18) | Generate the final BMR for the representative soap batch in staging; QA and production review every §2.1 field against the batch screens | every field present; page numbers; batch identity on every page; template version and checksum in footer; signature areas; QR resolves to the batch after sign-in | G3 |
| T-09 | Page-break stress | Seed a batch with 60 BOM lines, 30 steps with 10 parameters each, 3 inspections, 40 audit rows | no row/sub-row/signature block split; `thead` repeated; signature page starts a page; `Page x of y` correct | G3 |
| T-10 | Snapshot stability | Approve a new formula revision and a new BMR template version after the batch is created; regenerate | output unchanged except footer timestamp (AC-13) | G3 |
| T-11 | Preview equals PDF | Compare text extracted from the stored PDF with the preview HTML text per page; compare sha256 of two reprints of the same source revision (excluding the reprint banner region by rendering it as a separate layer) | identical text; identical body hash | G3 |
| T-12 | Permissions and scope | A Site B user requests a Site A BMR/DR/pick list by id (expect 404/403); auditor cannot reprint; operator cannot approve a template; portal user cannot see internal names or locations on a DR | negative tests pass in CI | G3, G4 |
| T-13 | Delivery receipt lifecycle | Dispatch posting allocates the DR number and issues stock; a draft DR never changes stock; acknowledgment regenerates with the image; three copies print; portal copy has no internal data | as stated | G4 |
| T-14 | Boxing note reconciliation | Boxes × units ≠ lot output blocks pack verification; packing list v2 after repack supersedes v1 with lineage printed | as stated | G4 |
| T-15 | Stock card reconciliation | Closing balance equals `inventory_balances` for 50 random lots after the concurrency test suite | zero differences; any difference is printed, never hidden | G2 |
| T-16 | Attendance exception report | Representative time-clock file: original file hash, counters and row results match the import screen; no personal data beyond number and name; export audited | as stated | G5 |
| T-17 | Fonts and metadata | Open PDFs on Windows, macOS, Android, iOS viewers; check embedded Inter, metadata fields, tagged structure | renders identically; metadata present | G3 |
| T-18 | Worker limits | 11 concurrent PDF requests by one user (expect 429 on the 11th); Chromium memory within the ADR-016 cap for the T-09 batch | as stated | G3 |

---

## 13. Assumptions, open questions and data-model gaps

### 13.1 Assumptions (`A-RPT-nn`)

Each default is configurable and needs owner confirmation; none is a legal, regulatory or quality rule.

| ID | Assumption | Default chosen | Confirm with |
|---|---|---|---|
| A-RPT-01 | Template definitions are configuration bound to code-defined renderers; no free HTML/CSS authored in the database (refines ADR-016 wording). | `document_template/v1` schema in §1.2 | principal architect, security engineer |
| A-RPT-02 | Running header/footer and `page x of y` use Chromium header/footer templates with reserved margins. | §1.5, §10 | frontend engineer |
| A-RPT-03 | Generated documents get their own number from numbering rule `DOC` (`DOC-{YY}-{SEQ}`, SEQ width 7, yearly reset, one sequence for the organization; `docs/data-model.md` §9.2); the printed record identity remains the batch/order/shipment number. | organization scope | owner (numbering, with A-PRD-04) |
| A-RPT-04 | Watermark vocabulary `DRAFT`, `IN PROGRESS`, `UNDER QA REVIEW`, `FINAL – PENDING CLOSURE`, `CONTROLLED COPY`, `REPRINT n`, `AMENDED rev n`, `SUPERSEDED`, `VOID`. | §1.5, §2.6 | QA |
| A-RPT-05 | The BMR disposition/signature section always starts a new page. | on | QA, production |
| A-RPT-06 | Hybrid policy: electronic capture is primary; `paper_then_transcribe` per step where SOPs require; transcription reviewed by a second person; both records retained; controlled record = paper until QA validates e-signatures. | §2.5 | QA (Q-QA-05) |
| A-RPT-07 | Internal documents print display names and user codes; customer-facing documents (DR, packing list, CoA, PO) print role titles unless `documents.print_internal_names` is on. | role titles | owner, sales |
| A-RPT-08 | Label media 50 × 30, 100 × 50, 100 × 150 mm; 203 dpi thermal; QR ECC M, module ≥ 0.5 mm. | §8.2, §8.3 | IT contact, warehouse (Q-WH-04) |
| A-RPT-09 | Thermal printing via browser print of label-sized PDFs with a per-site print station page; `printed` means "sent to printer". No ZPL/TSPL in Phase 2. | §8.5 | IT contact |
| A-RPT-10 | Status change of a lot queues label reprints (`labels.reprint_on_status_change`): on for lots, off for boxes; labels print "status at print" plus "scan to verify". | §8.3 | QA, warehouse |
| A-RPT-11 | Consumer-pack artwork and regulatory labelling are outside the system; the system records the artwork version and may later print lot/expiry overprint fields only. | out of scope | QA/regulatory, owner |
| A-RPT-12 | DR content beyond the brief's minimum (tax identifiers, statutory wording, prices) is accountant-validated configuration; prices off by default. | §7 | accountant, sales |
| A-RPT-13 | DR prints three copies (Customer, Driver, File). | 3 | sales, warehouse (Q-WH-17) |
| A-RPT-14 | DR acknowledgment is a drawn image or photo plus typed name; evidence of receipt, not an e-signature. | §7 | accountant, QA |
| A-RPT-15 | Dispensing sheets and pick lists carry no scannable lot/box codes, only the document QR, so operators must scan the physical label. | §3, §6 | production, warehouse |
| A-RPT-16 | Stock card opening balance is computed from the ledger; differences to the projection are printed and alerted. | §9 | warehouse, finance |
| A-RPT-17 | Attendance exception report prints employee number and name only; no other personal data. | §9 | HR |
| A-RPT-18 | Report exports cap at 50,000 rows per file with a truncation notice; CSV/XLSX cells are sanitised against formula injection. | §9 | analytics specialist, owner |
| A-RPT-19 | Inter is the embedded document font; minimum sizes per §10. | §10 | UX designer |
| A-RPT-20 | Generated PDFs follow the retention of their source record; label PDFs are kept 90 days while `label_jobs` rows are kept with the lot. | §11.2 | QA, accountant |
| A-RPT-21 | QA approves all document template versions in Phases 2–4 (permission matrix); non-quality kinds may be delegated to `site_manager` by role configuration. | QA approves all | owner, QA |
| A-RPT-22 | Production documents never print formula percentages or unit costs (A-PM-16); templates enforcing this cannot be overridden. | enforced | owner |
| A-RPT-23 | The audit trail appendix is part of the final BMR by default. | on | QA |
| A-RPT-24 | Documents and labels are English only in MVP; Filipino equivalents later via the `labels` map in the template definition (A-UX-06). | English | owner |
| A-RPT-25 | A4 default; Letter per site. | A4 | owner (A-UX-05) |
| A-RPT-26 | Document QR encodes `BC:DOC:<document_number>`; never a URL; requires sign-in. | on for BMR, traveler, DR, boxing note | security engineer |
| A-RPT-27 | "PDF identical to preview" is enforced by test (T-11), and downloads always serve the stored PDF, never the live HTML. | §10 | QA test engineer |

### 13.2 Questions for process owners

**Production**

| ID | Question | Why it matters |
|---|---|---|
| Q-RPT-P01 | Which BMR sections do operators need on paper during a batch today (whole BMR, dispensing sheet only, traveler)? | Which documents are generated at W05-03/05 by default |
| Q-RPT-P02 | Are the "Procedure 1–5" lines standard SOP text or per-batch notes? (extends Q-PR-09) | Section D source (instruction revision vs step notes) |
| Q-RPT-P03 | Should the dispensing table print one row per BOM line with sub-rows per weighing, or one row per weighing? | Row model in §2.1 |
| Q-RPT-P04 | Is "Department" always Production, or do intermediates (lye solution) belong to another department? | `production_lines.department_id` default vs `work_orders.department_id` override |
| Q-RPT-P05 | Do you want the theoretical yield printed as mass, bars, or both? (extends Q-PR-06) | Section G columns |
| Q-RPT-P06 | Which equipment label size fits scales and mixers, and should equipment carry a QR at all? | `BC:EQP` label |

**QA**

| ID | Question | Why it matters |
|---|---|---|
| Q-RPT-Q01 | Which steps must stay handwritten under current SOPs, and may a transcribed electronic record be the controlled record? (extends Q-QA-05) | A-RPT-06, `documents.controlled_record` |
| Q-RPT-Q02 | Do you need INCI names on the BMR, on raw-material labels, or both; and who supplies the INCI list? | §2.1, §8.3 |
| Q-RPT-Q03 | Must labels show the status word, or is "scan to verify" enough given the reprint effort on release? | A-RPT-10 |
| Q-RPT-Q04 | Is the audit appendix wanted on every final BMR, or only on request? | A-RPT-23 |
| Q-RPT-Q05 | Which tests and wording belong on a Certificate of Analysis, and which customers require one? | §9 CoA |
| Q-RPT-Q06 | What uncontrolled-copy wording and retention periods does the company's QA policy prescribe? | §1.5, §11.2 |
| Q-RPT-Q07 | Should QA approve non-quality templates (pick list, DR, PO), or delegate? | A-RPT-21 |

**Warehouse and sales**

| ID | Question | Why it matters |
|---|---|---|
| Q-RPT-W01 | Printer models, connection (USB/network), media sizes and whether a PC/tablet sits next to each printer. (extends Q-WH-04) | §8.5 print station |
| Q-RPT-W02 | Do current scanners read QR or only linear codes? | `symbology` default per template |
| Q-RPT-W03 | Which content must the DR carry for your customers and the accountant, and how many copies? (extends Q-WH-17) | §7, A-RPT-12/13 |
| Q-RPT-W04 | Do customers require their own carton labels or packing list layout, and in which language? | customer requirement kinds `label_artwork`, `document` |
| Q-RPT-W05 | Should pick lists be printed at all, or is the on-screen list sufficient? | §6 |
| Q-RPT-W06 | Are pallets used, and must pallet labels carry shipment information? | §8.3 pallet label |

### 13.3 Entities and columns requested from `docs/data-model.md` (status: applied)

Every row below has been applied in `docs/data-model.md` (its §14.3 records the acceptance); the table is kept as the record of what this document needs and why. Exceptions are noted in the row.

| Need | Proposed change (applied) | Used by |
|---|---|---|
| BMR header "Department" | `department_id` on `production_lines` (default) and nullable override `work_orders.department_id` | §2.1 |
| Line-clearance area and checklist items (A-PROC-07, A-PROC-32) | `routing_steps.area` (`weighing`, `production`, `packaging`, `filling`, `other`); new `routing_step_checklist_items` (versioned child: `item_no`, `text`, `requires_photo`) and `process_step_checklist_results` (`item`, `answer`, `photo_attachment_id`, `answered_by/at`) | §2.1, §2.2 D/E |
| Generated document lifecycle | `generated_documents.status` (`rendering`, `ready`, `failed`, `superseded`, `void`), `superseded_by_id`, `record_revision_no` (per source and kind), `source_state` (source status at render), `watermark` | §1.4, §1.6, §11.1 |
| Document kinds | extend `document_templates.template_kind` with `goods_receipt`, `count_sheet`, `variance_report`, `hold_notice`, `coa`, `deviation_report`, `traceability_report`, `supplier_return`, `quotation`, `order_confirmation`, `attendance_exception_report`, `statement`, `recall_notice`, `return_receipt`, `test_page` | §9 |
| Numbering rule for documents | rule type `DOC` in `numbering_rules` (`DOC-{YY}-{SEQ}`, SEQ width 7, organization scope) | A-RPT-03 |
| Label jobs | `voided_at`, `voided_by`, `void_reason`, `document_template_version_id` (explicit, besides `generated_document_id`), `printed_by`, `printed_at`, `station_device_registration_id` (→ `device_registrations`) | §8.5 |
| Label templates | `applies_to` add `equipment`; `symbology` add `ean13` (in the CHECK; ADR-017 lists it when retail barcodes are scheduled); `copies_default`; `fields` jsonb (which optional fields print) | §8.2, §8.3 |
| Paper records for hybrid steps | new `batch_paper_records` (`batch_id`, `process_step_record_id` nullable, `file_attachment_id`, `page_no`, `transcribed_by/at`, `reviewed_by/at`, ck reviewer ≠ transcriber); `file_attachments.attachment_kind` add `paper_record_page`, `template_test_page` | §2.5, §11.1 |
| Delivery receipt acknowledgment | `delivery_receipts.acknowledgment_kind` (`drawn`, `photo`, `name_only`), `signature_attachment_id`, `acknowledged_by_user_id` (the internal user who captured it), `received_by_position`, `copies_printed` | §7 |
| Conditional release conditions | `dispositions.conditions`, `review_date` (W06-05 mentions both) | §2.2 J |
| Organization document settings | settings keys `documents.logo_attachment_id`, `documents.legal_address_lines`, `documents.uncontrolled_copy_text`, `documents.controlled_record`, `documents.print_internal_names`, `documents.dr_copies`, `documents.dr_show_prices`, `documents.dr_box_detail`, `labels.reprint_on_status_change` registered in `src/lib/settings.ts` | §1.5, §2.5, §7, §8.3 |
| Audit action names | resolved per `docs/data-model.md` §8.1 (`module.entity.event`): `documents.generated_document.generated/downloaded/reprinted/superseded`, `documents.label_job.printed/reprinted/voided`; this document uses those names everywhere | §1.1, §1.6, §8.5 |
| Reason codes | seed reprint reasons: `lost_copy`, `damaged_label`, `status_change`, `repack`, `customer_copy`, `other` (requires note) | §1.6, §8.5 |
