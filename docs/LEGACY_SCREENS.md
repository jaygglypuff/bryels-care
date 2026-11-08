# Legacy screens: one screen per job (2026-10-31)

The owner: "the original layout and features are not overridden … the same for demo, sandbox and probably
production." New screens had been added next to old ones, and people still landed on the old screens, old forms and
old words through links in messages, To approve and Problems & alerts rows, search and scan results, e-mails, Home
cards, help topics and menus. This file lists every route under `src/app`, says which one is the current screen
for its job, and records what was done with the others.

**Scope.** Every area except production (`src/app/(app)/production/**`, `src/modules/production/**`), labels and
printing (`src/app/(app)/labels/**`, `src/app/print/**`, label templates) and scan/code inputs: other engineers are
consolidating those at the same time. Their routes are listed as "other engineer" with observations only.

## Statuses

| Status | Meaning |
|---|---|
| current | The screen the standard intends for this job (ADR-080…097, `docs/PAGE_REVIEW.md`). |
| retired → redirect (ADR-115) | Retired in the 2026-11-06 clean-up: the page, its actions and services are removed and only a server redirect stays. |
| superseded → redirect | An older screen doing the same job as a newer one. The page is now a server `redirect()` to the replacement, so bookmarks, old e-mails and stored message links keep working. |
| redirect (alias) | Was already a redirect before this pass (old address kept alive). |
| advanced (kept) | Overlaps a newer screen but still holds a unique capability. Kept, labelled as advanced or reached only from ⋯ More of the current screen, not in floor menus; the reason is recorded. |
| orphan | No link, menu or redirect reaches it. (None found: every remaining page is reached from a menu, a screen, a link builder or a redirect.) |
| other engineer | Production, labels or printing route; not changed here. |

## Summary

Refreshed 2026-11-06 (ADR-115 §5) after the production consolidation and the clean-up.

| Status | Routes |
|---|---|
| current | 227 |
| other engineer | 38 |
| advanced (kept) | 14 |
| superseded → redirect | 8 |
| redirect (alias) | 6 |
| retired → redirect (ADR-115) | 2 |
| current (restricted) | 1 |

Total: 296 page routes (`find src/app -name page.tsx | wc -l` = 296 on 2026-11-06, before the ADR-115 code clean-up; the retired routes stay as redirect pages).


## Superseded tabs and links (not separate routes)

| Old place | Status | Replacement | Links fixed | Decision |
|---|---|---|---|---|
| Problems & alerts → “To decide” tab (`/action-centre?tab=approvals`, `?kind=approval.*`) | superseded → redirect | `/approvals` (To approve) | rehearsal script, `currentHref` | ADR-082 §4: To approve is the one place to decide; the tab showed the same rows without the verdicts (who may decide now). |
| Problems & alerts → “Alerts for you” tab (`/action-centre?tab=alerts`) | superseded → redirect | `/notifications` (Messages) | `currentHref` | Messages is the one list of messages; the tab repeated the open ones. |
| `/inventory/lots/<id>` (link from a phone change to check) | broken link | `/inventory/<id>` | `src/app/(app)/sync/conflicts/[id]/page.tsx`, `currentHref` | There was never a page at this address (404). |
| `/production/work-orders/<id>` from shared code | superseded link | `/production/orders/<id>` | `src/lib/record-links.ts` (`work_order`), late production order row, production report row link, KPI drill-down (`kpi-ui.tsx`), `currentHref` | The route itself belongs to the production engineer; only links outside production changed. |
| `/production/plan` for “make more” | superseded link | `/production/orders/new` | item page “Make more” (was “Plan more”), low-stock Home line, low-stock Problems row now opens the item page | Planning tools are for planners; “make more” is a production order. |
| `/inventory?q=<code>` from a material or product scan | superseded link | `/inventory/items/<kind>/<id>` | `src/modules/scan/card.ts` (“See its stock”) | ADR-087: one page per material or product. |
| `/quality/batches/<id>` to decide a batch | superseded link | `/quality/check/<id>` | To approve row, decision history, QA decisions report, problem report, lot QA page, quality checks list and detail, “Who received it” | The full review page stays for OK with conditions (see the table). |
| `/masterdata/suppliers/<id>` as “the supplier” | superseded link | `/procurement/suppliers/<id>` | search, `record-links` `supplier`, delivery page, after creating a supplier | The master-data page stays as “Change contact details”. |

**Stored links.** `currentHref()` in `src/lib/record-links.ts` (`SUPERSEDED_LINKS`) rewrites the addresses above
when a message, a To approve row or a Problems & alerts row is opened, so links stored in the database before this
change never show an old screen. Unit test: `tests/unit/legacy-redirects.test.ts`.

## Menu edits needed in `src/app/(app)/nav.ts` (not edited here)

Status checked against `src/app/(app)/nav.ts` on 2026-11-06 (ADR-115 §5).

| # | Edit | Why | Status 2026-11-06 |
|---|---|---|---|
| N1 | Remove Management → Master data → “Suppliers” (`/masterdata/suppliers`). | Superseded: redirects to Purchasing → “Suppliers we may buy from”, which now has Add a supplier. Keeping it shows the same list twice. | Done: Master data has no Suppliers entry. |
| N2 | Remove Management → Finance → “Expense approvals” (`/finance/expenses?status=to_approve`). | Expense claims to approve are in To approve (kind `approval.expense_claim`), with the verdict of who may decide; the filtered list stays reachable from the expense list's tabs. | Done: Finance has no Expense approvals entry. |
| N3 | Rename Inventory → More stock lists → “FEFO & reservations” to “Which one to use first / set aside”. | Same words as the screen title (ADR-097); FEFO is a banned word. | Done. |
| N4 | Rename Inventory → More stock lists → “Availability” to “Can we deliver?”. | Same words as the screen title (ADR-097). | Done. |
| N5 | Rename Inventory → Counts & labels → “Adjustments” to “Fix stock”. | The screens and the warehouse Home tile say “Fix stock” (ADR-090/097). | Done. |
| N6 | Rename Management → Master data → “Locations” to “Shelves and areas (set up)”. | Inventory already has “Shelves” (`/inventory/locations`, what is on a shelf); two entries both meaning shelves confuse. The master-data page is for setting them up. | **Open**: Management → Master data still says "Locations" (nav.ts). Needs the rename and the screen title together (menu word = H1, `tests/unit/nav-titles.test.ts`). |
| N7 | Rename Management → Reports & analytics → “Business overview” to “Business overview (detailed)” and keep it out of floor menus (already). | It is the former owner dashboard; Home is the owner's start (ADR-083). | **Open (partly)**: kept out of floor menus (done); the menu word is still "Business overview". |
| N8 | Update the `ADVANCED` comment: the production “Planning tools” section is for the production engineer to decide (out of scope here). | — | Done: the comment says the old screens redirect; "Planning tools" now holds Production plan and Batch records. Its ADR citation (ADR-085) is wrong (ADR-085 is the plain-word lookup); listed for the code engineer. |
| N9 | Optional: QUICK_ACTIONS “Scan or look up” → “Scan or find”, matching the Scan screen intro. | Plain words. | Done, worded "Scan or search" (same as the Inventory tab and the Scan screen). |
| N10 | Point “Quality check” at `/quality`: Operations main tab, QA bottom tab (`tabsFor`) and QUICK_ACTIONS; then remove Operations → Quality → “QA queue” (same screen twice). | `/quality/check` (batches only) is superseded by the QA queue and redirects; pointing the menu straight at `/quality` avoids the redirect hop. | Done: "Check a batch or delivery" opens `/quality` from the Operations tab, the QA bottom tab and the quick links; no "QA queue" entry is left. |

## Shell/layout edit needed (not edited here)

| # | Edit | Why | Status 2026-11-06 |
|---|---|---|---|
| L1 | In `src/app/(app)/layout.tsx`, replace the local `openQaCount` with `qaQueueCount(ctx.organizationId, ctx.currentSiteId).total` from `@/modules/quality`. | UX audit: the QA badge said 11 while the list showed 2 batches. The layout counts every lot waiting for the QA check (finished-goods lots too, which are already counted with their batch) and only `awaiting_qc` batches; the QA queue lists material lots waiting, lots stopped by QA and `awaiting_qc`/`quarantined` batches. `qaQueueCount` uses the queue's own rule (one query per count); Home's QA tile already uses it. | Done: `layout.tsx` uses `qaQueueCount(...).total`. |
| L2 | In `src/app/(app)/shell.tsx`, the badge key `"/quality/check"` can go once N10 is done (the `/quality` key stays). | — | Done: no `/quality/check` badge key is left in `shell.tsx` or `nav.ts`. |

## UX audit items handled here (2026-10-31)

| Finding | What changed |
|---|---|
| The planner's Home was the old tile page (“Review quarantined lots and batches awaiting QC”, “all figures from posted transactions”). | Planner sentence (`homeIntro`), one next step from `getPlannerNext` (orders to approve → To approve; approved but not started → production orders; else New production order); tiles in plain words (QA queue, Send out orders → To get from shelf); footer “Numbers for … · updated …”. |
| QA badge 11 vs list 2. | `/quality/check` now redirects to the QA queue (batches and lots); `qaQueueCount` shares the queue's rule; Home's QA tile uses it; layout edit L1 listed. |
| DEV-26-0001 “New” while its fix-and-prevent plan is “Being fixed”. | Seed (`src/db/seeds/w4c.ts`): opening the plan moves the problem report to “investigating” with a state-log row, as `startInvestigation` does. |
| L-2610-00011 shows one supplier in the QA queue and another on the lot page. | Seed (`src/db/seed.ts`): one receipt per supplier; before, lots of several suppliers shared the first supplier's receipt. Demo receipt number now GR-26-00016. |

## Demo, sandbox and seed

- `docs/demo-script.md`: menu paths and buttons of scenes 1–4 and 9–14 rewritten to the current screens (Home, Receive tab,
  Save and print labels, OK to use, Move stock, three-step customer order, Set aside the stock, Send out, Where it came from
  and went, History of changes, Money, Close the month, Tax rates, People). Production scenes 5–8 and 13 point at the current
  entry points (production orders, My work, Quality check) and say the production screens are being consolidated. Screenshots
  are from 23 Oct and are marked as such until re-shot.
- Seeded messages (`src/db/seeds/w1a.ts`, `w3a.ts`) use plain words and now carry a link (expiring lots → Expiring soon,
  problem report → Problem reports, late order → Customer orders), so tapping them in Messages opens a current screen.
- Help topics with old menu paths rewritten: `docs/help/order.md` (the three-step wizard, Set aside, Let the stock go),
  `import.md`, `run-a-report.md`, `everyday-basics.md` (Messages, I'm on it, To approve, Problems & alerts),
  `getting-started.md` (Add a supplier on the supplier list, Recipes (advanced) example, Business overview, plain words).
  Production help topics (`work-order.md`, `staging.md`, …) were left to the production engineer; on 2026-11-06 (ADR-115 §1)
  `work-order.md`, `staging.md` and `weighing.md` were removed and their still-true content moved to `production-order.md`,
  `materials-list.md`, `weigh.md` and `step.md`; `line-clearance.md` now describes the Start check.

## Old words in messages (part 3)

Message titles and bodies, To approve and Problems & alerts row titles, details, kind labels and buttons, and the
service errors people read most (picking, dispatch, set aside, receive, move, undo, counts, repair jobs) now use the
words on the screens: problem report, fix-and-prevent plan, set aside, saved to stock, undo (kept on record), waiting
for QA check, QA check, price offer, request to buy, return to supplier, customer order, stock fix, count difference,
regular maintenance, repair job, spreadsheet, automatic task, stock check. Machine tags such as `SEPARATION_OF_DUTIES:`
are dropped from the message a person reads (`userMessage` in `src/lib/errors.ts`; the code stays in logs and the API).
Stored codes, permission strings, exports (list names such as “CAPA register”) and printed GMP records are unchanged.
Guard: `tests/unit/no-jargon-messages.test.ts` scans every module file that writes messages or action rows (production
excluded) and the seeded messages for the banned list, with an explicit allow-list for export and IT job names.

## Every route

| Route | Status | Replacement / where it is reached | Links fixed | Decision |
|---|---|---|---|---|
| `/` | redirect (alias) | /dashboard (Home) | — | Root address opens Home. |
| `/account` | current | menu | — | Current. |
| `/action-centre` | current | Problems & alerts | ?tab=approvals → /approvals, ?tab=alerts → /notifications, ?kind=approval.* → /approvals | The “To decide” and “Alerts for you” tabs duplicated To approve and Messages and were removed; tabs are Problems and Phone changes to check (only with platform.sync_conflict.view). |
| `/admin` | redirect (alias) | /admin/users (People) | — | Kept: section address opens People. |
| `/management` | redirect (alias) | /setup (Set-up) | — | Round 5 (ADR-129): the Management hub repeated every menu as a card grid; set-up screens are on the Set-up page (avatar menu), daily screens in the areas. |
| `/admin/approval-rules` | current | menu | — | Current. |
| `/admin/audit` | current | menu | — | Current. |
| `/admin/demo` | current | linked from screens | — | Current. |
| `/admin/devices` | current | menu | — | Current. |
| `/admin/diagnostics` | current | menu | — | Current. |
| `/admin/imports` | current | menu | — | Current. |
| `/admin/imports/[id]` | current | linked from screens | — | Current. |
| `/admin/imports/legacy-documents` | current | menu | — | Current. |
| `/admin/notification-rules` | current | menu | — | Current. |
| `/admin/numbering` | current | menu | — | Current. |
| `/admin/retention` | current | menu | — | Current. |
| `/admin/roles` | current | menu | — | Current. |
| `/admin/roles/[id]` | current | linked from screens | — | Current. |
| `/admin/roles/[id]/clone` | current | linked from screens | — | Current. |
| `/admin/security` | current | menu | — | Current. |
| `/admin/sessions` | current | menu | — | Current. |
| `/admin/settings` | current | menu | — | Current. |
| `/admin/templates` | current | menu | — | Current. |
| `/admin/templates/[id]` | current | linked from screens | — | Current. |
| `/admin/templates/labels/[id]` | other engineer | — | — | Owned by the labels engineer (not changed here). |
| `/admin/templates/labels/new` | other engineer | — | — | Owned by the labels engineer (not changed here). |
| `/admin/templates/new` | current | linked from screens | — | Current. |
| `/admin/templates/stations` | current | linked from screens | — | Current. |
| `/admin/users` | current | menu | — | Current. |
| `/admin/users/[id]` | current | linked from screens | — | Current. |
| `/admin/users/invite` | current | linked from screens | — | Current. |
| `/analytics` | current | menu | — | Current. |
| `/analytics/[area]` | current | linked from screens | — | Current. |
| `/analytics/definitions` | current | menu | — | Current. |
| `/analytics/kpi/[code]` | current | linked from screens | — | Current. |
| `/analytics/overview` | advanced (kept) | Management → Reports & analytics → Business overview | — | The former owner dashboard (OwnerOverview) moved here by ADR-083; Home is the owner/operator home. Not in floor menus. |
| `/analytics/trends` | current | menu | — | Current. |
| `/approvals` | current | To approve | row links pass through currentHref | The one place to decide (ADR-082 §4). |
| `/dashboard` | current | Home (owner, manager, QA, sales, finance, planner, operator, warehouse homes) | — | Current (ADR-083/090). The planner, who fell back to the old tile page, now gets a planner sentence and one next step (orders to approve, approved but not started, or a new order); tile words are plain and the QA tile uses the QA-queue count. |
| `/dashboard/details/batches` | current | linked from screens | — | Current. |
| `/dashboard/details/stock` | current | linked from screens | — | Current. |
| `/documents/[id]` | current | linked from screens | — | Current. |
| `/finance` | current | menu | — | Current. |
| `/finance/bills` | current | menu | — | Current. |
| `/finance/bills/[id]` | current | linked from screens | — | Current. |
| `/finance/bills/new` | current | linked from screens | — | Current. |
| `/finance/credit-notes` | current | menu | — | Current. |
| `/finance/credit-notes/[id]` | current | linked from screens | — | Current. |
| `/finance/credit-notes/new` | current | linked from screens | — | Current. |
| `/finance/expenses` | current | menu | — | Current. |
| `/finance/expenses/[id]` | current | linked from screens | — | Current. |
| `/finance/expenses/new` | current | linked from screens | — | Current. |
| `/finance/invoices` | current | menu | — | Current. |
| `/finance/invoices/[id]` | current | linked from screens | — | Current. |
| `/finance/payments` | current | menu | — | Current. |
| `/finance/payments/[id]` | current | linked from screens | — | Current. |
| `/finance/payments/new` | current | linked from screens | — | Current. |
| `/finance/periods` | current | menu | — | Current. |
| `/finance/statements` | current | menu | — | Current. |
| `/finance/statements/[customerId]` | current | linked from screens | — | Current. |
| `/finance/tax` | current | menu | — | Current. |
| `/floor` | current | menu | — | Current. |
| `/forgot-password` | current | linked from screens | — | Current. |
| `/help` | current | Help: five role guides + task guides | help topics order, import, run-a-report, everyday-basics, getting-started rewritten to current menus | Current. |
| `/inventory` | current | Stock (by item) | — | Grouped by item; rows open the item page. |
| `/inventory/[lotId]` | current | Lot page | sync conflict link (was the broken /inventory/lots/<id>) | Current. |
| `/inventory/[lotId]/move` | superseded → redirect | /inventory/move?lot=<id> (Move stock) | scan card “Move stock” (src/modules/scan/card.ts); stored links via currentHref | Redirect. Move stock already takes the lot (?lot=), offers only allowed shelves and handles boxes and loose stock per shelf; the old form and its action were deleted. |
| `/inventory/adjustments` | current | menu | — | Current. |
| `/inventory/adjustments/[id]` | current | linked from screens | — | Current. |
| `/inventory/adjustments/new` | current | linked from screens | — | Current. |
| `/inventory/availability` | current | menu | — | Current. |
| `/inventory/containers` | current | menu | — | Current. |
| `/inventory/containers/[id]` | current | linked from screens | — | Current. |
| `/inventory/containers/new` | current | linked from screens | — | Current. |
| `/inventory/counts` | current | menu | — | Current. |
| `/inventory/counts/[id]` | current | linked from screens | — | Current. |
| `/inventory/counts/[id]/sheet` | current | linked from screens | — | Current. |
| `/inventory/items/[kind]/[id]` | current | One page per material or product (ADR-087) | search, stock list, scan card “See its stock” (was /inventory?q=), materials list, low-stock “Problems” row (was /production/plan) | Current. |
| `/inventory/locations` | current | menu | — | Current. |
| `/inventory/locations/[id]` | current | linked from screens | — | Current. |
| `/inventory/lots` | redirect (alias) | /inventory (Stock) | — | Kept: old lot list address. |
| `/inventory/lots/[lotId]/edit` | current | linked from screens | — | Current. |
| `/inventory/lots/expiry` | current | menu | — | Current. |
| `/inventory/lots/reservations` | current | menu | — | Current. |
| `/inventory/move` | current | menu | — | Current. |
| `/inventory/movements` | current | menu | — | Current. |
| `/inventory/movements/[id]` | current | linked from screens | — | Current. |
| `/inventory/receipts` | current | menu | — | Current. |
| `/inventory/receive` | current | Receive materials (tablet cards) | demo scene 2 rewritten | Current; /procurement/expected/[poId] redirects here. |
| `/inventory/receive/[grId]` | current | linked from screens | — | Current. |
| `/inventory/receive/[grId]/edit` | current | linked from screens | — | Current. |
| `/inventory/receive/put-away` | current | menu | — | Current. |
| `/inventory/scan` | current | menu | — | Current. |
| `/inventory/stock-card/[lotId]` | advanced (kept) | Lot page ⋯ More → “History of this lot” | — | Full history with running balance, print and exports; the lot page shows the short history. |
| `/inventory/wip` | current | linked from screens | — | Current. |
| `/invite` | current | linked from screens | — | Current. |
| `/labels` | other engineer | — | — | Owned by the labels engineer (not changed here). |
| `/labels/jobs/[jobId]` | other engineer | — | — | Owned by the labels engineer (not changed here). |
| `/labels/new` | other engineer | — | — | Owned by the labels engineer (not changed here). |
| `/maintenance` | current | menu | — | Current. |
| `/maintenance/plans` | current | menu | — | Current. |
| `/maintenance/plans/[planId]` | current | linked from screens | — | Current. |
| `/maintenance/plans/new` | current | linked from screens | — | Current. |
| `/maintenance/spare-parts` | current | menu | — | Current. |
| `/maintenance/work-orders` | current | menu | — | Current. |
| `/maintenance/work-orders/[workOrderId]` | current | linked from screens | — | Current. |
| `/maintenance/work-orders/new` | current | linked from screens | — | Current. |
| `/management` | current | menu | — | Current. |
| `/masterdata/equipment` | current | menu | — | Current. |
| `/masterdata/equipment/[id]` | current | linked from screens | — | Current. |
| `/masterdata/equipment/new` | current | linked from screens | — | Current. |
| `/masterdata/formulas` | advanced (kept) | Recipes (advanced); green “New recipe (step by step)” first | — | ADR-096: advanced editing kept; wizard is /masterdata/recipes/new. |
| `/masterdata/formulas/[id]` | advanced (kept) | Recipes (advanced) | — | ADR-096. |
| `/masterdata/formulas/[id]/revisions/[revisionId]` | advanced (kept) | Recipes (advanced) | — | ADR-096; approval panel lives here. |
| `/masterdata/formulas/new` | advanced (kept) | Points to the step-by-step recipe first | — | ADR-096. |
| `/masterdata/inspection-plans` | current | menu | — | Current. |
| `/masterdata/inspection-plans/[id]` | current | linked from screens | — | Current. |
| `/masterdata/inspection-plans/new` | current | linked from screens | — | Current. |
| `/masterdata/lines` | current | menu | — | Current. |
| `/masterdata/lines/[id]` | current | linked from screens | — | Current. |
| `/masterdata/lists` | current | menu | — | Current. |
| `/masterdata/locations` | current | menu | — | Current. |
| `/masterdata/locations/[id]` | current | linked from screens | — | Current. |
| `/masterdata/materials` | current | menu | — | Current. |
| `/masterdata/materials/[id]` | current | linked from screens | — | Current. |
| `/masterdata/materials/new` | current | linked from screens | — | Current. |
| `/masterdata/products` | current | menu | — | Current. |
| `/masterdata/products/[id]` | current | linked from screens | — | Current. |
| `/masterdata/products/[id]/skus/[skuId]` | current | linked from screens | — | Current. |
| `/masterdata/reason-codes` | current | menu | — | Current. |
| `/masterdata/reason-codes/[id]` | current | linked from screens | — | Current. |
| `/masterdata/recipes` | redirect (alias) | /masterdata/formulas (Recipes (advanced)) | — | Kept: list alias; new recipes start at /masterdata/recipes/new. |
| `/masterdata/recipes/[formulaId]` | current | linked from screens | — | Current. |
| `/masterdata/recipes/new` | current | menu | — | Current. |
| `/masterdata/routings` | advanced (kept) | Steps (advanced) | — | ADR-096. |
| `/masterdata/routings/[id]` | advanced (kept) | Steps (advanced) | — | ADR-096. |
| `/masterdata/routings/[id]/revisions/[revisionId]` | advanced (kept) | Steps (advanced) | — | ADR-096. |
| `/masterdata/routings/new` | advanced (kept) | Points to the step-by-step recipe first | — | ADR-096. |
| `/masterdata/sites` | current | menu | — | Current. |
| `/masterdata/sites/[id]` | current | linked from screens | — | Current. |
| `/masterdata/suppliers` | superseded → redirect | /procurement/suppliers (Suppliers we may buy from) | delete-draft redirect, save action, help getting-started, demo script; nav entry to remove | Redirect (keeps q, all, deleted). Add a supplier, CSV download and “stopped using” suppliers moved into the procurement list; QA-status filter dropped (status chip on every row; CSV export keeps the filter). |
| `/masterdata/suppliers/[id]` | advanced (kept) | Reached from the supplier page: Contact → “Change contact details” | search result, record-links `supplier`, delivery page supplier link → /procurement/suppliers/[id] | Kept for its unique job (edit contact, terms, QA status fields, delete draft). Breadcrumb goes to the one supplier list. |
| `/masterdata/suppliers/new` | current | “Add a supplier” on /procurement/suppliers | after saving a new supplier → /procurement/suppliers/[id]?created=1 | Create form stays (4 fields). |
| `/masterdata/uom` | current | menu | — | Current. |
| `/masterdata/warehouses` | current | menu | — | Current. |
| `/masterdata/warehouses/[id]` | current | linked from screens | — | Current. |
| `/masterdata/work-instructions` | current | menu | — | Current. |
| `/masterdata/work-instructions/[id]` | current | linked from screens | — | Current. |
| `/masterdata/work-instructions/new` | current | linked from screens | — | Current. |
| `/notifications` | current | Messages | taps pass through currentHref (notificationHref) | Information only; empty state in plain words. |
| `/offline` | current | linked from screens | — | Current. |
| `/operations` | current | menu | — | Current. |
| `/operations/flow` | current | Operations → How work flows | — | ADR-110 C0: the 16 steps from "Ask to buy" to "Invoice" with today's counts; help `docs/help/work-flow.md`. |
| `/operations/flow/[count]` | current | linked from How work flows (each number) | — | ADR-110 C0: the records behind one number, oldest first; each row opens its own record. |
| `/portal` | current | linked from screens | — | Current. |
| `/portal/account` | current | linked from screens | — | Current. |
| `/portal/documents` | current | linked from screens | — | Current. |
| `/portal/documents/[kind]/[id]` | current | linked from screens | — | Current. |
| `/portal/invite` | current | linked from screens | — | Current. |
| `/portal/order` | current | linked from screens | — | Current. |
| `/portal/orders` | current | linked from screens | — | Current. |
| `/portal/orders/[id]` | current | linked from screens | — | Current. |
| `/portal/sign-in` | current | linked from screens | — | Current. |
| `/portal/sign-in/verify` | current | linked from screens | — | Current. |
| `/print/bmr/[batchId]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/box-label/[containerId]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/complaint-acknowledgement/[complaintId]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/credit-note/[id]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/delivery-receipt/[shipmentId]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/dispensing-sheet/[batchId]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/documents/[id]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/invoice/[id]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/labels/[jobId]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/labels/batch-boxes/[batchId]` | current | Wrap step → Open the box labels and print | — | ADR-104 §2, ADR-099: box labels of one batch, printed where the work happens. |
| `/print/labels/pack/[packId]` | current | Boxing → Print N labels | — | ADR-099 (re-audit B N9): box labels of one boxing, printed where the boxing happens. |
| `/print/labels/receipt/[grId]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/labels/test/[labelTemplateId]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/lot-label/[lotId]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/lot-label/receipt/[grId]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/pick-list/[pickId]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/purchase-order/[id]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/quotation/[id]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/reports/[code]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/return-receipt/[returnId]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/statement/[customerId]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/print/traveler/[batchId]` | other engineer | — | — | Owned by the labels/printing engineer (not changed here). |
| `/procurement` | current | menu | — | Current. |
| `/procurement/expected` | current | menu | — | Current. |
| `/procurement/expected/[poId]` | redirect (alias) | /inventory/receive?po=<id> (Receive materials) | — | Kept (ADR-077). |
| `/procurement/forecast` | current | menu | — | Current. |
| `/procurement/orders` | current | menu | — | Current. |
| `/procurement/orders/[id]` | current | linked from screens | — | Current. |
| `/procurement/orders/new` | current | 4-step purchase order wizard | — | Current. |
| `/procurement/performance` | current | menu | — | Current. |
| `/procurement/reorder` | current | menu | — | Current. |
| `/procurement/requests` | current | menu | — | Current. |
| `/procurement/requests/[id]` | current | linked from screens | — | Current. |
| `/procurement/requests/new` | current | linked from screens | — | Current. |
| `/procurement/returns` | current | menu | — | Current. |
| `/procurement/returns/[id]` | current | linked from screens | — | Current. |
| `/procurement/returns/new` | current | linked from screens | — | Current. |
| `/procurement/suppliers` | current | The one supplier list | masterdata list redirects here | Gained Add a supplier, CSV, stopped-using toggle, deleted banner. |
| `/procurement/suppliers/[id]` | current | The supplier page | search, record-links, delivery page, after create | Gained “Change contact details” and the created banner. |
| `/production` | other engineer | — | — | Owned by the production engineer (not changed here). Planning tools “Batch records”; search and scan still open /production/[batchId]. |
| `/production/[batchId]` | other engineer | — | — | Owned by the production engineer (not changed here). |
| `/production/[batchId]/closure` | current (restricted) | Batch record ⋯ More (site manager, production admin, QA) | — | Re-audit 2026-11-01: the page and `getClosureView` refuse everyone without `production.batch.approve`, `production.batch.admin` or `quality.disposition.approve` (operators typing the URL get "You don't have access"). Negative test in `tests/integration/production/bmr-closure.test.ts`. |
| `/production/[batchId]/finish` | other engineer | — | — | Owned by the production engineer (not changed here). |
| `/production/board` | retired → redirect (ADR-115) | /production/orders?view=board (the "Board" button of Production orders) | — | ADR-115 §1: retired; server redirect; page, action, service, setting `production.board.columns` and their tests removed (code change in the same clean-up). |
| `/production/defects` | other engineer | — | — | Owned by the production engineer (not changed here). |
| `/production/new` | superseded → redirect | /production/orders/new (New production order) | — | Server redirect (UX audit round 1, ADR-102); "make a batch without an order" is no longer offered. |
| `/production/orders` | other engineer | — | — | Owned by the production engineer (not changed here). |
| `/production/orders/[workOrderId]` | other engineer | — | — | Owned by the production engineer (not changed here). |
| `/production/orders/[workOrderId]/continue` | redirect (alias) | the batch's next production screen (Get materials, Start check, Weigh, Step, Finish, Check quality) or its batch record | — | "Continue this batch": used by the board, the scanner, the batch record's next step and old bookmarks. |
| `/production/orders/[workOrderId]/materials` | other engineer | — | — | Owned by the production engineer (not changed here). |
| `/production/orders/[workOrderId]/step/[n]` | other engineer | — | — | Owned by the production engineer (not changed here). |
| `/production/orders/[workOrderId]/weigh` | other engineer | — | — | Owned by the production engineer (not changed here). |
| `/production/orders/[workOrderId]/weigh/more` | current | Weigh card → More details → Other ways to weigh | — | One path for production work (ADR-100): container weight, a second lot, undo a wrong weighing, approval out of range. |
| `/production/orders/new` | other engineer | — | — | Owned by the production engineer (not changed here). |
| `/production/plan` | other engineer | — | — | Owned by the production engineer (not changed here). Planning tools; the “Plan more” / low-stock links now open /production/orders/new. |
| `/production/plan/[planId]` | other engineer | — | — | Owned by the production engineer (not changed here). |
| `/production/staging` | superseded → redirect | /production/orders | — | Server redirect (UX audit round 1, ADR-102); Get materials is the Materials list of each batch (ADR-106). |
| `/production/staging/[batchId]` | retired → redirect (ADR-115) | /production/[batchId] (the batch record) | — | ADR-115 §1: retired; server redirect to the batch record. The old QA lot-substitution path is replaced by ADR-104 §1 (other lot at weighing). The paper weighing sheet and batch traveler print from the batch record (⋯ More). |
| `/production/today` | other engineer | — | — | Owned by the production engineer (not changed here). |
| `/production/work-orders` | superseded → redirect | /production/orders (query kept) | links from shared code point to /production/orders/[id] | Server redirect (ADR-102, ADR-105). |
| `/production/work-orders/[workOrderId]` | superseded → redirect | — | `/production/orders/[id]` (`?tab=materials` → Materials, `?tab=batches` → Batches) | Re-audit 2026-11-01 (ADR-105). Its unique capabilities moved to the order page first: **Plan the batch** / "Plan batch n of N" (`createBatchFromWorkOrder`), **Set aside new stock** (was "Reserve again", `reserveWorkOrderShortages`), **Change this draft** (`editWorkOrder`), recipe/steps versions, newer-recipe note, people, use-first and unusable lots, and the order history in words. Plan + release ("resolve revisions") is done by Approve. The old view's commands (`workOrderCommandAction`, `cancelWorkOrderAction`, `next-step.tsx`) were removed. Guard: `tests/unit/production-one-path.test.ts` (no module/page links to `/production/work-orders/`). |
| `/production/work-orders/new` | superseded → redirect | /production/orders/new | — | Server redirect (ADR-102). |
| `/quality` | current | QA queue: the one list of what waits for QA | is now the target of the Quality check tab (after N10) and the Operations Center stage | Counts use one rule (`qaQueueCount`) for the list, Home and (after L1) the menu badge. |
| `/quality/batches/[batchId]` | advanced (kept) | “Full QA review page” in ⋯ More of /quality/check/[batchId]; “OK with conditions” approvals | To approve “batch waits for the QA check”, decision history (dispositions), QA decisions report, deviation, lot, inspection list/detail, recall page → /quality/check/[batchId] | Kept for OK with conditions (request and second-person decision) and the weighing detail; everything else uses the one-page check. |
| `/quality/bulk` | advanced (kept) | QA queue ⋯ More / Quality menu “Decide many lots at once” | — | QA only; not in floor menus. |
| `/quality/capa` | current | menu | — | Current. |
| `/quality/capa/[capaId]` | current | linked from screens | — | Current. |
| `/quality/capa/new` | current | linked from screens | — | Current. |
| `/quality/changes` | current | menu | — | Current. |
| `/quality/changes/[changeId]` | current | linked from screens | — | Current. |
| `/quality/changes/new` | current | linked from screens | — | Current. |
| `/quality/check` | superseded → redirect | /quality (QA queue) | Operations Center “Quality check” stage, help check-quality.md, currentHref; nav entries to repoint (N10) | Redirect. It listed only finished batches; the QA queue lists the same batches (oldest first, same “Check this batch” next step, failed tests, open problem reports) plus deliveries waiting for the QA check and lots stopped by QA, so a QA person saw only part of the work on their main tab and a menu badge that did not match the list. |
| `/quality/check/[batchId]` | current | — | now the target of every “decide this batch” link | The one-page check (ADR-080 §8). |
| `/quality/complaints` | current | menu | — | Current. |
| `/quality/complaints/[complaintId]` | current | linked from screens | — | Current. |
| `/quality/complaints/new` | current | linked from screens | — | Current. |
| `/quality/deviations` | current | menu | — | Current. |
| `/quality/deviations/[deviationId]` | current | linked from screens | — | Current. |
| `/quality/deviations/new` | current | linked from screens | — | Current. |
| `/quality/holds` | current | menu | — | Current. |
| `/quality/holds/[holdId]` | current | linked from screens | — | Current. |
| `/quality/holds/issue` | advanced (kept) | Stopped by QA ⋯ More | — | Exception screen (take out stopped stock) with its banner. |
| `/quality/holds/new` | current | linked from screens | — | Current. |
| `/quality/inspections` | current | menu | — | Current. |
| `/quality/inspections/[inspectionId]` | current | linked from screens | — | Current. |
| `/quality/label-verification` | current | menu | — | Current. |
| `/quality/lots/[lotId]` | current | linked from screens | — | Current. |
| `/quality/recall` | current | menu | — | Current. |
| `/quality/recalls` | current | menu | — | Current. |
| `/quality/recalls/[recallId]` | current | linked from screens | — | Current. |
| `/quality/recalls/new` | current | linked from screens | — | Current. |
| `/quality/trace` | current | menu | — | Current. |
| `/reports` | current | menu | — | Current. |
| `/reports/[code]` | current | linked from screens | — | Current. |
| `/reports/runs/[runId]` | current | linked from screens | — | Current. |
| `/reports/schedules` | current | menu | — | Current. |
| `/reports/schedules/[id]` | current | linked from screens | — | Current. |
| `/reports/schedules/new` | current | linked from screens | — | Current. |
| `/reset-password` | current | linked from screens | — | Current. |
| `/sales` | current | menu | — | Current. |
| `/sales/[orderId]` | current | linked from screens | — | Current. |
| `/sales/board` | current | Alternative view of Customer orders | — | Same orders as /sales as columns; kept (nav “Orders as a board”). |
| `/sales/customers` | current | Customers split view | — | Current; the panel links to the full record. |
| `/sales/customers/[id]` | current | Full customer record (rules, portal access, edit) | — | Unique capabilities; opened from the split view and search. |
| `/sales/customers/new` | current | linked from screens | — | Current. |
| `/sales/dispatch` | current | menu | — | Current. |
| `/sales/new` | current | 3-step order wizard | help order.md and demo scene 9 rewritten to the wizard | Current. |
| `/sales/orders/[orderId]/edit` | current | linked from screens | — | Current. |
| `/sales/packing/[shipmentId]` | current | linked from screens | — | Current. |
| `/sales/picking` | current | menu | — | Current. |
| `/sales/picking/[pickId]` | current | linked from screens | — | Current. |
| `/sales/price-lists` | current | menu | — | Current. |
| `/sales/price-lists/[id]` | current | linked from screens | — | Current. |
| `/sales/price-lists/[id]/edit` | current | linked from screens | — | Current. |
| `/sales/price-lists/new` | current | linked from screens | — | Current. |
| `/sales/quotations` | current | menu | — | Current. |
| `/sales/quotations/[id]` | current | linked from screens | — | Current. |
| `/sales/quotations/[id]/edit` | current | linked from screens | — | Current. |
| `/sales/quotations/new` | current | linked from screens | — | Current. |
| `/sales/returns` | current | menu | — | Current. |
| `/sales/returns/[returnId]` | current | linked from screens | — | Current. |
| `/sales/returns/new` | current | linked from screens | — | Current. |
| `/sales/shipments` | current | menu | — | Current. |
| `/sales/shipments/[shipmentId]` | current | linked from screens | — | Current. |
| `/sign-in` | current | linked from screens | — | Current. |
| `/sign-in/verify` | current | linked from screens | — | Current. |
| `/sync` | current | menu | — | Current. |
| `/sync/conflicts` | current | menu | — | Current. |
| `/sync/conflicts/[id]` | current | Phone change to check | fixed broken lot link | Current. |
| `/warehouse` | current | Warehouse sections (tiles per part of the warehouse) | — | Was the S6 “warehouse home”; its copy of the day's tasks (receive, put away, move, scan, count) duplicated the warehouse Home tiles (ADR-090) and was removed. Now only the section overview, titled like its menu entry. |
| `/warehouse/packs` | current | menu | — | Current. |
| `/warehouse/packs/[packId]` | current | linked from screens | — | Current. |
| `/warehouse/repack` | current | menu | — | Current. |
