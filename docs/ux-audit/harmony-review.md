# Harmony review (owner feedback 2026-11-08, ADR-119)

Owner, with phone screenshots of "Check quality: Aloe Hand Lotion 250 mL": "big fonts but the focus is not on the batch
number. The summary is ugly too. Can a UI/UX review each page — it is not harmonious."

What changed for every page (rules in `docs/ux-system.md` §2.7, §2.8 and Rules: 5.2):

| Before | After |
|---|---|
| Page titles 26 → 32 px; record titles "Check quality: <product>" over two lines | Lists and forms 22 → 26 px (`text-title`); record pages lead with the **identifier** (B-26-0002, 26 → 30 px, dark Inter) |
| Batch / order number small, grey, mono, under the title | Identifier is the H1 with the status chip beside it; product/customer/supplier is the subtitle; one small meta line |
| "?" and "⋯ More" as a separate row of big buttons on phones | Compact 44 px round icon buttons on the identifier row ("More" in words from 640 px) |
| "This screen is for…" as a 3–4 line paragraph | One line on phones (two from 640 px) with "more"; sentence unchanged |
| Progress strip of up to 10 pills on phones | "Step 3 of 10: Confirmed · then set aside" and a thin bar; pills from 640 px |
| Summary as a run-on sentence | `SummaryGrid`: label over bold value with unit, one small line under it; 2 columns on phones, 3–4 when wide |
| "Things that did not go as planned" card saying nothing went wrong | One quiet line "✓ Nothing left the normal path" ("what was checked" opens the sentence) |
| KPI and count numbers 26–34 px, different on each Home | One `text-stat` (26 px) |
| Cards 20/24 px padding, radius 24 | 16/24 px padding (8 px grid), radius 16/20 |

Screenshots: `docs/ux-audit/harmony/before/<page>-<width>.jpg` and `docs/ux-audit/harmony/after/<page>-<width>.jpg`
(390 px phone with touch, 1440 px desktop; the 820 px tablet shots were taken and looked at but not committed to keep
the repository small). Lite demo data, users named per row. No page scrolls sideways at any width (checked by script).

| Page (user) | Before | After | Notes |
|---|---|---|---|
| Check quality `/quality/check/[batchId]` (qa.nfd) | [390](harmony/before/qa-check-390.jpg) · [1440](harmony/before/qa-check-1440.jpg) | [390](harmony/after/qa-check-390.jpg) · [1440](harmony/after/qa-check-1440.jpg) | The owner's screen. B-26-0002 is the hero; "What to do next" is on the first phone screen; summary grid (good 96 · expected 96, yield 100 % · OK 95–102 % with a check, rejects, samples, to sell after OK, lot with expiry); "nothing went wrong" is one line. |
| Check quality, decided (qa.nfd) | [390](harmony/before/qa-check-done-390.jpg) | [390](harmony/after/qa-check-done-390.jpg) | Same template; result banner stays. |
| Full QA review `/quality/batches/[id]` | [390](harmony/before/qa-batch-390.jpg) | [390](harmony/after/qa-batch-390.jpg) | Identifier first. |
| QA lot `/quality/lots/[id]` | [390](harmony/before/qa-lot-390.jpg) | [390](harmony/after/qa-lot-390.jpg) | Lot number first; status stays in the banner below (no chip in the header yet). |
| QA test `/quality/inspections/[id]` | [390](harmony/before/qa-inspection-390.jpg) | [390](harmony/after/qa-inspection-390.jpg) | |
| Batch record `/production/[id]` (owner) | [390](harmony/before/batch-390.jpg) · [1440](harmony/before/batch-1440.jpg) | [390](harmony/after/batch-390.jpg) · [1440](harmony/after/batch-1440.jpg) | ⋯ More is now the shared MoreMenu (same look as everywhere). |
| Finish `/production/[id]/finish` (operator) | [390](harmony/before/batch-finish-390.jpg) | [390](harmony/after/batch-finish-390.jpg) | "Back" button became the back link. |
| Production order (owner, operator) | [390](harmony/before/prod-order-390.jpg) · [op](harmony/before/prod-order-op-390.jpg) | [390](harmony/after/prod-order-390.jpg) · [op](harmony/after/prod-order-op-390.jpg) | WO number first; pieces, needed-by, assignee and customer order in the meta line. The page's own "Next step" card and tabs are unchanged. |
| Weigh / step / get materials (operator) | [weigh](harmony/before/prod-weigh-390.jpg) · [step](harmony/before/prod-step-390.jpg) · [materials](harmony/before/prod-materials-390.jpg) | [weigh](harmony/after/prod-weigh-390.jpg) · [step](harmony/after/prod-step-390.jpg) · [materials](harmony/after/prod-materials-390.jpg) | Floor header: task verb title, batch number dark and tabular under it (was a grey chip). |
| Lot `/inventory/[lotId]` (warehouse) | [390](harmony/before/lot-390.jpg) | [390](harmony/after/lot-390.jpg) | |
| Item `/inventory/items/…` (owner) | [390](harmony/before/item-390.jpg) | [390](harmony/after/item-390.jpg) | Name is the hero (setup record); stock cards use `text-stat`. |
| Delivery received `/inventory/receive/[id]` (warehouse) | [390](harmony/before/receipt-390.jpg) | [390](harmony/after/receipt-390.jpg) | GR number first; compact progress; Put away in the next box. |
| Shelf, stock change, box (warehouse) | [shelf](harmony/before/shelf-390.jpg) · [movement](harmony/before/movement-390.jpg) · [box](harmony/before/box-390.jpg) | [shelf](harmony/after/shelf-390.jpg) · [movement](harmony/after/movement-390.jpg) · [box](harmony/after/box-390.jpg) | |
| Purchase order (owner) | [390](harmony/before/po-390.jpg) · [1440](harmony/before/po-1440.jpg) | [390](harmony/after/po-390.jpg) · [1440](harmony/after/po-1440.jpg) | |
| Customer order (sales) | [390](harmony/before/so-390.jpg) · [1440](harmony/before/so-1440.jpg) | [390](harmony/after/so-390.jpg) · [1440](harmony/after/so-1440.jpg) | Ten pills → one progress line on phones; task on the first screen. |
| Customer (sales) | [390](harmony/before/customer-390.jpg) | [390](harmony/after/customer-390.jpg) | Setup record: name hero, code in meta. |
| Supplier, material, product, recipe, equipment (owner) | [supplier](harmony/before/supplier-390.jpg) · [material](harmony/before/material-390.jpg) · [product](harmony/before/product-390.jpg) · [recipe](harmony/before/recipe-390.jpg) · [equipment](harmony/before/equipment-390.jpg) | [supplier](harmony/after/supplier-390.jpg) · [material](harmony/after/material-390.jpg) · [product](harmony/after/product-390.jpg) · [recipe](harmony/after/recipe-390.jpg) · [equipment](harmony/after/equipment-390.jpg) | Name hero, kind as eyebrow, code small in meta. |
| Lists: QA, purchase orders, customer orders, materials | [qa](harmony/before/qa-list-390.jpg) · [po](harmony/before/po-list-390.jpg) · [so](harmony/before/so-list-390.jpg) · [materials](harmony/before/materials-list-390.jpg) | [qa](harmony/after/qa-list-390.jpg) · [po](harmony/after/po-list-390.jpg) · [so](harmony/after/so-list-390.jpg) · [materials](harmony/after/materials-list-390.jpg) | Smaller title; PlainList rows unchanged (already name first). |
| Form: new purchase order | [390](harmony/before/new-po-390.jpg) | [390](harmony/after/new-po-390.jpg) | Smaller title, 8 px label-to-field. |
| QA Home (qa.nfd) | [390](harmony/before/home-qa-390.jpg) | [390](harmony/after/home-qa-390.jpg) | Count numbers `text-stat`. |

Record pages on the template (68, `RecordHeader`): batches (`/production/[id]`, closure, finish), production orders,
production plan, purchase requests, purchase orders, returns to supplier, procurement supplier, deliveries received,
lots, items, shelves, stock changes, boxes, stock fixes, counts, lot history, label jobs, customer orders, customers,
price offers, prices, picks, second check, deliveries, customer returns, boxing, invoices, supplier bills, payments,
credits, expense claims, statements, QA check, full QA review, QA lots, QA tests, problem reports, fix-and-prevent plans,
change requests, complaints, recalls, holds, repair jobs, regular maintenance, materials, products, sellable items,
recipes (plain and advanced, and versions), steps (and versions), how-to sheets, item quality checks, equipment, making
areas, sites, warehouses, shelves and areas (set up), reasons, suppliers (set up), imports, document and label layouts,
documents, sync conflicts. Floor screens (weigh, more weighing, steps, get materials) use the restyled `FlowHeader`.

Not done in the first pass, then done in the leftovers pass (ADR-123, 2026-11-07) — see below.

## Leftovers pass (ADR-123, 2026-11-07)

Measured on the FULL demo (`DEMO_PROFILE=full`, production build) with Playwright; owner unless noted. Screenshots
were taken at 390 px (phone, touch) and 1440 px for 57 record pages (not committed; the lead keeps them with the
report). Checked per page: header on the template, status chip beside the identifier, no sideways scroll, visible
green buttons, most fields visible in one form, text above 20 px.

| # | Item | Result |
|---|---|---|
| 1 | Owner's desktop menu row at 1280 px 74 px too long | Logo mark (36 px) instead of the full logo (156 px) at 1280–1535 px. Owner and QA: 38 px to spare at 1280 (was −74), sales 90, finance 150; 39 px at 1536/1920. 165 checks (8 roles × 5 widths × every destination) pass: nothing cut, site selector and search button visible, page never scrolls sideways, tab row one line (`tests/e2e/top-bar-fit.cjs`). |
| 2 | `admin/users/[id]`, `admin/roles/[id]` on `PageHeader` | `RecordHeader`, setup-style: the person's or job's name is the H1, status chip beside it, e-mail / code in the meta line. The job page's "Open People" is the header's one green button. |
| 3 | QA lot status as a banner | `QaStatusChip` beside the lot number; below it only what the status means when it stops people ("Nobody can use this lot until QA says it is OK."), nothing for an OK lot. The duplicate "Made in batch …" banner went into the meta line. An OK lot's "Stop it or say not OK" form is folded. |
| 4 | Own next-step cards and button rows | Production order: the "Next step" card (shown twice, phone and desktop) is the header's `next`/`primary`/`waitingFor` with the same controls (Plan the batch, the next action, Approve, the not-ready warning, who approves); its progress strip is the header's steps. Item page: the main action is the header's button, the others in ⋯ More, with a next-step sentence. Also: QA batch review's second green "Check quality" → outlined; supplier (procurement) only the first suggestion's "Yes" and the suggest form when it is the next step are green; customer "Turn on the customer portal" outlined; product "Make it ready to use" outlined (the recipe step is green). Status chips moved from the first card into the header on problem reports, fix-and-prevent plans, change requests, complaints, recalls, QA tests, QA batch review, repair jobs and regular maintenance. Rule: a next step that jumps to a form on the same page (`#…`) is outlined. Result: every one of the 57 pages has at most one visible green button at 390 and 1440 px. |
| 5 | Long forms without sections | `FormSection` and `EditDetails` (`src/ui/form-section.tsx`) on material, product, supplier, reason, site and shelf/area forms (list in `docs/ux-system.md` Rules 5.8). At most 5 visible fields on every surveyed page (reason 3, equipment 5, QA lot 4, delivery 5). |
| 6 | Record pages without lite-demo data | Checked on the full demo at 390 and 1440 px: purchase requests (approved, submitted), repair jobs (open, in progress), invoices (draft, waiting for approval, part paid), supplier bills (disputed, saved), payments, credit notes, expense claims (submitted, paid back), picks, second check (in progress, done), deliveries, customer returns, returns to supplier. All on the template, one green button, no sideways scroll. Fixed: repair job had no status chip in the header (now `WoStatusChip`). Seen and left to the finance owner (agent B): invoice lines read "ACS-135 · Acapulco Soap 135 g" (code first) — fixed by ADR-124's `LineName` in the same round. |

Count progress on a stock count ("0 of 0 counted") used the page-title size inside a card; it is `text-value` now.
Print layouts and the keypad keep their own sizes by design.
