# UX re-audit A: Production, Quality, Maintenance (live app, 2026-11-01, after fix rounds 1 and 2)

Auditor: independent, read-only. Live app: https://bryels-care-production.up.railway.app (demo data, fictional).
Baseline: `docs/ux-audit/A-production-quality-maintenance.md` (2026-10-31, 15 pass / 54 fail of 69 rows), ADR-098..103.
Screenshots: `/tmp/claude-0/-home-user-bryels-care/103807bc-c37f-572c-a3d5-4a6ebca2aac4/scratchpad/ux-reaudit/A/*.png`
(name pattern `<screen>-<role>-<viewport>.png`). Screenshots taken before the demo reset are in `A/pre-reset/`.
Nothing was saved, submitted, approved, printed, deleted or reset by me. I did not open `/print/labels/[jobId]` (that page
calls the browser print; the in-step preview uses the same renderer, ADR-099).

## Audit setup and caveats

- Roles: operator.nfd (Rhea), checker.nfd (Jun), qa.nfd (Nina), planner.nfd (Cora), manager.nfd (Dino), owner (Ana),
  floor.nfd. Viewports 390x844 (isMobile, hasTouch) for every row, 820x1180 for operator Home, weigh, Get materials,
  step 6 and the batch record; 1440 for the floor TV.
- Sandbox quirk (not an app defect): Chromium got 404 for JS chunks of `[param]` routes. Worked around with route
  interception that rewrites `%28app%29` → `(app)` and re-fetches `%5B…%5D` chunks.
- **The demo was reset twice while I was auditing (about 12:20 and 12:35)**, and someone (the owner, by the audit
  trail: Ana Villanueva / Jun Dela Cruz / Dino Reyes acting at 12:41–12:49) walked B-26-0006 of the new order WO-26-00003
  from weighing to step 6 live. All record ids changed twice; I re-discovered ids from Home and lists each time. The
  results below use post-reset data, except where a pre-reset screenshot is the only evidence of a state (marked
  "pre-reset"). Nothing in this report is "needs demo reset" any more: the reset brought the new demo data (product
  label template, packaging lines, an order batch in progress), and I could check it.

## Summary

| | First audit (2026-10-31) | Re-audit (2026-11-01) |
|---|---|---|
| Rows checked (same 69 rows) | 69 | 69 (+1 new row P7b) |
| Pass all applicable criteria | **15** | **35** |
| Fail at least one | 54 | 34 |
| Old screens reachable from a button | 11 entries | 3 entries (all lead to the old order view `/production/work-orders/[id]` or the old board) |

By area: Production 13 pass / 19 fail (was 3/29); Quality 18 / 11 (was 10/19); Maintenance 4 / 4 (was 2/6).

The owner's complaint is fixed: **no Home, My work or order-hub "do work" button opens the old batch workspace any more.**
`/production/[batchId]` is now a read-only "Batch record" with one "Continue this batch" button, batches without an
order use the same flow screens under `/production/orders/without-order/...`, the step-6 packaging form is the new card
(wrapper taken at Get materials or tapped/scanned, product label preview, printer and size named), weighing confirms
the lot by scan, QA decides in one place, and the planner has a real Home.

What remains is mostly second-order: one old screen (`/production/work-orders/[id]`) is still the target of a green
button and two links; the board and plan pages still use the old words; configured step names leak on the hub, the
"Not yet" banners and the batch record; several screens still have more than one green button; and a few new
inconsistencies (Get materials "every line is taken" while every line says "Not yet", raw event keys in the batch
timeline, order status lagging its batch).

## Findings: status per first-audit finding

| # | First-audit finding | Status | Evidence now |
|---|---|---|---|
| T1 | Home "Continue" opens the old workspace for batches without an order | **FIXED** | All Home links go to `/production/orders/without-order/{weigh,materials,step/n}?batch=…` or `/production/orders/<wo>/…`. `/production/[id]` = "Batch record B-26-0004", read-only, one "Continue this batch → Weigh". `op-home-*`, `op-batch-B4-*`, `pre-reset/op-step6-B4-*` |
| T2 | Second-person checks and "Check quality" go to the old page; checker has no Check task | **FIXED** (small leftovers) | Pre-reset: Rhea's Home top card "Check 2 weighings · B-26-0005 · Check" → weigh screen card "Rhea Mendoza, did you watch Jun Dela Cruz weigh 3,723.2 g of Coconut Oil, lot LM-2610-0005? Yes, I checked it". Jun (the weigher) sees "Second check needed… They pick their name". Batch record "Check quality" → `/quality/check/[id]`. Leftovers: no visible "No / send back" on the check card; the check screen is titled "Weigh" (N9). `pre-reset/op-check-B5-*`, `pre-reset/chk-weigh-B5-*` |
| T3 | No packaging on Get materials; labels printable before anything is made | **FIXED** | Order batch B-26-0006/7: Get materials has a "PACKAGING · Soap wrapper 135 g 123 pcs · Lot L-2611-00019" line; step 6 shows "You took these at Get materials … No scanning". No-order batches: clear note "this product has no packaging set up per piece… on the packaging step you tap the one you took" + ScanOrPick on step 6. Before step 6 the label panel says "Labels are printed on the step 'Packaging and labeling'. Finish 'Weighing' first." and no print button/forms are shown; server gate `labelPrintBlocker` in `src/modules/production/packaging-flow.ts:265-267`. `op-step6-B4locked-*`, `pre-reset/op-step6-B6-*`, `op-materials-B7-*` |
| T4 | QA rule differs between `/quality/check/[id]` and `/quality/batches/[id]` | **FIXED** | Full review now says "type the tests and say OK… on the Check quality screen (one place, the same rules for everyone)" with a button to it; the check page has the hand-entry test row. `qa-check-B3-*`, `qa-batches-B3-*` |
| T5 | Weighing asks to type "last 4 of the lot" | **FIXED** | Primary "Scan the lot label" (camera or handheld); "Label damaged? Type the last 4 characters instead" is a fallback link. `op-weigh-B4-*` |
| T6 | Order hub: several green buttons, links to old screens, stepper "Approv/ed" | **PARTLY FIXED** | One green next-step button; per-batch buttons and "Save to daily log" are secondary; stepper fits. **Still open:** "More details → Advanced: full order record WO-…" and (manager, approved order without batch) green **"Plan the batch"** both open the old `/production/work-orders/[id]`. `op-hub-approved-*`, `mgr-hub-approved-nobatch-*` |
| T7 | Same order, different status words on sibling screens | **PARTLY FIXED** | `/production/work-orders` and `/new` redirect to the new list/form. Still open: `/production/board` uses "Move to… Planned: Get ready for approval (stays Draft)", "Released · to stage: Approve and set materials aside"; the old order view says "Plan (resolve revisions)" for a Draft the hub says to "Approve"; WO-26-00003 is "Approved · 0 of 2 done" on list and hub while B-26-0006 is at step 6 (N6). `mgr-board-*`, `mgr-wo-detail-*`, `mgr-orders-*` |
| T8 | Configured step words not grade-5 | **PARTLY FIXED** | Step screens: "Weighing area clean-area check", "Put in the hold area", "count wrappers used and spoiled", "Move finished goods to hold area until QA checks it"; exact setup words folded. Still raw: hub next step and button "Packaging area line clearance", "Not yet: Finish 'Packaging area line clearance' first", step 4 "mix to trace" and "See how (WI-SOAP-MIX)", every batch record ("line clearance", "Transfer to quarantine storage area", "reconcile wrappers used and destroyed", "Dispense each ingredient against the formula"). `op-step4-B6done-*`, `op-batch-B6-*` |
| T9 | Finished-goods label is the internal lot label; no label, printer or size named; no scan step | **FIXED** (owner/QA decision A-LBL-02 still open) | Step 6: "Label for each bar", product label 70 × 40 mm (no status bar, no bulk quantity), "Printer: Label printer, Warehouse 1 · label 70 × 40 mm. In the print window choose this printer and Actual size", "Scan a bar's square code at boxing or on the Scan screen". `/labels` is "Labels printed" with "Which label goes where?". Leftovers: label face shows "LBL-PROD v1" and "NEW"; after a 1-label job exists the panel only offers "Print 1 label" for a 123-bar batch (N5); physical print size not verified. `op-step6-B6-open-*` |
| T10 | Planner Home is the old tile page; QA badge 11 vs 2 | **FIXED** | Planner: "This screen is for the planner…", one next step "5 production orders wait for approval… See the orders". QA badge 10 = 2 batches + 8 lots, same as the list. `pln-home-*`, `qa-check-B3-*` (badge) |
| O1 | `/quality/inspections` asks to start tests on batches still weighing | **STILL OPEN** | "Batches waiting for their tests to start: Acapulco Soap 135 g B-26-0006 · Start the quality check" while B-26-0006 was in progress. `qa-inspections-*` |
| O2 | Deviation "New" but CAPA already being fixed | **FIXED** | DEV-26-0001 is "QA is looking into it" with one "Close the report" box; CAPA-26-001 linked. `qa-deviations-detail-*` |
| O3 | Supplier differs between QA queue and lot page | **FIXED** | Both show "Manila Print & Pack" for L-2611-00022. `qa-lot-first-*` |
| O4 | `/production/board` 5,400 px tall, code-first, move selects | **STILL OPEN** | 5,139 px, 37 cards, "Move to…" selects 34 px, old status words; product name now first. `mgr-board-*` |

## Fix list from the first audit: status

| # | Fix | Status |
|---|---|---|
| 1 | Close the fallback to the old workspace | FIXED (but see old order view, #8 below) |
| 2 | Second-person checks on own screen + Home task | FIXED (send-back option not visible) |
| 3 | Packaging on Get materials | FIXED |
| 4 | Lock printing; hide forms under "Not yet"; no green "Go to Finish" under "Not yet" | FIXED |
| 5 | Say which label, printer, size | FIXED (A-LBL-02 content decision open) |
| 6 | One QA rule; tests on check page; button in next-step box | FIXED except the box still has no button ("Next: decide OK to use or not OK (box Decision).") |
| 7 | Weigh: scan, no typed code | FIXED |
| 8 | One status vocabulary | PARTLY (board, old order view, order-vs-batch lag) |
| 9 | Plain step names from configuration | PARTLY (step screens yes; hub, banners, batch record, step 4 no) |
| 10 | Hub: one green, stepper, no old links | PARTLY (old links remain) |
| 11 | Planner Home | FIXED |
| 12 | QA data/logic | 3 of 4 FIXED (inspections list still open) |
| 13 | Phone tap targets ≥44 px | PARTLY: fixed for holds radios (pill rows), maintenance and complaint checkboxes (≥44 px label rows), trace "What is this?"; still small: production-order name links 324×25, Home "My work" text link, order-hub tabs 40 px, QA bulk checkboxes 20 px and "Tick all"/"Untick all" 19 px, lot links 20 px on `/quality/batches`, complaint, hold and maintenance plan pages, board selects 34 px, "See all" 41 px wide on `/maintenance` |
| 14 | Names before codes | PARTLY: label-verification areas, My work separator FIXED; `(CUS-00x)` in complaint picker and detail, `/production` batch list ("B-26-0005 Planned Guava…", "F-GBS-01 rev 1"), weigh "Use another lot" select, batch record titles still code-first |
| 15 | Missing intros / empty states | PARTLY: `/production/today` title = menu FIXED; `/production/defects` ("Rejects") empty state still "Nothing recorded yet." + formula; `/quality/deviations/new` still no h1 |
| 16 | Restrict `/production/[id]/closure` | STILL OPEN: link hidden from operators in the record's ⋯ More, but the operator still opens the page by URL (`op-closure-B4-*`) |

## New findings (not in the first audit)

| # | Finding | Where | Severity |
|---|---|---|---|
| N1 | Get materials for a no-order batch says "Materials ready · Every line is taken. Next: Weigh" while every line below reads "NOT SET ASIDE … Not yet". | `/production/orders/without-order/materials?batch=<B-26-0004>` (`op-materials-B4-*`) | High (contradiction on an operator screen) |
| N2 | Manager on an approved order with no batch: the only green button "Plan the batch" opens the old order view `/production/work-orders/[id]` ("Older view…", "FORMULA REVISION", "Plan (resolve revisions)"). | `src/app/(app)/production/orders/[workOrderId]/page.tsx:44` (`mgr-hub-approved-nobatch-*`, `mgr-wo-detail-*`) | High (old screen as primary path) |
| N3 | Batch record timeline shows raw keys: "governance.owner_override.used", "Reason: Owner override (setting governance.owner_override)", "production.batch.materials_confirmed", "Value oil_temp = 30 °C", "Value trace_time = 100 min", "Value mould_id = ABC", "Equipment SC-01 released". | `/production/[batchId]` (`op-batch-B6-*`, `pre-reset/op-batch-B4-*`) | Medium |
| N4 | Step 6 (open) has three green buttons: "Print 1 label", the keypad "Step done" and the bottom "Step done"; the keypad "Step done" sits next to the spoiled-wrappers field. | `/production/orders/<wo>/step/6` (`op-step6-B6-open-*`) | Medium |
| N5 | Once a label job exists, the panel shows "These labels are ready but not printed yet (1 label). Print 1 label" with no "How many?" control, for a 123-bar batch. If the first job was made with 1 copy, the operator has no visible way to print the other bars' labels. Needs a check by the engineer. | step 6 and Finish of B-26-0006 | Medium (verify) |
| N6 | Order status lags its batches: WO-26-00003 shows "Approved · 0 of 2 done" (list, hub stepper) while B-26-0006 is "Being made, step 6"; the list row button says "Get materials" (for B-26-0007) while the hub's next step is B-26-0006's step. | `/production/orders`, `/production/orders/[id]` | Medium |
| N7 | A stale batch link (deleted batch, e.g. after reset, or a stored notification) on the flow screens gives the bare Next.js "404 This page could not be found", no app frame message or way back. | `/production/orders/without-order/weigh?batch=<unknown>` | Low–medium (criterion 8) |
| N8 | Yield printed unrounded: "118 (expected 123) · 95.2751 % (OK 95–102 %)". | `/quality/check/[BM-2611-0024]` | Low |
| N9 | The second-person check card offers only "Yes, I checked it" (no visible "No, send it back"), and the screen title is "Weigh" although Home says "Check 2 weighings". | `/production/orders/<wo>/weigh?batch=` as checker | Low–medium |
| N10 | QA bottom tab "Quality check" vs its screen H1 "Check a batch or delivery" (ADR-101 says menu word = H1). Planner tile "QA queue" also differs. | app frame (QA), planner Home | Low |
| N11 | Weigh card offers three ways to choose the lot (select "Use another lot" listing codes first, six tap cards, scan); the card is ~1,000 px tall before the weight field. | `/weigh` (`op-weigh-B4-*`) | Low |
| N12 | Get materials: one green "Taken" per line plus a green "All taken" (5–7 green buttons). | `/materials` (`op-materials-B5-*`, `op-materials-B7-*`) | Low |
| N13 | `/weigh/more` without an ingredient: no title; "Back to the order" goes to the weigh screen. | `/production/orders/<wo>/weigh/more` | Low |

## Screen table (same rows as the first audit)

Legend: ✓ pass, ✗ fail, – not applicable. Criteria: 1 intro · 2 one next step/one green · 3 ≤5 fields · 4 no typed codes · 5 grade-5 words · 6 names before codes · 7 phone fit + 44 px · 8 empty/error states · 9 consistency · 10 not an old screen. "Was" = first audit result.

### Production

| # | Route | Role / VP | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Was | Now | Note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | `/dashboard` operator | op 390+820 | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✓ | All links to flow screens; one green on the top card; "Check 2 weighings" task (pre-reset). "My work" text link still small. |
| P2 | `/dashboard` checker | chk 390 | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✓ | Check task goes to whoever did not weigh (Rhea pre-reset); Jun correctly gets none for his own weighings. |
| P3 | `/dashboard` planner | pln 390 | ✓ | ✓ | – | ✓ | ✓ | – | ✓ | – | ✗ | ✓ | ✗ | ✗ | New per-role Home. Tile "QA queue" ≠ screen "Check a batch or delivery"; waiting line names roles, not people. |
| P4 | `/production/orders` My work | op 390 | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | Separator fixed. Green top card + green row "Weigh" (pre-reset); name links 324×25. |
| P5 | `/production/orders` | mgr 390 | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | Five inline "Approve"; links 25 px; status lag (N6). |
| P6 | `/production/orders/[id]` with batches (WO-26-00003) | op 390 | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | One green ✓, stepper ✓. "Packaging area line clearance" as next step; tabs 40 px; "Approved" while batch at step 6; More details → old order view; Batches tab repeats buttons. |
| P7 | `/production/orders/[id]` approved, no batch | op 390 | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Operator: "Ask … to plan it" + who can help (unchanged). |
| P7b (new) | same, manager | mgr 390 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✗ | Green "Plan the batch" → old `/production/work-orders/[id]` (N2). Not counted in the 69. |
| P8 | `/production/orders/[id]` in QA (WOM-2611-025) | op 390 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | Waiting box names QA; daily-log Save now secondary. |
| P9 | `.../materials` | op 390+820 | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | Packaging section present ✓. Green per line (N12); no-order "every line is taken" vs "Not yet" (N1). |
| P10 | `.../weigh` | op 390+820 | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | – | ✓ | ✓ | ✗ | ✗ | Scan first ✓. Two Save buttons; lot select code-first (N11). |
| P11 | `.../step/1` | op 390 | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✓ | "Weighing area clean-area check". |
| P12 | `.../step/4` | op 390 | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | – | ✓ | ✓ | ✗ | ✗ | "mix to trace", "See how (WI-SOAP-MIX)", "Using MIX-01"; mould still free text (record: "mould_id = ABC"). |
| P13 | `.../step/6` packaging | op 390+820 | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✗ | Wrapper, label, printer, size ✓; locked before step ✓. Three greens (N4); "Finish 'Packaging area line clearance' first", "Record Wrappers used (pcs)." |
| P14 | `.../step/7` | op 390 | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✓ | "Put in the hold area"; no green under "Not yet". |
| P15 | `/production/[id]` B-26-0004 | op 390+820 | ✓ | ✓ | – | ✓ | ✗ | ✗ | ✓ | – | ✓ | ✓ | ✗ | ✗ | Now read-only record (old workspace gone). Raw step names, raw timeline keys (N3), code title. |
| P16 | `/production/[id]` B-26-0005 | op 390 | ✓ | ✓ | – | ✓ | ✗ | ✗ | ✓ | – | ✓ | ✓ | ✗ | ✗ | Same as P15 ("Dispense each ingredient against the formula"). |
| P17 | `/production/[id]` released | own 390 | ✓ | ✓ | – | ✓ | ✗ | ✗ | ✓ | – | ✓ | – | ✗ | ✗ | "Transfer to quarantine storage area"; "Lot LM-2611-0047 · 125 pcs · QUA-01". |
| P18 | `/production/[id]` awaiting QC | own 390 | ✓ | ✓ | – | ✓ | ✗ | ✗ | ✓ | – | ✓ | – | ✗ | ✗ | Next step "Check quality" ✓ (fixed); words/codes as P17. |
| P19 | `/production/[id]/finish` | op 390 | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | Back → batch record ✓; print only from packaging step ✓. Title "Finish · B-26-0004"; "ingredient(s)". |
| P20 | `/production/[id]/closure` | op 390 | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | Operator still opens it by URL; "site NFD", "Controlled reopen", "BMR", "SOP", "transcription". |
| P21 | `/production` (Batch records) | mgr 390 | ✓ | – | – | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | "New batch" gone ✓. Code-first rows, "F-GBS-01 rev 1", 5,936 px, filter link 20 px. |
| P22 | `/production/board` | mgr 390 | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | Old move words; 5 selects; 34 px; cards → old order view. |
| P23 | `/production/defects` ("Rejects") | mgr 390 | ✓ | – | ✓ | ✓ | ✗ | – | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | Intro now present; empty state still "Nothing recorded yet."; formula. |
| P24 | `/production/today` | mgr 390 | ✓ | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | Title = menu "Today". |
| P25 | `/production/new` | mgr 390 | – | – | – | – | – | – | – | – | – | ✓ | ✗ | ✓ | Redirects to `/production/orders/new`. |
| P26 | `/production/orders/new` | pln 390 | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | ✓ | ✓ | 4 fields. |
| P27 | `/production/plan` | mgr 390 | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | Unchanged: "SKU", "OPEN WOS", "allocations", "FR-analytics-08", "ACS-135 · …". |
| P28 | `/production/staging` | mgr 390 | – | – | – | – | – | – | – | – | – | ✓ | ✗ | ✓ | Redirects to production orders. |
| P29 | `/production/work-orders` | mgr 390 | – | – | – | – | – | – | – | – | – | ✓ | ✗ | ✓ | Redirects. |
| P30 | `/production/work-orders/[id]` | mgr 390 | ✓ | ✗ | – | ✓ | ✗ | ✗ | ✓ | – | ✗ | ✗ | ✗ | ✗ | Still the older view, reachable from 4 links (see below). |
| P31 | `/production/work-orders/new` | mgr 390 | – | – | – | – | – | – | – | – | – | ✓ | ✗ | ✓ | Redirects to `/production/orders/new`. |
| P32 | `/floor` | floor 1440 | ✓ | – | – | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | Shows B-26-0006 "Waiting for a second person to check". "Next up" still an order with no batch, start date in the past (minor). |

### Quality

| # | Route | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Was | Now | Note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q1 | `/quality` | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Supplier now consistent. |
| Q2 | `/quality/lots/[id]` | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | "Start the quality check" and "OK to use" both primary; "Stop it (QA hold)"; radios 16 px. |
| Q3 | `/quality/check` | – | – | – | – | – | – | – | – | ✓ | ✓ | ✗ | ✓ | Redirects to `/quality`; badge 10 = list. |
| Q4 | `/quality/check/[id]` | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | Same rule as full review ✓; tests typed here ✓. Next-step box still has no button; "95.2751 %" (N8). |
| Q5 | `/quality/batches/[id]` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | Points to Check quality ✓. "line clearance", "QUA-01", lot links 20 px. |
| Q6 | `/quality/bulk` | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | ✗ | ✗ | 10 fields; ISO dates "2028-10-01"; checkboxes 20 px, "Untick all" 57×19. |
| Q7 | `/quality/capa` | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | |
| Q8 | `/quality/capa/[id]` | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✗ | Two green "Mark as done"; "Action(s) 1, 2 are not verified yet". |
| Q9 | `/quality/capa/new` | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | ✓ | ✓ | |
| Q10 | `/quality/changes` | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | |
| Q11 | `/quality/changes/[id]` | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | – | ✓ | ✓ | ✗ | ✗ | "Waiting for: QA approval." (no name); "USP"; "ACS-01, AHL-01, GBS-01"; green "Link". |
| Q12 | `/quality/changes/new` | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | ✓ | ✓ | |
| Q13 | `/quality/complaints` | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | "10:36We sent them this" still glued (minor). |
| Q14 | `/quality/complaints/[id]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | – | ✓ | ✓ | ✗ | ✗ | One next step now ✓. "(CUS-001)"; lot links 20 px. |
| Q15 | `/quality/complaints/new` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | – | ✓ | ✓ | ✗ | ✗ | Customers "(CUS-004)"; products "· ACS-135". |
| Q16 | `/quality/deviations` | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | |
| Q17 | `/quality/deviations/[id]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✓ | One box; status and CAPA consistent. |
| Q18 | `/quality/deviations/new` | ✗ | ✗ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | Still no h1, redirect text only. |
| Q19 | `/quality/holds` | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | |
| Q20 | `/quality/holds/[id]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | |
| Q21 | `/quality/holds/new` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✓ | Radios are 44 px pill rows; "Stop it" visible. |
| Q22 | `/quality/holds/issue` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✓ | 4 fields, primary visible. |
| Q23 | `/quality/inspections` | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✗ | ✓ | ✗ | ✗ | Still asks to start tests on B-26-0006 while it is being made. |
| Q24 | `/quality/inspections/[id]` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | – | ✓ | ✓ | ✗ | ✗ | 3 fields now; place no longer a code pick ✓. "IP-MAT-0012-IN", "PLACEHOLDER", "QUA-01". |
| Q25 | `/quality/label-verification` | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✓ | Names first ("Oils rack A-01"); code repeated after the name (minor). |
| Q26 | `/quality/recall` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | |
| Q27 | `/quality/recalls` | ✓ | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Q28 | `/quality/recalls/new` | ✓ | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Q29 | `/quality/trace` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✓ | No target under 44 px. |

### Maintenance

| # | Route | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Was | Now | Note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| M1 | `/maintenance` | ✓ | ✗ | – | ✓ | ✓ | ✗ | ✗ | – | ✓ | ✓ | ✗ | ✗ | Still green "Report a broken machine" + green "Open the job"; "Soap bar cutter (wire): PM-0002: Cutter wire…"; "See all" 41 px wide. |
| M2 | `/maintenance/plans` | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | |
| M3 | `/maintenance/plans/[id]` | ✓ | ✓ | – | ✓ | ✗ | ✗ | ✗ | – | ✓ | ✓ | ✗ | ✗ | "SPR-0002", "CUT-01"; job links 20 px. |
| M4 | `/maintenance/plans/new` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✓ | No small targets. |
| M5 | `/maintenance/spare-parts` | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | – | ✓ | ✓ | ✗ | ✗ | "Remove" next to each part (risky, unchanged). |
| M6 | `/maintenance/work-orders` | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | |
| M7 | `/maintenance/work-orders/[id]` | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✗ | "The job is done" green in the box and again as the form button. |
| M8 | `/maintenance/work-orders/new` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✓ | Checkbox inside a 44 px label row. |

Passing all applicable criteria (35): P1, P2, P7, P8, P11, P14, P24, P25, P26, P28, P29, P31, P32, Q1, Q3, Q7, Q9, Q10, Q12,
Q13, Q16, Q17, Q19, Q20, Q21, Q22, Q25, Q26, Q27, Q28, Q29, M2, M4, M6, M8.

### Print / labels

| # | Route | Now |
|---|---|---|
| L1 | `/labels` | "Labels printed" (history) with "Which label goes where?" (product label: print on the packaging step, stick on each bar, scan at boxing). FIXED. |
| L2 | Label preview on step 6 / Finish | Product label 70 × 40 mm, QR, product, lot, expiry, batch, made date; no status bar or bulk quantity; printer and "Actual size" named. Shows internal "LBL-PROD v1" and "NEW" on the face. Print page `/print/labels/[jobId]` not opened (read-only rule); physical size still to verify on a real printer (Safari ignores `@page`, ADR-099). |

## Walkthrough log

### A. Operator (Rhea), phone 390 and tablet 820
1. Home (pre-reset): 4 cards; top card "Check 2 weighings · Guava · B-26-0005" (green **Check**), then "Packaging and labeling · B-26-0004 · Continue", "Weigh the ingredients B-26-0006/7 · Continue" (outline). KPI "Weighing 2" now matches. (pre-reset/op-home-*)
2. **Check** → `/production/orders/without-order/weigh?batch=B-26-0005`: "Rhea Mendoza, did you watch Jun Dela Cruz weigh 3,723.2 g of Coconut Oil, lot LM-2610-0005? You sign with your own account. **Yes, I checked it**". Not pressed. No "No, send back" visible. (pre-reset/op-check-B5-*)
3. Card "Packaging and labeling B-26-0004" (no order) → `/production/orders/without-order/step/6`: new card "Which wrapper or label did you take?" with the released wrapper lot as a tap card + "Scan the lot label" + find by name; "Label for each bar" preview 100 × 50 (pre-reset, finished-goods fallback), "Printer: Thermal printer WH1", "How many? 123", "Print 123 labels", "Step done". **The old BC:LOT form is gone.** Not pressed. (pre-reset/op-step6-B4-*)
4. Finish of B-26-0004 (pre-reset): "Not ready… Finish step 6 first" + label panel (allowed at step 6); Back → read-only Batch record. Closure page still opens by URL. (pre-reset/op-finish-B4-*, op-closure-B4-*)
5. After reset: Home "Weigh the ingredients · B-26-0004 · Continue" (green), "Get the materials · B-26-0005 · Start". Continue → weigh: ingredient chips, "Coconut Oil 3,723.2 g, OK from 3,704.6 g to 3,741.8 g", lot LM-2611-0005 "use first", **Scan the lot label** (green), "Label damaged? Type the last 4 characters instead", weight field, keypad. (op-weigh-B4-390/820)
6. Start (B-26-0005) → Get materials: "No wrappers or labels are on this list (this product has no packaging set up per piece)…", 4 lines each with a green **Taken**, "All taken". Steps 1/4/6/7 show "Not yet: Get the materials first" with no forms. (op-materials-B5-*, op-step1-B5-*)
7. Get materials for B-26-0004 (at weighing): **"Materials ready · Every line is taken"** above five lines "Not yet" (N1). (op-materials-B4-*)
8. New order WO-26-00003 (appeared after reset, driven live by other users): hub has one green next step; Batches tab: B-26-0007 "Get materials", B-26-0006 "Packaging area line clearance", plus "Continue this batch" ×2. Get materials B-26-0007: RAW MATERIALS and **PACKAGING · Soap wrapper 135 g 123 pcs · Lot L-2611-00019**. (op-hub-approved-*, op-hub-WO3-batches-*, op-materials-B7-*)
9. B-26-0006 step 6 locked (before step 5 done): "Not yet", "You took these at Get materials · Soap wrapper… No scanning", label panel "Labels are printed on the step 'Packaging and labeling'". Then open (after others finished step 5): product label 70 × 40 preview, "Printer: Label printer, Warehouse 1 · label 70 × 40 mm… Actual size", "These labels are ready but not printed yet (1 label). **Print 1 label**", wrappers used / spoiled with keypad, "Step done" ×2. **Preview opened, nothing printed.** (op-step6-B6-*, op-step6-B6-open-390/820)
10. Step 7: "Put in the hold area", no green under "Not yet". Curing/resting: no batch in a wait step (floor TV "0 batches curing or resting"), not walkable.

### B. Checker (Jun), phone
1. Pre-reset Home: B-26-0005 shows "Weigh the ingredients · Continue" (he weighed 2 of 4); the weigh screen shows "Second check needed. Ask someone to watch you weigh Coconut Oil. They pick their name" with 5 names. Rhea (the other operator) got the "Check 2 weighings" task. Correct separation. (pre-reset/checker-home-*, pre-reset/chk-weigh-B5-*)
2. After reset: identical Home to Rhea (no weighing waiting for a check), then B-26-0006 "Mixing and cutting" on Jun's Home while Rhea's showed step 3: tasks follow who may act. (checker-home2-*)

### C. QA (Nina), phone, up to the decision
1. Home: "Next: 4 things wait for your decision. Open To approve"; "2 finished batches wait for the QA check" → `/quality`. Badge 10 = 2 batches + 8 lots. (qa-home-*, qa-queue-*)
2. `/quality/check` → redirects to `/quality`. **Check this batch** → `/quality/check/B-26-0003`: counts, "Nothing left the normal path", tests with a hand-entry row (Test name, What it should be, What you found, Is it OK?), Decision: tick + "OK to use" (disabled until ticked) / Not yet / Not OK. Stopped before pressing. (qa-check-B3-*)
3. ⋯ More → full review `/quality/batches/B-26-0003`: points back to Check quality, same rule. (qa-batches-B3-*)
4. `/quality/inspections` still lists B-26-0006 (being made) as "waiting for their tests to start" (Q23).
5. Problem report DEV-26-0001: "QA is looking into it", one box "Close the report"; CAPA-26-001 consistent.

### D. Planner and manager
1. Planner Home: new sentence + one next step "5 production orders wait for approval… See the orders". New order form: 4 fields, rest folded. (pln-home-*, pln-orders-new-*)
2. Manager: `/production/orders` list with inline "Approve" per draft; hub of a draft: one green "Approve", "Save" secondary, stepper fits. Approved order without batch: green **"Plan the batch" → `/production/work-orders/[id]`** (older view, "Plan (resolve revisions)"). `/production/new`, `/production/staging`, `/production/work-orders`, `/production/work-orders/new` redirect. `/production/board` and `/production/plan` unchanged. (mgr-*)

### E. Packaging and labels: the owner's questions now
| Question | Live answer |
|---|---|
| Where does the operator get the packaging? | Order batches: Get materials lists it under PACKAGING with lot and shelf; step 6 shows "You took these at Get materials". Batches without packaging set up: a note on Get materials, then tap or scan the wrapper on step 6. |
| Which label? | "Label for each bar" with a true-size preview of the product label (70 × 40 mm), no QUARANTINE bar. |
| How to print? | "Print N labels" on step 6 (and Finish), only from the packaging step on; printer name and "Actual size" are stated. Not pressed. |
| What does the preview look like? | QR, "SOAP", product name, lot, expiry, batch, made date; small "LBL-PROD v1" and "NEW" at the bottom. |
| How to scan it? | "Scan a bar's square code at boxing or on the Scan screen: it opens this batch, and its lot once the batch is finished." `/labels` repeats where each label is printed, stuck and scanned. |

## Old screens still reachable

| Old screen | Exact path |
|---|---|
| `/production/work-orders/[id]` older order view ("Older view of one production order", FORMULA/ROUTING REVISION, "Plan (resolve revisions)") | (1) Manager → Production orders → an approved order with no batch (WOM-2611-021) → green **Plan the batch** (`src/app/(app)/production/orders/[workOrderId]/page.tsx:44`). (2) Any order hub → **More details** → "Advanced: full order record WO-…" (`…/[workOrderId]/page.tsx:387`). (3) `/production/board` card links (`src/modules/production/board.ts:185`). (4) Plan detail rows (`src/app/(app)/production/plan/[planId]/page.tsx:115`). The old view links back to `/production/board`. |
| `/production/board` (old move words) | From the old order view's "Board" button; by URL. (`/production/orders` "Board" now opens the new `?view=board`.) |
| `/production/plan` (SKU table) | Menu → Production → Advanced → "Production plan" (`src/app/(app)/nav.ts:77`). Kept as an advanced planner tool, but unchanged words. |
| `/production/[id]/closure` | Operator by URL (UI link hidden for operators; page only checks `production.batch.view`, `src/app/(app)/production/[batchId]/closure/page.tsx:24`). Also notification links from `closure.ts:349,419` and `action-centre/detectors.ts:109`. |

Gone (redirect or replaced): `/production/[id]` workspace (now read-only record), `/production/new`, `/production/staging`,
`/production/work-orders`, `/production/work-orders/new`, `/quality/check` list, planner tile Home, old label desk.

## Ranked remaining fix list

1. **Stop sending people to the old order view.** `src/app/(app)/production/orders/[workOrderId]/page.tsx:44` ("Plan the batch": plan the batch in the hub or a new small form), `:387` (drop "full order record" or point it to the hub's More details), `src/modules/production/board.ts:185` (card href → `/production/orders/<id>`), `src/app/(app)/production/plan/[planId]/page.tsx:115`; then redirect `/production/work-orders/[workOrderId]` to `/production/orders/[id]` like its siblings (ADR-102).
2. **Get materials contradiction (N1).** `src/app/(app)/production/orders/[workOrderId]/materials` page: for batches already past materials (no reservation, "NOT SET ASIDE") do not show "Every line is taken" above "Not yet" lines; show the lines as done/taken or hide them.
3. **Plain step names everywhere, not only on the step card.** Use the plain subtitle in the hub next step and button, the "Not yet: Finish … first" banners, Home cards (already plain), the batch record step list and step 4 description/"See how (WI-…)"; `src/modules/production/flow-facts.ts`, `production-order-next.ts`, `src/app/(app)/production/[batchId]/page.tsx`. Config wording itself stays QA-owned.
4. **Batch record timeline in words (N3).** Map event keys (`governance.owner_override.used`, `production.batch.materials_confirmed`) and step values (`oil_temp`, `trace_time`, `mould_id`) to their labels in `src/app/(app)/production/[batchId]/page.tsx` timeline rendering; extend `tests/unit/no-jargon-messages.test.ts`.
5. **One green button on step 6, Get materials, weigh, CAPA, maintenance.** Step 6: print secondary once wrappers are counted or move "Step done" out of the keypad (`step/[n]/packaging-box.tsx` and the keypad component); Get materials: "Taken" as outline, only "All taken" green; weigh: one Save; `/quality/capa/[id]` one "Mark as done" (first open action); `/maintenance` "Report a broken machine" secondary; `/maintenance/work-orders/[id]` form inside the box (`src/ui/next-step-box.tsx`).
6. **Order status follows its batches (N6).** WO-26-00003 should read "In progress" once a batch is in process; the list row button should be the same next step as the hub (`production-order-next.ts`).
7. **Label panel quantity (N5).** In the ADR-099 panel, keep "How many?" (or "Print more labels") available after a job exists; confirm a 1-copy job does not block printing for the rest of the bars. Remove "LBL-PROD v1"/"NEW" from the face or move to a tiny footer only if QA wants it (A-LBL-02).
8. **Restrict `/production/[batchId]/closure`** to `production.batch.approve|admin` or `quality.disposition.approve` on the page (and server actions), with a negative test (ADR-100/103 open item).
9. **`/quality/inspections`**: do not list batches as "waiting for their tests to start" before Finish (`src/modules/quality` inspection queue query).
10. **Board and plan words**: `/production/board` move labels ("Released · to stage", "Get ready for approval (stays Draft)") to the order vocabulary (Draft / Approved / In progress / Quality check / Done); phone layout list instead of 37 tall cards. `/production/plan`: "SKU", "OPEN WOS", "allocations", "FR-analytics-08".
11. **Check card second-person "No"** (N9): show "No, send it back" with a reason on the weigh/step check card; title "Check the weighing" when the user is the checker.
12. **Tap targets** still under 44 px: production order name links (`/production/orders` list), Home "My work" link, hub tabs (40 px), `/quality/bulk` checkboxes and "Tick all/Untick all", lot links on `/quality/batches/[id]`, complaint and hold detail, `/maintenance/plans/[id]` job links, board selects.
13. **Names before codes**: `(CUS-00x)` in `/quality/complaints/new` and detail; `/production` batch rows ("B-26-…" first, "F-GBS-01 rev 1"); weigh "Use another lot" select; record titles "Batch record B-26-0004", "Finish · B-26-0004".
14. **Small ones**: `/quality/check/[id]` next-step box button and yield rounding (N8); `/quality/deviations/new` h1 + intro; `/production/defects` empty state saying who writes rejects and where; `/quality/changes/[id]` name the approver; friendly not-found for stale batch links on flow screens (N7); QA bottom tab word = "Check a batch or delivery" (N10); `/maintenance` "PM-0002:" repeated in the job title; `/maintenance/spare-parts` "Remove" behind ⋯ More.
