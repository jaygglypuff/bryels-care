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
| 2 | App frame and navigation (one door per job, menu words = screen titles, 44 px targets, phone headers, Scan in the phone top bar); remaining next steps, big forms, recipe wizard validation, codes-first feeds, demo data for picking/sending out, purchasing access for the site manager | Part 1 (app frame and navigation) done 2026-10-31, see below; the rest planned |
| 2, part 1 | One door per job (To approve: top-bar button from 640 px, Home tab on phones; Problems & alerts links to it; Messages only the bell; one QA door "Check a batch or delivery"; one supplier entry; one "Expense claims"); the three quality screens renamed "Check a batch or delivery" / "Quality tests" / "Quality checks for each item"; old production screens out of every menu; recipe and step editors folded under "Advanced" in Production setup; "IT and system" sub-menu for system admin and owner only; Management tagline without "HR"; every menu word equals its screen's H1 (`tests/unit/nav-titles.test.ts`, 6 listed dynamic titles); frame targets ≥44 px at 390/820/1440 for owner, manager, operator, warehouse, QA (measured); Scan in the phone top bar for every role; drawer sync status in words; record headers and `NextStep` no longer squeeze titles on phones. Owner menu 118 → 112 entries (92 unfolded); manager 109 → 98; QA 86 → 80; auditor 108 → 97. Docs: `docs/NEW_NAVIGATION.md` §2, `docs/ux-system.md` §3 | Done (round 2, part 1) |
| 3 | Re-run this audit on the live app after rounds 1–2 are deployed | Planned |

Note: in the audit sandbox the browser received 404 for the JavaScript of pages with an id in the address
(`…/%5Bid%5D/page-….js`) while curl got 200; the cause is the sandbox's network path (it re-encodes `(app)`). Confirm on
a real phone that record pages are interactive.
