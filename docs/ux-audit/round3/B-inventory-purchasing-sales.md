# UX re-audit B: Inventory & warehouse, Purchasing, Sales (live app, 2026-11-01, after fix rounds 1–2)

Auditor: independent UX/UI re-audit, read-only. Live app: https://bryels-care-production.up.railway.app (demo, fictional data).
Baseline: `docs/ux-audit/B-inventory-purchasing-sales.md` (55 of 112 rows passed), fixes per ADR-098…103, `docs/SCAN_INPUTS.md`, `docs/LEGACY_SCREENS.md`.
Screenshots and PDFs: `/tmp/claude-0/-home-user-bryels-care/103807bc-c37f-572c-a3d5-4a6ebca2aac4/scratchpad/ux-reaudit/B/` (file name = "Shot" column + `.png`; label PDFs `w3-lbl-N.pdf`, rendered `w3-lbl-N-pdf-1.png`). Scripts and raw logs: `…/ux-reaudit/Bw/`.
Roles: warehouse.nfd (Lito, phone 390 and tablet 820), procurement (Tess, phone), manager.nfd (Dino, phone), sales (Mara, phone), owner (Ana, desktop 1440). The finance account signs in; it was not needed for this scope.

Nothing was saved, sent, approved, printed or deleted. Only "Find", "Look up", wizard "Next", menus and fold-outs were pressed. Label print pages were opened without `?auto=1` and rendered with `page.pdf()`; Print was never pressed.

## 0. Environment notes

- **The demo was reset three times while this audit ran** (record ids went `01a18d48…` → `01a19559…` → `01a19564…` → `01a1957d…`; every session was signed out each time). The start script only seeds an empty database, so someone pressed Reset. The crawler was rebuilt to sign in again and re-find record ids by name after each reset. All graded rows come from the `01a19564…` data set, which **includes the new round-2 demo data** (one order at each send-out step, purchasing and finance users, new label layouts). So almost nothing below is "needs demo reset". The exceptions are listed as such.
- Chunk 404s for `[param]` routes in this sandbox were worked around from the start (route interception rewriting `%28app%29` to `(app)` and fetching through Node). They are not counted as app defects.

## 1. Summary

| | First audit (31 Oct) | This re-audit (1 Nov) |
|---|---|---|
| Rows checked (route × role × viewport) | 112 | **126** (116 carried over, 10 new rows for screens that now have data: get from shelf, second check, ready to send out, waiting label jobs, purchasing user) |
| Rows passing all 10 criteria | 55 (49 %) | **90 (71 %)** |
| Rows failing ≥1 criterion | 57 | **36** |
| Carried-over rows: fail → pass | – | 33 |
| Carried-over rows: still fail | – | 27 |
| Carried-over rows: pass → fail (new findings) | – | 6 |
| New rows | – | 7 pass, 3 fail |

By area: Inventory & warehouse 59 rows, 38 pass / 21 fail. Purchasing 29 rows, 27 / 2. Sales & send-out 38 rows, 25 / 13.

**Verdict.** Round 1–2 fixed most of the big problems from the first audit. The print-station queue is gone from floor screens. Labels print in place with a real preview and say where they go. Record headers no longer break on phones. Scan help says where each label is stuck. Move stock finds usable lots first, with their shelves. The send-out chain can be walked and its numbers agree. Purchasing has a real purchasing user and names people. There is one green button per record.

What is left is smaller and mostly about names and codes:
- shelves shown only as codes on send-out pages;
- two different shelves both called "QA hold cage";
- the supplier's lot number is still typed;
- reservations and the count sheet still lead with codes;
- name pickers still use a search box plus a dropdown.

Small new bugs: "12 pcs pcs", the label guide pointing to a shelf menu entry that does not exist, and second-check wording.

### Explicit answers

1. **Is any "print station" left for floor users?** **Not on any floor screen that was opened.**
   - `/labels` is now "Labels printed" (history plus a guide).
   - Lot and box labels (`/labels/new`) show the label, name the printer in plain words ("Label printer, Warehouse 1 · label 100 × 50 mm. In the print window choose this printer and Actual size") and have one "Print N labels".
   - The old `/print/lot-label/receipt/<gr>` page no longer has a "Print station" button.
   - One leftover in code that could not be seen live (no open boxing job after the resets): boxing (`/warehouse/packs/[packId]`) still answers "**Label sent to the print station.**" after "Pack box and print label", and "**N label(s) sent to the print station**" after "Make the missing box labels" (`src/app/(app)/sales/fulfilment-actions.ts:327,358`). Its Box labels card then sends people to "Print the box labels (not printed yet)" → `/labels?show=not_printed`. That is a queue-then-print step, not print-in-place (`src/app/(app)/warehouse/packs/[packId]/page.tsx:133-143`).
   - Admin "print stations" settings remain (admin only, acceptable).
2. **Does each label screen say which label goes where and how to scan it?** **Yes, with one gap.**
   - `/labels` and `/labels/new` (no record) show "Which label goes where?" with Print / Stick / Scan for the sack, product, box, shelf and lot labels.
   - The lot label says "Stick one on each tub or bucket … Scan the square code when you take the tub for the next step".
   - The box label says "Stick it on the side of the box … when you move, pick or ship the box".
   - The delivery labels say "Stick one on each sack or drum … at put-away and when you take the sack for a batch".
   - Scan › "Where is the label?" lists sacks, boxes, shelves and papers.
   - **Gap:** the guide says shelf labels print from "On the shelf: ⋯ More › Print a label", but the shelf page's ⋯ More has only "All shelves" and "This shelf in the stock list" (shot `w3-06-shelf-more`). A shelf label can only be reached by scanning the shelf and using the Scan card. Minor wording differences: the guide says "on the side of the box", Scan help says "on the short side".
3. **Does any field still ask to type a code?** **Yes, the supplier's lot number, plus two search boxes.**
   - "Supplier's lot number" is typed on Receive (with and without a purchase order) and "Supplier's code on the sack" on Fix details. These are kept on purpose as an external code (A-SCAN-14, owner decision pending); no photo or scan option yet.
   - The "Boxes and sacks" search is still "Box or lot number from the label" (a list filter).
   - The purchasing user's Home Scan tile still says "Scan a label, or type the number printed on it".
   - Every field that identifies a lot, box or shelf on the screens walked (Move, Fix stock, Pack into a box, Repack, Count) uses tap / scan / find-by-name. Second check and label verification are scan-only.

## 2. First-audit findings: status

### Top 10 problems of the first audit

| # | First-audit problem | Status | Evidence now |
|---|---|---|---|
| 1 | Labels go to a "label print station"; phone does not say which label goes where | **FIXED** (one code leftover, see §1 answer 1) | `/labels` = "Labels printed" + guide; `/labels/new` one "Print 1 label", printer in plain words; old receipt page has no Print station (shots `wh-p-labels`, `w3-03-print-a-label`, `wh-p-old-receipt-labels`) |
| 2 | Real labels cut off / overlapping, lot code biggest, "QUARANTINE" | **MOSTLY FIXED** | 100×50 raw-material, box, finished goods, intermediate and 70×40 product layouts are clean, name largest, one page at true size (`w3-lbl-5-pdf-1`, `w3-lbl-1-pdf-1`, `w3-lbl-7-pdf-1`). **Still open:** 50×30 "Qty" row runs under the test ruler (`w3-lbl-6-pdf-1`); the raw-material label of a real delivery still prints "QUARANTINE at print" with layout `LBL-RM v1` (QA must approve a v2 version, A-LBL-02) |
| 3 | Receiving forms too long, codes, migration reasons, spare parts, unit "—", "QUA-01 … PKG-01" | **MOSTLY FIXED** | With PO: 5 questions, shelf names. Without PO: 3 questions first, plain reasons, items grouped with spare parts apart, unit from the item. **Still open:** supplier lot typed; 1825-day expiry pre-filled for cartons (hint says change it; QA decision A-R2P2-01); sticky save bar (2-line button) + tab bar ≈ 22 % of a 390×844 screen. **NEW:** "where it goes" list shows "QA hold cage" twice |
| 4 | Record headers break mid-word on 390 px | **FIXED** | Name is the title, code in a grey line above; buttons on their own row (`top-wh-p-receipt-detail`, `top-sa-p-order-detail`, `wh-p-shipment-detail`) |
| 5 | Get from shelf → second check → send out not walkable; "0 box(es) · 0 pcs"; second check contradicts itself | **FIXED** | Demo has one order to get from shelf, two finished picks, one delivery waiting for the second check, one ready to send out; rows read "1 box · 12 pcs", "192 pcs"; sent-out second check says "Already sent out … The second check was done before it left" |
| 6 | Lot search by name ends in code comparison; expired first; no shelf; put-away lists every lot | **FIXED for Move**; put-away **needs demo data**; Scan **STILL OPEN** | Move: "10 found", usable first, each "16.268 kg on Oils rack A-01 · use by 07 Nov 2027 · lot …" (`w6-02-move-find-coconut`). Put away was empty in every data set (nothing approved and still in the QA area), so the finder could not be tried. Scan search for "coconut oil" still lists the **rejected, expired** lot first and shows no shelf (`w9-01-scan-coconut`) |
| 7 | Scan invites typing numbers, no label locations | **FIXED** | "Scan the label, or type what it is", placeholder "e.g. coconut oil", "Where is the label?", camera fallback "type what it is (for example coconut oil)" (`w4-03`, `w4-04`) |
| 8 | Purchasing blocked for the site manager; wrong message; no purchasing user | **FIXED** | Tess Navarro (purchasing) exists; manager refused screens name who can ("Ask Tess Navarro (Procurement)"); drafts say "Waiting for Tess Navarro". Minor: supplier-return refusal lists Lito, Nina, Teresa but not Tess |
| 9 | Jargon on Home and records | **MOSTLY FIXED** | Home tile, "Not finished/Saved to stock", forecast words, printer "(203 dpi, demo)", "Quarantine cage" all fixed. **Still:** "dispatch bay" (section line), "(price typed by hand)", "(s)" plurals on purchasing Home/suppliers, performance "0.0 %" |
| 10 | Two green buttons / same action twice; "6.000000" | **FIXED** | One green on PO draft, request, supplier return, quotation waiting, receipt saved, label request; returns list "1 item, 6 pcs" |

### First-audit fix list (19 items)

| # | Fix | Status | Notes |
|---|---|---|---|
| 1 | Print here as the one button; no desk queue; drop "print station" | FIXED on floor screens; **STILL OPEN** in boxing messages | `fulfilment-actions.ts:327,358`; boxing card → "Not printed yet" list |
| 2 | Retire `/print/lot-label/receipt/[grId]`; Scan card links to `/labels/new` | FIXED | Old page is now the ADR-099 fallback (preview, size, how many); `src/modules/scan/card.ts:181` links `/labels/new` |
| 3 | Fix label layouts; name first; replace "QUARANTINE" | PARTLY | 100×50 fixed; 50×30 test overlap; "QUARANTINE" awaits QA approval of v2 layout |
| 4 | Record header and NextStep on phones | FIXED | |
| 5 | Receive form short, shelf names, defaults, plain reasons | MOSTLY FIXED | supplier lot typed (owner), carton expiry default (QA), sticky bar height |
| 6 | Receipt state words; damaged wording; one green | MOSTLY FIXED | "Damaged: waiting for purchasing to accept it" names nobody; "(SUP-0006)", "at RCV (Receiving dock)", "at QUA-01 (QA hold cage)" still code first (`src/app/(app)/inventory/receive/[grId]/page.tsx:270`) |
| 7 | Lot search: shelf + use-first; hide expired; put-away only waiting lots | FIXED (Move); not verifiable (Put away); STILL OPEN (Scan search order) | |
| 8 | Scan wording + label picture | FIXED (text, no picture) | A small picture of the three labels was suggested; text list is adequate |
| 9 | Warehouse Home tile words | FIXED | |
| 10 | Dispatch/shipments counts; second check of sent-out delivery | FIXED | |
| 11 | Customer returns quantity | FIXED | |
| 12 | Purchasing access message; purchasing user | FIXED | minor: return refusal omits Tess |
| 13 | PO wizard default to minimum; warn below | FIXED (default 50 kg) | below-minimum warning not re-tested (would need typing a lower amount) |
| 14 | One green button per record | FIXED | |
| 15 | Names before codes (reservations, label verification, supplier return, count sheet) | PARTLY | label verification and supplier return fixed; **reservations and count sheet still code-first** |
| 16 | `/labels/new` without a lot | FIXED | |
| 17 | Single name picker | **STILL OPEN** | `/sales/new`, `/sales/quotations/new` (ADR-103 lists it as open) |
| 18 | Words and seed shelf names | MOSTLY FIXED | "QA hold cage" now used for two different places (NEW N1); "(price typed by hand)", "(s)", "0.0 %" remain |
| 19 | Chunk 404 check on a real phone | Not re-tested | worked around in the sandbox; still worth one real-phone check |

### New findings (this re-audit)

| # | Finding | Where | Severity |
|---|---|---|---|
| N1 | **Two shelves are both called "QA hold cage"**: `QUA-01` (waiting for QA) and `HLD-01` (stopped by QA). The receive form's "where it goes" list shows "QA hold cage" twice with nothing else to tell them apart. The count plan and label verification only differ by code. | `src/db/seed.ts:73` and `:82` (rename e.g. HLD-01 "Stopped-by-QA cage"; the live DB needs the same rename) | High (wrong place chosen) |
| N2 | **The label guide sends people to a menu entry that does not exist**: "Shelf label · Print: On the shelf: ⋯ More › Print a label". The shelf page's ⋯ More has only "All shelves" and "This shelf in the stock list". | `src/app/(app)/inventory/locations/[id]/page.tsx:38-44` (add Print a label → `/labels/new?entityType=location&entityId=`), `src/ui/labels/label-guide.tsx:9` | Medium |
| N3 | Shelves shown only as codes on send-out pages: "Shelf FG-01 · Finished goods bay" (order), "from shelf SHP" / "from shelf FG-01" (delivery), "Shelf FG-01" (get from shelf), "shelf FG-01" (second check). | `src/app/(app)/sales/[orderId]/page.tsx`, `sales/shipments/[shipmentId]/page.tsx`, `sales/picking/[pickId]/page.tsx`, `sales/packing/[shipmentId]/page.tsx` | Medium |
| N4 | "1 box · **12 pcs pcs**" on Boxing jobs. | `src/app/(app)/warehouse/packs/page.tsx:86-87` (`fmtQty(…,"pcs")` already adds the unit, then a literal " pcs") | Low |
| N5 | Second check waiting line: "Waiting for Ana Villanueva (Owner/Director), Dino Reyes (Site Manager) or **another production operator**" (this is a warehouse check). "Taken off the shelf 12 pcs · sent before 0 pcs · still to send after this 12 pcs" is hard to read. The set-aside order also names the owner and manager before "another warehouse operator", not Lito. | `src/app/(app)/waiting-for.ts`, `src/app/(app)/sales/packing/[shipmentId]/page.tsx` | Low |
| N6 | A delivery waiting for the second check says "In this delivery · Nothing on it yet" while 12 pcs were taken off the shelf. | `src/app/(app)/sales/delivery-words.ts:10` used on the delivery page | Low |
| N7 | Seed data: the 33.33 % lye lot (received 26 Oct) is used on 14 and 21 Oct, so its History shows "left -4.96 kg", "left -9.92 kg". | `src/db/seed.ts` (lye lot dates / consumption) | Low (demo credibility) |
| N8 | Scan search orders lots with the rejected, expired lot first, without its shelf. Move stock's finder does it right. | `src/modules/inventory/lookup.ts` (search lot ordering) | Medium |
| N9 | Boxing still queues labels "to the print station" (see §1). | `src/app/(app)/sales/fulfilment-actions.ts:327,358`; `src/app/(app)/warehouse/packs/[packId]/page.tsx:93,133-143` (also "Label layout" shows the template code; card text "BC:BOX, SKU, lot…") | Medium (not visible without a boxing job) |
| N10 | Get-from-shelf next step button says "Open the shipment"; everywhere else the word is "delivery". | `src/app/(app)/sales/picking/[pickId]/page.tsx` | Low |
| N11 | The supplier-return refusal for the site manager names Lito Pascual and two QA people but not Tess Navarro (purchasing), who can open the form. | who-can-do directory for `/procurement/returns/new` | Low |


## 3. Screen table

Legend: ✓ meets · ✗ fails · – not applicable. Criteria: 1 intro sentence · 2 one next step / waiting for · 3 ≤5 visible fields · 4 never type a code · 5 grade-5 words · 6 names before codes, units · 7 phone fit and ≥44 px · 8 empty/error states · 9 consistency · 10 no old screen reached. Vp: P = 390×844, T = 820×1180, D = 1440×900. "Was" = result in the first audit.

### Inventory & warehouse

| Route | Role | Vp | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Was | Note | Shot |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/dashboard` (warehouse Home) | warehouse | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: tile now "Send out orders · orders with stock set aside, ready to get from the shelf". | wh-p-home |
| `/dashboard` | warehouse | T | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Same, with plain tile hints. | wh-t-home |
| `/inventory` | warehouse | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | wh-p-inventory |
| `/inventory` | owner | D | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | ow-d-inventory |
| `/inventory/lots` | warehouse | P | – | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass | Redirects to /inventory. | wh-p-lots-redirect |
| `/inventory/[lotId]` | warehouse | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass | Shelf line repeats the code ("Actives shelf B-01 B-01"), cosmetic. | wh-p-lot |
| `/inventory/[lotId]` | owner | D | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | ow-d-lot |
| `/inventory/[lotId]/move` → `/inventory/move?lot=` | warehouse | P | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Redirect works; 3 inputs; shelves by name ("QA hold cage" replaces "Quarantine cage"). | wh-p-lot-move |
| `/inventory/stock-card/[lotId]` | warehouse | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | pass | NEW (data): seeded lot was used on 14 and 21 Oct but received 26 Oct, so the running balance shows "left -4.96 kg", "-9.92 kg". | wh-p-stockcard |
| `/inventory/lots/[lotId]/edit` | warehouse | P | ✓ | – | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | "Supplier's code on the sack" still typed (A-SCAN-14 exception awaiting owner). | wh-p-lot-edit |
| `/inventory/items/[kind]/[id]` | warehouse | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | wh-p-item |
| `/inventory/scan` | warehouse | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: "Scan the label, or type what it is", placeholder "e.g. coconut oil", "Where is the label?" lists sack/box/shelf/paper, camera fallback says type the name. | wh-p-scan, w4-03-scan-where-label, w4-04-scan-camera-fallback |
| `/inventory/receive` (choose delivery) | warehouse | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: no lone sub-menu pill. | wh-p-receive, w1-01-receive-chooser |
| `/inventory/receive?po=…` | warehouse | P | ✓ | – | ✓ | ✗ | ✓ | – | ✗ | ✓ | ✗ | ✓ | fail | Now 5 questions and shelf names ("Goes to QA hold cage … then Packaging shelf"). Still: supplier lot typed; sticky save bar (2-line button) + tab bar ≈ 22 % of the screen; NEW: "Where it goes" list shows "QA hold cage" twice. | w1-02-receive-with-po, w1-02b-receive-po-viewport |
| `/inventory/receive?po=…` | warehouse | T | ✓ | – | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | fail | Same (no space problem at 820). | wh-t-receive-po |
| `/inventory/receive?nopo=1` | warehouse | P | ✓ | – | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: 3 questions first, plain reasons (no migration words), items grouped with spare parts apart, unit from the item. Supplier lot still typed once an item is chosen. | w2-01-receive-nopo |
| `/inventory/receive/[grId]` (not finished) | warehouse | P | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | fail | Fixed header and words ("Not finished / Saved to stock"). Still: "Damaged: waiting for purchasing to accept it" names nobody; "Bukidnon Aloe Farms (SUP-0006)", "at RCV (Receiving dock)". | wh-p-receipt-detail |
| `/inventory/receive/[grId]` (not finished) | warehouse | T | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | fail | Same words. | wh-t-receipt-draft |
| `/inventory/receive/[grId]` (saved) | owner | D | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: one green "Print labels (1)". Still "at QUA-01 (QA hold cage)", "(SUP-0005)". | ow-d-receipt-posted, w3-04-posted-receipt |
| `/inventory/receive/[grId]/edit` | owner | D | ✓ | – | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | fail | 16 inputs; supplier shown as "SUP-0006". | ow-d-receipt-edit |
| `/inventory/receive/put-away` | warehouse | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Empty state good. The lot finder could not be exercised: no lot waits for put-away after any of the three resets (needs demo data). | wh-p-putaway |
| `/inventory/receipts` | warehouse | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | wh-p-receipts |
| `/inventory/receipts` | owner | D | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | ow-d-receipts |
| `/inventory/move` | warehouse | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: "coconut" finds 10 lots, usable first, each with amount, shelf name, use-by and lot. | wh-p-move, w6-02-move-find-coconut, w6-03-move-step2 |
| `/inventory/move` | warehouse | T | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail |  | wh-t-move |
| `/inventory/movements` | warehouse | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed shelf names. A stored note still says "to quarantine pen" (owner view). | wh-p-movements |
| `/inventory/movements/[id]` | warehouse | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail |  | wh-p-movement-detail |
| `/inventory/counts` | warehouse | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | wh-p-counts |
| `/inventory/counts?new=1` (plan) | warehouse | P | ✓ | – | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | fail | Still 12 shelf ticks + 5 people; NEW: two shelves called "QA hold cage" (HLD-01, QUA-01). | wh-p-count-plan |
| `/inventory/counts/[id]` | warehouse | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass | "0 of 0 counted" now explained ("list is made when the count starts"). | wh-p-count-detail, w7-01-count |
| `/inventory/counts/[id]` | warehouse | T | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | wh-t-count |
| `/inventory/counts/[id]/sheet` | warehouse | P | ✓ | – | – | – | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | fail | Still "Count sheet CNT-26-0001"; shelf headings "B-01 · Actives shelf B-01" code first. | wh-p-count-sheet |
| `/inventory/adjustments` | warehouse | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | wh-p-adjustments |
| `/inventory/adjustments/new` | warehouse | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | wh-p-adjust-new, w8-01-fix-stock-new |
| `/inventory/adjustments/[id]` | warehouse | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass | "Waiting for a site manager" (no name; polish). | wh-p-adjust-detail |
| `/inventory/availability` | warehouse | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | wh-p-availability |
| `/inventory/lots/expiry` | warehouse | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | wh-p-expiry |
| `/inventory/lots/reservations` | warehouse | P | ✓ | – | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | fail | Still "6% Green in Oil for WO-26-00003 · MAT-0051", "RSV-26-000012". | wh-p-reservations |
| `/inventory/containers` | warehouse | P | ✓ | – | – | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Search still "Box or lot number from the label" (typed code; list filter). | wh-p-containers |
| `/inventory/containers/new` | warehouse | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | wh-p-container-new |
| `/inventory/containers/[id]` | warehouse | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | wh-p-container-detail |
| `/inventory/locations` | warehouse | P | ✓ | – | – | – | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | "Quarantine cage" gone; "Receiving dock, dispatch bay and other places" still in a section line. | wh-p-locations |
| `/inventory/locations/[id]` | warehouse | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | pass | NEW: the label guide says shelf labels print from "⋯ More › Print a label" on the shelf; the shelf's ⋯ More has only "All shelves" and "This shelf in the stock list". | wh-p-location-detail, w3-06-shelf-more |
| `/inventory/wip` | warehouse | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | wh-p-wip |
| `/labels` | warehouse | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: "Labels printed" (history) + "Which label goes where?" (print / stick / scan per label). | wh-p-labels |
| `/labels` | warehouse | T | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail |  | wh-t-labels |
| `/labels/new?entityType=inventory_lot&…` | warehouse | P | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: true preview, "Stick one on each tub", "Scan the square code when…", printer named in plain words, one green "Print 1 label". | wh-p-labels-new-lot, w3-03-print-a-label |
| `/labels/new?entityType=container&…` (via `/print/box-label/[id]`) | warehouse | P | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Old box-label URL redirects here. Name largest; "BX-…" no longer the headline; no "BC:BOX" text. | wh-p-box-label |
| `/labels/new` (no record) | warehouse/owner | P/D | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: explains where labels are printed + label guide + "Scan or find it". | wh-p-labels-new, ow-d-labels-new-noparam |
| `/print/lot-label/[lotId]` (old URL) | warehouse | P | – | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Redirects to /labels/new; the Scan card now links there directly. | wh-p-old-lot-label |
| `/print/lot-label/receipt/[grId]` | warehouse | P | ✓ | – | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Now the ADR-099 fallback "Labels for this delivery" (preview, size, how many, no print station). The raw-material label still prints "QUARANTINE" (layout v1 awaiting QA, A-LBL-02). | wh-p-old-receipt-labels |
| `/print/labels/test/[id]` (8 layouts, PDF) | owner | D | ✓ | – | – | – | ✓ | ✓ | ✗ | – | ✓ | ✓ | fail | 100×50 layouts clean: name largest, QR inside, nothing cut, one page at true size. 50×30: the "Qty" row still runs under the test ruler. | w3-lbl-1…8-screen, w3-lbl-5-pdf-1, w3-lbl-6-pdf-1, w3-lbl-1-pdf-1, w3-lbl-7-pdf-1 |
| `/warehouse` | warehouse | P | ✓ | ✓ | – | – | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | No longer duplicates Home ("jobs of the day are on Home"). "dispatch bay" in Other areas. | wh-p-warehouse |
| `/warehouse` | owner | D | ✓ | ✓ | – | – | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | fail |  | ow-d-warehouse |
| `/warehouse/packs` | warehouse | P | ✓ | – | – | – | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | pass | NEW: "1 box · 12 pcs pcs" (unit twice). | wh-p-packs, w12-03-packs |
| `/warehouse/repack` | warehouse | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | wh-p-repack |
| `/quality/label-verification` | warehouse | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | fail | Fixed: shelf names first. NEW: two areas named "QA hold cage" differ only by code. | wh-p-label-verification |
| `/production/staging` | owner | D | – | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: redirects to production orders. | ow-d-old-staging, wh-p-old-staging |
| `/labels?show=not_printed` | warehouse | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | new row | "Nothing waiting". Rows open the print page, not a desk queue. | wh-p-labels-notprinted |

### Purchasing

| Route | Role | Vp | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Was | Note | Shot |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/procurement` | purchasing | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass | "send 1 approved purchase order(s)" ((s) polish). | pu-p-home |
| `/procurement` | manager | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | mg-p-procurement |
| `/procurement` | owner | D | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | ow-d-procurement |
| `/procurement/requests` | purchasing | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | pu-p-requests |
| `/procurement/requests/[id]` | purchasing | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | "Waiting for Ana Villanueva or Dino Reyes to approve it". | pu-p-request-detail |
| `/procurement/requests/[id]` | manager | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: one green "Approve" + Send back + Say no in the box. | mg-p-request-detail |
| `/procurement/requests/new` | purchasing | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass | Unit select still announced as "lines.0.uom". | pu-p-request-new |
| `/procurement/orders` | purchasing | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | pu-p-orders |
| `/procurement/orders` | owner | D | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | ow-d-po-list |
| `/procurement/orders/[id]` (draft) | purchasing | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: one "Send for approval". | pu-p-order-detail |
| `/procurement/orders/[id]` (draft) | manager | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: "Waiting for Tess Navarro (Procurement)". | mg-p-order-detail |
| `/procurement/orders/[id]` (draft) | owner | D | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: one green. | ow-d-po-detail |
| `/procurement/orders/[id]` (waiting) | manager | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | new row | "Approve (step 1)" one green. | mg-p-order-submitted |
| `/procurement/orders/[id]` (sent) | owner | D | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | ow-d-po-detail2 |
| `/procurement/orders/new` | manager | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: "Ask Tess Navarro (Procurement) to do it". | mg-p-order-new |
| `/procurement/orders/new` (4 steps) | purchasing | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: amount starts at the 50 kg minimum. Item shows "Coconut Oil (Isla Gold (fictional))". | p2-01-supplier … p2-04-check |
| `/procurement/expected` | purchasing | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: "Other purchasing screens" (no sales/operations tab row). | pu-p-expected |
| `/procurement/expected/[poId]` | owner | D | – | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass | Rows link straight to Receive with the order (redirect kept). | links |
| `/procurement/returns` | purchasing | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | pu-p-returns |
| `/procurement/returns/[id]` | purchasing | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: "8 kg from Rejected goods cage", waiting names people. | pu-p-return-detail |
| `/procurement/returns/[id]` | manager | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: one green "Approve", text no longer squeezed. | mg-p-return-detail |
| `/procurement/returns/new` | manager | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | fail | Refusal now names people, but lists Lito, Nina and Teresa, not Tess Navarro (purchasing), who can open it. | mg-p-return-new |
| `/procurement/returns/new` | purchasing | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | new row | Supplier by name. | pu-p-return-new, p3-return-new |
| `/procurement/returns/new` | owner | D | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | ow-d-supret-new |
| `/procurement/suppliers` | purchasing | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | pu-p-suppliers |
| `/procurement/suppliers/[id]` | purchasing | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: "Nothing may be bought from this supplier yet" + "Suggest an item". | pu-p-supplier-detail |
| `/procurement/reorder` | purchasing | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | pu-p-reorder |
| `/procurement/performance` | purchasing | P | ✓ | – | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Still "0.0 %", "1.0 / 10.0", "100.0 %". | pu-p-performance |
| `/procurement/forecast` | purchasing | P | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: "Not enough sales history yet", "a sales guess is an estimate". | pu-p-forecast |

### Sales & send-out

| Route | Role | Vp | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Was | Note | Shot |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/dashboard` (sales Home) | sales | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | sa-p-home |
| `/sales` | sales | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | sa-p-orders |
| `/sales` | owner | D | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | ow-d-sales |
| `/sales/[orderId]` (set aside) | sales | P | ✓ | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | fail | Fixed header (name is the title, code in the grey line). Still "Shelf FG-01 · Finished goods bay" (code first) and "(price typed by hand)". | sa-p-order-detail |
| `/sales/[orderId]` (confirmed) | sales | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | new row | One green "Set aside the stock". | sa-p-order-confirmed |
| `/sales/[orderId]` (draft) | sales | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | new row |  | sa-p-order-draft |
| `/sales/[orderId]` (set aside / draft) | owner | D | ✓ | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | pass | Same shelf line as on the phone. | ow-d-so-detail, ow-d-so-draft |
| `/sales/board` | sales | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass | "Move to… Waiting for approval: Send: credit and approval check" reads oddly. | sa-p-board |
| `/sales/customers` | sales | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass | Filter selects still unlabelled ("status", "segment"). | sa-p-customers |
| `/sales/customers?c=…` | sales | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | sa-p-customers-split |
| `/sales/customers/[id]` | sales | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | sa-p-customer-detail |
| `/sales/customers/new` | sales | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass | 4 fields. Model screen. | sa-p-customer-new, s1-customer-new |
| `/sales/new` (3 steps) | sales | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | fail | Still a search box plus a dropdown for one choice (typing filters the dropdown). | sa-p-order-new, s2-01, s2-02 |
| `/sales/orders/[orderId]/edit` | owner | D | ✓ | – | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | fail | 8 inputs; "Acapulco Soap 135 g (40 in stock)" while Can we deliver? shows 7,131 pcs free. | ow-d-so-edit |
| `/sales/quotations` | sales | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | sa-p-quotes |
| `/sales/quotations/[id]` (sent) | sales | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | sa-p-quote-detail |
| `/sales/quotations/[id]` (waiting) | owner | D | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: one green "Approve discount". | ow-d-quote-detail |
| `/sales/quotations/new` | sales | P | ✓ | – | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | fail | Still 6 inputs and the two-control customer picker. | sa-p-quote-new, s3-quote-new |
| `/sales/quotations/[id]/edit` | owner | D | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | ow-d-quote-edit |
| `/sales/price-lists` | sales | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | sa-p-prices |
| `/sales/price-lists/[id]` | sales | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass | "or another finance to approve" (grammar). | sa-p-price-detail |
| `/sales/price-lists/new` | sales | P | ✓ | – | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | 6 inputs incl. tick box. | sa-p-price-new |
| `/sales/price-lists/[id]/edit` | owner | D | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | ow-d-price-edit |
| `/sales/returns` | sales | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: "1 item, 6 pcs". | sa-p-returns |
| `/sales/returns/[returnId]` | sales | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | sa-p-return-detail |
| `/sales/returns/new` | sales | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass |  | sa-p-return-new |
| `/sales/shipments` | sales | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | fail | Fixed counts ("1 box · 12 pcs", "192 pcs"). Still opens under the Operations tab row (Operations Center, Production orders) for the sales user. | sa-p-shipments-all |
| `/sales/shipments` | warehouse | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | new row |  | wh-p-shipments |
| `/sales/shipments/[id]` (sent out) | warehouse | P | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: title no longer broken. Lines say "from shelf SHP" (code only). | wh-p-shipment-detail |
| `/sales/shipments/[id]` (sent out) | warehouse | T | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | pass | Same shelf code. | wh-t-shipment |
| `/sales/shipments/[id]` (ready to send out) | warehouse/owner | P/D | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | pass | One green "Send out now", 3 fields. "from shelf FG-01" code only. | wh-p-shipment-open, ow-d-shipment-open |
| `/sales/shipments/[id]` (waiting for second check) | warehouse | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | new row | NEW: "In this delivery · Nothing on it yet" while 12 pcs were taken off the shelf. | wh-p-shipment-check |
| `/sales/picking` | warehouse | P | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pass | Now has a real order to get (Isla Spa Supplies). | wh-p-picking, w10-01-picking |
| `/sales/picking/[pickId]` (done) | warehouse | P | ✓ | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | new row | "Shelf FG-01" code only; next step button says "Open the shipment" (everywhere else "delivery"). | wh-p-pick-1, wh-p-pick-2, w10-02-pick |
| `/sales/dispatch` | warehouse | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: "12 delivery receipts", "1 box · 12 pcs", ready / second check / proof sections filled. | wh-p-dispatch, w12-01-dispatch |
| `/sales/dispatch` | warehouse | T | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | new row |  | wh-t-dispatch |
| `/sales/packing/[id]` (already sent) | warehouse | P | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fail | Fixed: "Already sent out on 27 Oct… The second check was done before it left." | wh-p-packing |
| `/sales/packing/[id]` (waiting) | warehouse | P | ✓ | ✓ | – | – | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | new row | Waiting for "Ana…, Dino… or another production operator" (wrong role word for a warehouse check); "sent before 0 pcs · still to send after this 12 pcs"; "shelf FG-01" code only. | wh-p-packing-open, w11-01-second-check |

## 4. Walkthrough log

### Warehouse on a phone (Lito, 390×844)

| # | Task | Screens reached | Result |
|---|---|---|---|
| W1 | Receive with a purchase order | Home → Receive tile → `/inventory/receive` → tap "Manila Print & Pack" → `?po=…` (stopped before "Save and print labels") | 2 taps to the form. 5 questions; destination in names ("Goes to QA hold cage until QA says OK, then to Packaging (Packaging shelf)"). Still typed: supplier's lot number. Carton expiry pre-filled +1825 days with a "change it to the date on the label" hint. The "where it goes" list (More details) shows "QA hold cage" twice. The sticky bar has a two-line green button. |
| W2 | Receive without a purchase order | `/inventory/receive` → "No purchase order (urgent buy)" → `?nopo=1` | Fixed. Supplier, paper number, item; plain reasons (no migration words); items grouped, spare parts apart; unit filled from the item. A first-timer can finish it. |
| W3 | Label preview (no print) | Lot → ⋯ More → Print a label → `/labels/new?entityType=inventory_lot…`; box via `/print/box-label/<box>` → `/labels/new?entityType=container…`; saved delivery → "Print labels (1)" (not pressed); fallback `/print/lot-label/receipt/<gr>`; test pages of all 8 approved layouts as PDF | The preview is the label. It says where to stick and when to scan, names the printer, and has one "Print 1 label". The PDFs are one page each at the true size (283×142 pt = 100×50 mm; 142×85 pt = 50×30 mm; 198×113 pt = 70×40 mm). 100×50 and 70×40 are clean. 50×30 still collides with the test ruler. A real delivery label still says "QUARANTINE". The real job print page `/print/labels/<job>` could not be opened: the one waiting job vanished in a demo reset, and making one would mean pressing Print. |
| W4 | Which label goes where; how to scan | `/labels`, `/labels/new`, Scan › "Where is the label?" | Clear for sack, product, box and lot labels. The shelf-label instruction points to a menu entry that does not exist (N2). |
| W5 | Put away | Home → Put away (0) | "Nothing to put away", with a good explanation. No lot waited in any of the data sets, so the finder could not be tried (**needs demo data**: a lot that QA said OK and is still in the QA cage). |
| W6 | Move | Inventory › Move stock → "coconut" → Find → first row → step 2/3 (stopped before Confirm) | Fixed. Usable lots first, each with amount, shelf name, use-by and lot; the destination shelves are by name. |
| W7 | Count | Counts → open count (stopped before "Start count") | Clear; "0 of 0 counted" is now explained. Planning is still 17 ticks. |
| W8 | Fix stock | `/inventory/adjustments/new` | Good: 3 questions; scan or find the lot by name; "Send to manager". |
| W9 | Find a lot by name | Scan → "coconut oil" → Look up | Works and shows status words. The rejected, expired lot is listed first and lot rows have no shelf (N8). |
| W10 | Get from shelf | Home "Send out orders (1)" → `/sales/picking` → finished picks | One order is ready to get (Isla Spa Supplies); the finished picks show 12 of 12 with ✓. Shelf shown as "FG-01" only. "Open the shipment" wording. |
| W11 | Second check | `/sales/packing/<waiting>` | Correctly refuses Lito ("You took these off the shelf, so someone else does the second check") and names who can; "another production operator" is the wrong role word. Scan-only (cannot tap). |
| W12 | Send out | `/sales/dispatch` → ready delivery (stopped before "Send out now") | Fixed. Sections are ready (1), second check (1) and proof (13); counts are right; driver, plate and who delivers; one green button. |

### Purchasing

| # | Task | Screens | Result |
|---|---|---|---|
| P1 | Request to buy (purchasing) | `/procurement/requests/new` | 5 fields; item by name; unit by default. Not saved. Unit select still announced as "lines.0.uom". |
| P2 | Purchase order wizard (purchasing, phone) | 1 supplier (tap "Laguna Oleo Supply") → 2 items (Coconut Oil, **50 kg default = the minimum**, "about ₱9,250.00") → 3 when (+7 days) → 4 check (stopped before "Save and send for approval") | Fixed. The step-4 text explains who approves. |
| P2b | Purchase order (site manager) | `/procurement/orders/new` | Refused in plain words: "Ask Tess Navarro (Procurement) to do it, or to give you access." Approvals work from the record: one green "Approve (step 1)". |

### Sales (Mara, phone)

| # | Task | Screens | Result |
|---|---|---|---|
| S1 | New customer | `/sales/customers/new` | 4 fields; the system gives the number. Not saved. |
| S2 | New customer order | `/sales/new` → type "isla" (filters the dropdown to Isla Spa Supplies, shows the address and "Wants at least 180 days before expiry") | Smooth, but still two controls (search box plus dropdown) for one choice. Not saved. |
| S3 | Price offer | `/sales/quotations/new` | 6 visible inputs and the same two-control picker. Not saved. |

### Owner (desktop 1440)

All 41 owner rows open without layout breakage. One green per record. The old staging screen redirects to production orders.

## 5. Old or superseded screens still reachable

| Screen | Now | Verdict |
|---|---|---|
| `/print/lot-label/receipt/<grId>` | "Labels for this delivery": preview, label size, how many per lot; "Back to the delivery"; no app menu, no "Print station" | Acceptable as the ADR-099 fallback (linked from `src/app/(app)/labels/receipt-print.ts:16,33`) |
| `/print/lot-label/<lotId>` | Redirects to `/labels/new?entityType=inventory_lot…` | OK |
| `/print/box-label/<containerId>` | Redirects to `/labels/new?entityType=container…`; Box page "Print box label" still links the old URL (`src/modules/inventory/containers.ts:546`) | OK (redirect), tidy the link |
| `/labels` as print-station queue | Now "Labels printed"; "Not printed yet" rows open the in-place print page | OK |
| `/labels/new` without parameters | Explains where labels are printed, guide, "Scan or find it" | OK |
| `/production/staging` | Redirects to production orders | OK |
| `/inventory/[lotId]/move` | Redirects to `/inventory/move?lot=` | OK |
| Text "print station" | Still in boxing messages (`src/app/(app)/sales/fulfilment-actions.ts:327,358`) | **Still open** |

## 6. Ranked remaining fix list

| Rank | What | Where | Owner/QA input |
|---|---|---|---|
| 1 | Give the two "QA hold cage" places different names (e.g. QUA-01 "QA waiting cage", HLD-01 "Stopped-by-QA cage") in the seed **and** on the live database (it is location data). Until then, show the code or status next to the name in every shelf picker. | `src/db/seed.ts:73,82,84`; receive "where it goes" select in `src/app/(app)/inventory/receive/receive-form.tsx` (~line 488) | Owner (shelf names, A-G5-I1) |
| 2 | Boxing: print box labels in place (the ADR-099 label panel) instead of "sent to the print station" + "Not printed yet". Replace the card text "BC:BOX, SKU, lot…" and the "Label layout" code with plain words. | `src/app/(app)/sales/fulfilment-actions.ts:327,358`; `src/app/(app)/warehouse/packs/[packId]/page.tsx:93,101-143` | – |
| 3 | Shelf names before codes on send-out pages ("Finished goods bay (FG-01)", "Sending-out bay") and on the receipt ("at QA hold cage", supplier without "(SUP-…)"). | `src/app/(app)/sales/[orderId]/page.tsx`, `sales/shipments/[shipmentId]/page.tsx`, `sales/picking/[pickId]/page.tsx`, `sales/packing/[shipmentId]/page.tsx`; `src/app/(app)/inventory/receive/[grId]/page.tsx:270` | – |
| 4 | Add "Print a label" to the shelf page ⋯ More (or change the guide text). Point the Box page's "Print box label" to `/labels/new?entityType=container…` directly. | `src/app/(app)/inventory/locations/[id]/page.tsx:38-44`; `src/ui/labels/label-guide.tsx:9`; `src/modules/inventory/containers.ts:546` | – |
| 5 | Scan search: list usable lots first, then waiting for QA, then expired or stopped, each with its shelf (same rule as the Move finder). | `src/modules/inventory/lookup.ts` | – |
| 6 | Supplier's lot number: decide A-SCAN-14. If kept, offer "take a photo of the supplier's label" next to the box so nothing has to be copied. | `src/app/(app)/inventory/receive/receive-form.tsx`, `src/app/(app)/inventory/lots/[lotId]/edit` | Owner + QA |
| 7 | Raw-material labels: approve the v2 layout so delivery labels stop printing "QUARANTINE" (use "WAITING FOR QA CHECK"). Fix the 50×30 test page so the ruler sits below the last row. | Admin › Labels and printouts (LT-RM-100X50, LT-RM-50X30); `src/app/print/labels/test/[labelTemplateId]/page.tsx` | QA (A-LBL-02) |
| 8 | Name pickers: one search-as-you-type list instead of a search box plus a dropdown. | `/sales/new`, `/sales/quotations/new` (NamePicker) | – |
| 9 | Receipt: "Damaged: waiting for Tess Navarro (purchasing) to accept it". Show the carton expiry only if the item has a real shelf life (QA). Shorten the sticky bar on phones (one-line button). | `src/app/(app)/inventory/receive/[grId]/page.tsx`, `src/modules/inventory/receiving-queries.ts:244`, `receive-form.tsx` | QA (A-R2P2-01) |
| 10 | Reservations rows: name the batch or product, not "for WO-26-00003 · MAT-0051 · RSV-…". Count sheet title by shelves, not "Count sheet CNT-26-0001". | `src/app/(app)/inventory/lots/reservations/page.tsx`; `src/app/(app)/inventory/counts/[id]/sheet/page.tsx:36` | – |
| 11 | Second-check wording ("another warehouse operator", or the name), the "sent before / still to send" line, the waiting delivery "Nothing on it yet", and "Open the delivery" on get from shelf. | `src/app/(app)/waiting-for.ts`, `sales/packing/[shipmentId]/page.tsx`, `sales/delivery-words.ts:10`, `sales/picking/[pickId]/page.tsx` | – |
| 12 | "12 pcs pcs" on Boxing jobs. | `src/app/(app)/warehouse/packs/page.tsx:86-87` | – |
| 13 | Sales user's Deliveries opens under the Operations tab row: give it the Sales row. | `src/app/(app)/nav.ts` | – |
| 14 | Words: "dispatch bay" (`src/lib/location-sections.ts:32`); "(price typed by hand)" (`src/app/(app)/sales/[orderId]/page.tsx:259`); "(s)" plurals on purchasing Home and suppliers; "0.0 %", "1.0 / 10.0" on supplier performance (`src/app/(app)/procurement/performance/page.tsx`); "Box or lot number from the label" search (`src/app/(app)/inventory/containers/page.tsx:42`); purchasing Home Scan tile "type the number printed on it"; stored movement note "to quarantine pen". | as listed | – |
| 15 | Stock counts in the order form ("Acapulco Soap 135 g (40 in stock)") disagree with Can we deliver? (7,131 pcs free). Count plan still 17 ticks (group shelves by section, fold the people list). Unlabelled customer filters. "lines.0.uom" accessible name. | `src/app/(app)/sales/orders/[orderId]/edit`, `/sales/new` product list; `/inventory/counts?new=1`; `/sales/customers`; `/procurement/requests/new` | – |
| 16 | Seed: the lye lot is used before it was received (negative running balance). The supplier-return refusal should name Tess Navarro. | `src/db/seed.ts`; who-can-do for `procurement.supplier_return.create` | – |

## 7. Not covered and risks

- Not exercised: put-away with a waiting lot (no data), the boxing record `/warehouse/packs/[packId]` (no open boxing job), the real label job print page `/print/labels/[jobId]`, and the below-minimum warning in the purchase order wizard. Making these would need pressing save/print.
- The demo was reset three times by someone else during the audit, so the grading spans data sets `01a19559…`/`01a19564…`. Row results were checked after the last full crawl (`01a19564…`).
- The 44 px check is automatic (bounding boxes). No frame target under 44 px was found at 390 or 820. Count-plan checkboxes are small boxes inside ≥44 px label rows (ADR-101).
- The chunk-404 behaviour was worked around, not re-tested on a real phone.
