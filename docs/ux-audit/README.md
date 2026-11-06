# UX audit of the live app (2026-10-31)

| | |
|---|---|
| Asked by | Owner: "Audit every item in each category, ensure all changes were applied and the older screens are replaced. Become a UI/UX auditor." |
| Method | Three independent auditors, read-only, on the live Railway demo (https://bryels-care-production.up.railway.app) at phone 390 px, tablet 820 px, desktop 1440 px (and 1920 px for `/floor`), every screen in `docs/PAGE_REVIEW.md` per role, plus task walkthroughs from each role's Home and the menu map per role |
| Standard | 1 intro sentence · 2 one next step · 3 ≤5 visible fields · 4 never type a code · 5 grade-5 words · 6 names before codes · 7 phone fit and ≥44 px targets · 8 empty/error states · 9 consistency · 10 no old screen reachable |
| Reports | [A Production, Quality, Maintenance](A-production-quality-maintenance.md) · [B Inventory & warehouse, Purchasing, Sales](B-inventory-purchasing-sales.md) · [C Home, Setup, Finance, Reports, Settings, app frame](C-home-setup-finance-settings.md) |

## Result

| Area | Rows checked | Pass all 10 | Fail ≥1 |
|---|---|---|---|
| A Production, Quality, Maintenance | 69 | 15 | 54 |
| B Inventory & warehouse, Purchasing, Sales | 112 | 55 | 57 |
| C Home, Setup, Finance, Reports, Settings | 130 | 31 | 99 |
| **Total** | **311** | **101** | **210** |

`PAGE_REVIEW.md` marked every screen ☑ after the code-level pass; the audit of the running app disagrees on 210 rows.
No screen scrolls sideways; the phone failures are tap targets, covered or squeezed content and headers.

## Top problems (all areas)

1. **Old screens still open from Home and menus.** Operator Home "Continue" opens the old batch workspace for batches
   without a production order (old step-6 packaging form with "BC:LOT:…"); second-person checks link to it; Planning
   tools still lists the old order list, "Make a batch without an order", staging; old label print pages.
2. **Labels.** A "label desk" print queue is still the default; the label printed "one per bar" is the internal lot
   label (QUARANTINE bar, bulk quantity); labels are cut off and print small on a Letter page; no screen says which
   label goes where or how to scan it.
3. **Typed codes remain.** Weighing "last 4 of the lot"; supplier lot and shelf codes on receive; Scan screen
   "type a number".
4. **Two or three doors to the same job.** To approve ×3, Messages ×2, three different "Quality check(s)" screens, two
   supplier lists, two QA screens with opposite rules for the same batch.
5. **Phone ergonomics.** Targets under 44 px on 71 screens (top bar, tab row, chips, checkboxes, "What is this?");
   record page titles break one word per line; the tab row cuts off items.
6. **Next step missing or doubled** on ~40 record pages (setup details, finance documents, several green buttons on
   the order hub, purchase order draft, quotation).
7. **Codes and jargon still lead** in recent activity, messages, alerts, operations center, reports; 29 menu words
   differ from the screen titles.
8. **Logic and data:** packaging missing from the new flow for older batches; "Print labels" offered before packaging;
   recipe wizard sends an empty recipe; sent-out deliveries show 0 boxes; the site manager cannot buy and the message
   names nobody; counts differ between badge and list.

## Fix rounds

| Round | Content | Status |
|---|---|---|
| 1 (running when the audit ended) | Production one path (old batch workspace becomes read-only record; checks, packaging, start check on the new step cards); labels print in place with true preview; one scan-or-pick input everywhere; old screens redirected and links fixed | In progress |
| 2 | App frame and navigation (one door per job, menu words = screen titles, 44 px targets, phone headers, Scan in the phone top bar); remaining next steps, big forms, recipe wizard validation, codes-first feeds, demo data for picking/sending out, purchasing access for the site manager | Part 1 (app frame and navigation) done 2026-10-31; part 2 (the rest) done 2026-11-01, see below |
| 2, part 1 | One door per job (To approve: top-bar button from 640 px, Home tab on phones; Problems & alerts links to it; Messages only the bell; one QA door "Check a batch or delivery"; one supplier entry; one "Expense claims"); the three quality screens renamed "Check a batch or delivery" / "Quality tests" / "Quality checks for each item"; old production screens out of every menu; recipe and step editors folded under "Advanced" in Production setup; "IT and system" sub-menu for system admin and owner only; Management tagline without "HR"; every menu word equals its screen's H1 (`tests/unit/nav-titles.test.ts`, 6 listed dynamic titles); frame targets ≥44 px at 390/820/1440 for owner, manager, operator, warehouse, QA (measured); Scan in the phone top bar for every role; drawer sync status in words; record headers and `NextStep` no longer squeeze titles on phones. Owner menu 118 → 112 entries (92 unfolded); manager 109 → 98; QA 86 → 80; auditor 108 → 97. Docs: `docs/NEW_NAVIGATION.md` §2, `docs/ux-system.md` §3 | Done (round 2, part 1) |
| 2, part 2 | One "What to do next" on ~40 records (Setup details, finance documents, purchase order / request / return, quotation, receipt, delivery): forms inside the box (`src/ui/next-step-box.tsx`), one green button, "Waiting for <name> (role)" from who-can-do; big forms folded (copy a job: name only; steps version: one step open; new label: printed fields folded; reason: plain words, no raw code; receive without a purchase order: ≤5 questions, items grouped, unit and expiry from the item); recipe wizard refuses empty ingredients/steps on screens 3/4 (server already refused sending; test) and marks products that have a recipe (a drizzle sub-select compared the recipe's own id, fixed); names before codes in Home activity, Messages, Problems & alerts, Operations Center (with step now, due, recent activity) and report footnotes; purchasing access kept as the matrix says (site manager approves, purchasing raises) with refused screens naming the people who can; demo seed: one order at each send-out step and lines for older seeded deliveries; "Sales today" neutral on a day not over; operator Home one green Continue; ≈30 service errors, receipt and forecast words in plain words and old menu paths replaced (tests in `tests/unit/no-jargon-messages.test.ts`); QA queue "check again on"; returns list friendly quantity. Leftovers listed in the round 2 part 2 report | Done (round 2, part 2) |
| 3 | Re-run this audit on the live app after rounds 1–2 are deployed | Done 2026-11-01 (re-audit A: 35 of 69 rows pass, was 15; re-audit C: 62 of 130 rows pass strict, 72 with the first audit's word check) |
| 4 (Production, Quality, Maintenance) | Re-audit A fixes (ADR-105): old order view `/production/work-orders/[id]` is a redirect and "Plan the batch" works on the order page; Get materials no longer says "every line is taken" over "Not yet" lines; plain step names on the order page, banners, batch record and step 4; batch record timeline and Check quality exceptions in words (readings by label, owner override as a sentence); one green button on Get materials, Weigh (one Save with its reason), step cards, CAPA, Maintenance and the repair job; order status follows its batches ("In progress · step 6 of 7"); label panel keeps "How many?" after a first job (a different count replaces the unprinted job); closure page restricted on the server; QA test list skips batches still being made; board and plan in order words and a phone list; checker card "Check Jun's weighing" with "No, send it back"; yield one decimal; QA tab word = page title; friendly not-found for stale batch links; small fixes (complaint codes after names, deviation h1, Rejects empty state, spare-part buttons 44 px) | Done 2026-11-01 |
| 4 (Home, Setup, Finance, Reports, Settings, frame) | Re-audit C fixes (Home, Setup, Finance, Reports, Settings, frame): Home activity names problems ("The system raised a problem: Order for … · SO-…"); 44 px in-page targets (Problems & alerts chips folded on phones, Chart/Table, Sign out, stage warnings, Units Edit, retention, summaries, checkbox/radio label rows in `globals.css`); `plural()` (`src/lib/plural.ts`) replaces every "(s)" outside production/quality/maintenance (test in `tests/unit/no-jargon-messages.test.ts`; those three areas are listed in the round 4 report and excluded until their rewrite lands); dates in words in alerts and messages (`src/lib/plain-date.ts`); Problems & alerts button words from the catalogue ("Open the plan", not "Open CAPA") and one "Add a note"; demo seed: plain step names, no "(PLACEHOLDER)", the running batch's order names its operator; plain recipe list at `/masterdata/recipes` (menu "Recipes"); owner menu 103 → 73 visible entries, no empty or one-entry sub-menus, Operations row on one line at 1440; forms folded to ≤5 visible fields (Compare over time, New material, Supplier bill, Locations, Site detail teams); To approve: one green Approve; frame: site name never cut, Help "?" on every screen, labels where they fit, title → intro → buttons on phones; Operations Center stages as a connected strip. Measured with Playwright at 390/820/1440 (owner, manager, sales, finance, operator) | Done (round 4) |
| 4 (B: inventory, labels, purchasing, sales) | Two QA cages named apart ("QA waiting cage", "Stopped-by-QA cage"); boxing prints box labels in place (`/print/labels/pack/[id]`); shelf ⋯ More › Print a label; Scan look-up in use-first order with shelves; shelf names before codes on receive, counts, reservations and send-out pages; receipt problems name purchasing; one name picker on order, price offer and prices; plain plurals (`src/lib/plural.ts`), "sending-out bay", "price changed by hand", "0 %"; second check names warehouse people and reads "Sent before / Still to send"; waiting delivery shows what was taken off the shelf; supplier-return refusal names purchasing; 50 × 30 test label keeps rows above the ruler and print screens flag an old layout; supplier lot optional for packaging; seed lye lot received before use | Done 2026-11-01 |

Note: in the audit sandbox the browser received 404 for the JavaScript of pages with an id in the address
(`…/%5Bid%5D/page-….js`) while curl got 200; the cause is the sandbox's network path (it re-encodes `(app)`). Confirm on
a real phone that record pages are interactive.

## Round 3 re-audit of the live app (2026-11-01)

| Area | First audit (pass / rows) | Re-audit (pass / rows) |
|---|---|---|
| A Production, Quality, Maintenance | 15 / 69 | 35 / 69 |
| B Inventory & warehouse, Purchasing, Sales | 55 / 112 | 90 / 126 |
| C Home, Setup, Finance, Reports, Settings | 31 / 130 | 72 / 130 (62 with the stricter "(s)" word check) |

Reports: [round3/A](round3/A-production-quality-maintenance.md) · [round3/B](round3/B-inventory-purchasing-sales.md) ·
[round3/C](round3/C-home-setup-finance-settings.md). Confirmed fixed: operator tasks open only the new flow, checks on
the checker's own phone, packaging and print gate, one QA decision screen, weighing lot by scan, bar label without the
QA bar, no print station, one door per job, menu words = titles, one next step per record, 44 px frame. Round 4 fixes
the remaining items per area (old order view links, plain step names and timeline, green-button count, order status,
closure page, board; activity names, in-page tap targets, "(s)" plurals, recipe list, owner menu, site selector, help
button; shelf names before codes, box labels in place, scan order, customer picker, seed shelf names).

## End-to-end walk fixes (ADR-110, 2026-11-06)

"How work flows" (`/operations/flow`, C0) shows the 16 steps from Ask to buy to Invoice with live counts; every chain
screen ends with "Next: …" and one button (C10); purchasing and warehouse Homes have their work lists (C11, C13); the
weighing step check is reachable from Weigh and comes first on the order (C12); one approval per purchase (C15); plain
words, page titles, typed lot counts and the production order header (C14, C16–C19). Status per item:
[END_TO_END_FLOW.md](../END_TO_END_FLOW.md) section (f).

