# UX audit B: Inventory & warehouse, Purchasing, Sales (live app, 2026-10-31)

Auditor: independent UX/UI audit, read-only. Live app: https://bryels-care-production.up.railway.app (demo, fictional data).
Screenshots: `/tmp/claude-0/-home-user-bryels-care/103807bc-c37f-572c-a3d5-4a6ebca2aac4/scratchpad/ux-audit/B/` (file name = "Shot" column + `.png`; phone screenshots are full-page, contact sheets in `B/sheets/`).
Roles used: warehouse.nfd (Lito, phone and tablet), sales (Mara, phone), manager.nfd (Dino, phone), owner (Ana, phone and desktop 1440).
**The demo has no purchasing user and no finance user** (seed: owner, admin, manager.nfd, operator.nfd, checker.nfd, warehouse.nfd, qa.nfd, sales, warehouse.rvs, auditor, floor.nfd). The site manager **cannot** make a purchase order or a supplier return, so the purchase order wizard was walked as the owner.

Nothing was saved, sent, approved, printed or deleted. Lookups ("Find", "Look up") and wizard "Next" steps that do not save were used.

## 0. Environment note (please check on a real phone)

In this sandbox's headless Chromium, **every record page with an id in the address** (`/inventory/<lot>`, `/sales/<order>`, `/procurement/orders/<id>`, `/inventory/receive/<id>`…) first showed **"This page could not be loaded"**. Cause: the page's JavaScript file in a `[param]` folder (for example `/_next/static/chunks/app/(app)/sales/[orderId]/page-e373f392aeecdcd1.js`) came back **404 text/plain** to Chromium. The same URL returns 200 to curl, to Node and to an external fetch, so this is most likely caused by this sandbox's network path, not the app. The audit then fetched those files through Node to carry on. **Action:** open one record page (for example a customer order) on a real phone over mobile data and on the office Wi-Fi. If it fails there too, every record page in the app is broken, and that becomes problem #1. Next.js chunk paths with `[`/`]` have broken behind some proxies and CDNs before.

## 1. Summary

| | Count |
|---|---|
| Screens audited (route × role × viewport rows) | 112 rows |
| Routes in scope not reachable with demo data (no records exist) | 4: `/labels/jobs/[jobId]`, `/warehouse/packs/[packId]`, `/sales/picking/[pickId]`, `/procurement/expected/[poId]` (redirect only, checked) |
| Rows passing all 10 criteria | 55 |
| Rows failing at least one criterion | 57 |

Most list pages are good now: intro sentence, names first, grey codes, no sideways scroll at 390 px. Problems cluster in **receiving, labels, record-page headers on phones, and the get-from-shelf → check → send-out chain**. Demo data cannot exercise that chain (no orders ready to get from shelf), and the screens for orders that were already sent out contradict themselves.

### Top 10 problems (ranked by impact on a first-time warehouse or sales user)

1. **Labels still go to a "label print station" (a PC desk queue), and the phone does not say which label goes where.** On a phone, "Print a label" offers **"Send to the label printer"** (green) and "Print here now". The printer is "Warehouse 1 label desk (PC) (Thermal printer WH1 (203 dpi, demo))". `/labels` is titled "Labels to print · Warehouse 1 label desk (PC)": a queue that someone at the PC has to empty. The old page `/print/lot-label/receipt/<receipt>` has a **"Print station"** button and is still linked ("Try again" on the label preview). The code still says "open the print station to see why". (Shots: `w4-02-labels-new`, `wh-p-labels`, `w6-01-old-receipt-labels-page`.)
2. **The real labels are messy.** The raw-material 50 × 30 mm label (PDF render of the app's own test page) is cut off on the right ("SUP-…", "Sam…", "01 J…", "31 D…") and the reference text overlaps the expiry. On the 100 × 50 mm label, the black "STATUS AT PRINT: QUARANTINE" bar is cut at the bottom and "Scan to verify current status" is covered by "TEST-01A18D48". On both, the lot code is the biggest text and the material name is smaller, and they use the word "QUARANTINE". (Shots: `w7-raw-50x30-pdf-1`, `w7-raw-100x50-pdf-1`, `w6-02-box-label-pdf-1`.)
3. **Receiving forms are too long and still ask for codes.** With a purchase order: 6–7 visible fields. Without a purchase order: **9** visible fields. "Supplier's code on the sack" (typed) is asked even for shipping cartons. The "Why no purchase order?" list includes "Opening balance (data migration)", "Expiry date unknown at migration" and "PO to follow". The item list mixes spare parts (bearing 6205-2RS) with raw materials. The unit has no default ("—"). The destination reads **"Goes to QUA-01 · Waiting for QA / on hold · then store in Packaging (PKG-01)"**, which shows codes, not shelf names. (Shots: `w1-02-receive-with-po`, `w1-03-receive-no-po`.)
4. **Record-page headers break on a 390 px phone.** The "Change it" and "⋯ More" buttons sit beside the title and squeeze it, so a delivery title becomes "Bukidn / on / Aloe / Farms" and "Isla / Spa / Suppli / es" (broken mid-word). The status and code lines become one word per line. Seen on the receipt detail, the delivery (shipment) detail, and the customer order detail (milder). The same squeeze happens in the supplier return "What to do next" box (one word per line). (Shots: `wh-p-receipt-detail`, `wh-p-shipment-detail`, `sa-p-order-detail`, `pu-p-return-detail`; component `src/ui/record.tsx` line ~53.)
5. **Get from shelf → second check → send out cannot be learned from the live demo, and its sent-out data contradicts itself.** "To get from shelf" is empty, Boxing is empty, and "Ready to send out" and "Waiting for second check" are empty. All 12 sent-out deliveries show **"0 box(es) · 0 pcs"**. The second-check page of a sent-out delivery says "The second check is done" next to "Boxes · 0 of 0 checked" and "checked 0 pcs of 48 pcs · still to send after this 48 pcs". (Shots: `wh-p-dispatch`, `wh-p-packing`, `sa-p-shipments-all`.)
6. **Finding a lot "by name" still ends in comparing codes.** Typing "coconut" in Move stock gives 8 identical "Coconut Oil" rows that differ only by a grey lot code. They are sorted with the **expired** lot first, and the rows do not say which shelf each one is on. Put away's "Find lot" lists every coconut lot (ready-to-use and expired ones too), not just those waiting to be put away. (Shots: `w8-01-move-find-coconut`, `w8-04-putaway-coconut`.)
7. **The Scan screen still invites typing numbers and does not say where the label is.** The field label is "Scan a label or type a number" (placeholder cut off: "Scan, or type a name or num"). The camera fallback says "Type the lot number or the material name instead". The help lists "goods receipt number" and "lot number from a container label". Nowhere does it show which label (lot label, box label, shelf label) or where it is stuck. (Shot: `w11-scan-help-camera`; `src/ui/scanner.tsx` lines 93, 284, 289.)
8. **Purchasing is blocked for the site manager, and the message is wrong.** `/procurement/orders/new` and `/procurement/returns/new` tell Dino (the site manager) "You don't have access… Ask your site manager". A draft purchase order says "Waiting for purchasing to send it for approval", but no purchasing person exists in the demo. (Shots: `pu-p-order-new`, `pu-p-return-new`, `pu-p-order-detail`.)
9. **Jargon still on warehouse Home and on records.** Home tile: "Dispatch orders · orders allocated, ready to ship". Receipts: "Posted" chip and step, "Damaged awaiting procurement approval". Label printer: "(203 dpi, demo)". Sales guess: "Insufficient history (0 of 6 months needed)", "Forecasts are estimates, not actuals". "Create PO from this receipt". Shelf names "Quarantine cage" (seed data) show up everywhere. (`src/modules/analytics/dashboard.ts:551`, `src/modules/inventory/receiving-queries.ts:244`.)
10. **Two green buttons, or the same action twice, on several records.** Purchase order draft: "Send for approval" in What to do next **and** in "Do it now". Request to buy: "Decide" plus "Approve". Supplier return: "Approve or send back" plus "Approve". Posted receipt: "Print labels (2)" plus "Create PO from this receipt". Label request: "Send to the label printer" plus "Print here now". Also raw numbers: the customer returns list shows **"1 item(s), 6.000000"** (`src/app/(app)/sales/returns/page.tsx:55`).

## 2. Screen table

Legend: ✓ meets · ✗ fails · – not applicable (criterion 2 applies to record pages; criterion 3 to forms).
Criteria: 1 intro sentence · 2 one next step/waiting for · 3 ≤5 fields · 4 no typed codes / scan explained · 5 grade-5 words · 6 names before codes, units · 7 phone 390 · 8 empty/error states · 9 consistent with siblings · 10 no old screen reached.
Vp: P = 390×844 phone, T = 820×1180 tablet, D = 1440×900.

### Inventory & warehouse

| Route | Role | Vp | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Note | Shot |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/dashboard` (warehouse Home) | warehouse | P | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | "Dispatch orders · orders allocated, ready to ship" tile. The Receive tile says 0 expected today (+1 late) while Receive lists 2 deliveries. | wh-p-home |
| `/dashboard` | warehouse | T | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | Same as on the phone. | wh-t-home |
| `/inventory` | warehouse | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Good. Tabs, friendly units. | wh-p-inventory |
| `/inventory` | owner | D | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Dense table still readable. | ow-d-inventory |
| `/inventory/lots` | warehouse | P | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Redirects to /inventory (fine). | wh-p-lots-redirect |
| `/inventory/[lotId]` | warehouse | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Name title, "Move stock" next step, ⋯ More with 6 plain actions. | wh-p-lot, w4-01-lot-dots-more |
| `/inventory/[lotId]` | owner | D | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ow-d-lot |
| `/inventory/[lotId]/move` | warehouse | P | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | 4 fields. Shelf names "Quarantine cage". | wh-p-lot-move |
| `/inventory/stock-card/[lotId]` | warehouse | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | wh-p-stockcard |
| `/inventory/lots/[lotId]/edit` | warehouse | P | ✓ | – | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | "Supplier's code on the sack" is typed. Needed for tracing, but offer a photo/scan of the supplier barcode. | wh-p-lot-edit |
| `/inventory/items/[kind]/[id]` | warehouse | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | "Receive more". | wh-p-item |
| `/inventory/scan` | warehouse | P | ✓ | – | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | "Scan a label or type a number". Placeholder cut off. Camera fallback "Type the lot number". Help says "goods receipt number". Does not say which label or where it is. | wh-p-scan, w8-03-scan-coconut, w11-scan-help-camera |
| `/inventory/receive` (choose delivery) | warehouse | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | Good chooser. The sub-menu row shows only a lone green "More" pill (Operations has no main tabs for warehouse). | wh-p-receive |
| `/inventory/receive?po=…` | warehouse | P | ✓ | – | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | 6–7 visible fields. Supplier lot code typed. "Goes to QUA-01 … (PKG-01)". Expiry pre-filled with 5 years for cartons. The sticky save bar plus the tab bar take ~22 % of the screen. | w1-02-receive-with-po, w1-02b-receive-po-bottom-viewport |
| `/inventory/receive?po=…` | warehouse | T | ✓ | – | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | Same. | wh-t-receive-po |
| `/inventory/receive?nopo=1` | warehouse | P | ✓ | – | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | 9 visible fields. Migration reasons and "PO to follow". Spare parts in the item list. Unit "—". Supplier picked by a search box, items by a long dropdown (inconsistent). | w1-03-receive-no-po |
| `/inventory/receive/[grId]` (not finished) | warehouse | P | ✓ | ✓ | – | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | Header crushed (title one word per line). "Draft/Posted" steps. "Damaged awaiting procurement approval". "(SUP-0006)". "RCV (Receiving dock)". | wh-p-receipt-detail |
| `/inventory/receive/[grId]` (not finished) | warehouse | T | ✓ | ✓ | – | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | No crush at 820. Same words. | wh-t-receipt-draft |
| `/inventory/receive/[grId]` (saved) | owner | D | ✓ | ✗ | – | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | Green "Print labels (2)" plus green "Create PO from this receipt". "Posted" chip. "at QUA-01 (Quarantine cage)". | ow-d-receipt-posted, w5-01-posted-receipt |
| `/inventory/receive/[grId]/edit` | owner | D | ✓ | – | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | 16 inputs in the form. | ow-d-receipt-edit |
| `/inventory/receive/put-away` | warehouse | P | ✓ | – | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | Empty state is good. "Find lot" by name lists all lots including expired and ready ones. No shelf shown. | wh-p-putaway, w8-04-putaway-coconut |
| `/inventory/receipts` | warehouse | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | wh-p-receipts |
| `/inventory/receipts` | owner | D | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ow-d-receipts |
| `/inventory/move` | warehouse | P | ✓ | – | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | Search gives 8 identical names that differ only by lot code. Expired lot first. No shelf. Monospace input. | wh-p-move, w8-01-move-find-coconut, w8-02-move-step2 |
| `/inventory/move` | warehouse | T | ✓ | – | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | | wh-t-move |
| `/inventory/movements` | warehouse | P | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | "Quarantine cage" shelf names. Otherwise good. | wh-p-movements |
| `/inventory/movements/[id]` | warehouse | P | ✓ | ✓ | – | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | "Nothing to do." Fine. | wh-p-movement-detail |
| `/inventory/counts` | warehouse | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | wh-p-counts |
| `/inventory/counts?new=1` (plan) | warehouse | P | ✓ | – | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | 12 shelf boxes plus 5 people (2 questions, many ticks). "Quarantine cage", "Dispatch bay". | wh-p-count-plan |
| `/inventory/counts/[id]` | warehouse | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | "0 of 0 counted" before start (says nothing). | wh-p-count-detail |
| `/inventory/counts/[id]` | warehouse | T | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | wh-t-count |
| `/inventory/counts/[id]/sheet` | warehouse | P | ✓ | – | – | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | Title "Count sheet CNT-26-0001" (code, not shelves). | wh-p-count-sheet |
| `/inventory/adjustments` | warehouse | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | wh-p-adjustments |
| `/inventory/adjustments/new` | warehouse | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 3 fields, scan or name. | wh-p-adjust-new |
| `/inventory/adjustments/[id]` | warehouse | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Waiting for manager. | wh-p-adjust-detail |
| `/inventory/availability` | warehouse | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | wh-p-availability |
| `/inventory/lots/expiry` | warehouse | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | wh-p-expiry |
| `/inventory/lots/reservations` | warehouse | P | ✓ | – | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | Rows: "33.33% Lye Solution for WO-26-00002 · MAT-0021", "RSV-26-000005". Should name the batch or product. | wh-p-reservations |
| `/inventory/containers` | warehouse | P | ✓ | – | – | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Search "Box or lot number from the label" (typed code). | wh-p-containers |
| `/inventory/containers/new` | warehouse | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | wh-p-container-new |
| `/inventory/containers/[id]` | warehouse | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | wh-p-container-detail |
| `/inventory/locations` | warehouse | P | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | "Quarantine cage", "Dispatch bay" (data). | wh-p-locations |
| `/inventory/locations/[id]` | warehouse | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | wh-p-location-detail |
| `/inventory/wip` | warehouse | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | wh-p-wip |
| `/labels` | warehouse | P | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | This is the print-station queue ("Warehouse 1 label desk (PC)"), and phone users are sent here. | wh-p-labels |
| `/labels` | warehouse | T | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | | wh-t-labels |
| `/labels/new?entityType=inventory_lot&entityId=…` | warehouse | P | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | Two print buttons. Printer "(Thermal printer WH1 (203 dpi, demo))" cut off. "Goes to the label printer, where someone prints it." | w4-02-labels-new |
| `/labels/new` (no lot given) | warehouse/owner | P/D | ✗ | – | – | – | – | – | ✓ | ✗ | ✗ | ✓ | Bare Next.js "404 This page could not be found", no way back. | wh-p-labels-new, ow-d-labels-new-noparam |
| `/print/lot-label/[lotId]` (old URL) | warehouse | P | – | – | – | – | – | – | ✓ | ✓ | ✓ | ✗ | Redirects to /labels/new. The Scan card still links here (`src/modules/scan/card.ts:181`). | w6-03-old-lot-label-url |
| `/print/lot-label/receipt/[grId]` (old) | warehouse | P | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | Old label page: no app menu, no intro, "Print station" button, lot codes listed first. | w6-01-old-receipt-labels-page |
| `/print/box-label/[containerId]` | warehouse | P | ✗ | – | – | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | Box label preview: "BX-00000001" headline, "RELEASED", "BC:BOX:…" text. | w6-02-box-label-preview, w6-02-box-label-pdf-1 |
| `/print/labels/test/[templateId]` (100×50, 50×30) | warehouse | P | ✓ | – | – | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | The label render is cut or overlapping (see top problem 2). | w7-raw-100x50-preview, w7-raw-*-pdf-1 |
| `/warehouse` | warehouse | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | Duplicates Home tiles. "Raw materials 31 lots" vs Stock "All 13" (items, not lots, but looks like a mismatch). | wh-p-warehouse |
| `/warehouse` | owner | D | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | | ow-d-warehouse |
| `/warehouse/packs` | warehouse | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Empty: "Nothing to box". | wh-p-packs |
| `/warehouse/repack` | warehouse | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Free-text "Scan the box labels" area. OK. | wh-p-repack |
| `/quality/label-verification` | warehouse | P | ✓ | ✓ | – | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | Areas shown as codes only (A-01, FG-01, HLD-01, QUA-01…). | wh-p-label-verification |
| `/production/staging` ("Get materials by scanning", Planning tools) | owner | D | ✓ | – | – | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | Old screen: title "Stage materials", "reserved lots to the staging area", "work order is released". | ow-d-old-staging |

### Purchasing

| Route | Role | Vp | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Note | Shot |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/procurement` | manager | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | pu-p-home |
| `/procurement` | owner | D | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ow-d-procurement |
| `/procurement/requests` | manager | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | pu-p-requests |
| `/procurement/requests/[id]` | manager | P | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | "Decide" (green) plus "Approve" (green) plus a red "Say no", all on one page. | pu-p-request-detail |
| `/procurement/requests/new` | manager | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Unit select has the accessible name "lines.0.uom". | pu-p-request-new |
| `/procurement/orders` | manager | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | "1 item(s)". | pu-p-orders |
| `/procurement/orders` | owner | D | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ow-d-po-list |
| `/procurement/orders/[id]` (draft) | manager | P | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | "Waiting for purchasing" names no person. | pu-p-order-detail |
| `/procurement/orders/[id]` (draft) | owner | D | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | "Send for approval" twice. | ow-d-po-detail |
| `/procurement/orders/[id]` (sent) | owner | D | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | "Receive the delivery". | ow-d-po-detail2 |
| `/procurement/orders/new` | manager | P | ✗ | – | – | – | – | – | ✓ | ✗ | ✗ | ✓ | "You don't have access… Ask your site manager" (he is the site manager). | pu-p-order-new |
| `/procurement/orders/new` (4 steps) | owner | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | Good wizard. The amount defaults to 18 kg while the screen says "Order at least 50 kg", and step 4 accepts 18 kg with no warning. | w10-01…w10-04 |
| `/procurement/expected` | manager | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | "1 item(s) are late". Sales/Operations sub-menu shown (Operations Center, Production orders). | pu-p-expected |
| `/procurement/expected/[poId]` | manager | P | – | – | – | – | – | – | ✓ | ✓ | ✓ | ✓ | Redirects to Receive with the order filled in. | pu-p-expected-redirect |
| `/procurement/returns` | manager | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | "1 lot(s)". | pu-p-returns |
| `/procurement/returns/[id]` | manager | P | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | Next-step text one word per line. Two green buttons. "8 kg from REJ" (shelf code). | pu-p-return-detail |
| `/procurement/returns/new` | manager | P | ✗ | – | – | – | – | – | ✓ | ✗ | ✗ | ✓ | Same wrong "ask your site manager" message. | pu-p-return-new |
| `/procurement/returns/new` | owner | D | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Supplier by name. | ow-d-supret-new |
| `/procurement/suppliers` | manager | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | "day(s)". | pu-p-suppliers |
| `/procurement/suppliers/[id]` | manager | P | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | No next-step box for a "New – QA to check" supplier (should say "Waiting for QA (Nina)"). | pu-p-supplier-detail |
| `/procurement/reorder` | manager | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | pu-p-reorder |
| `/procurement/performance` | manager | P | ✓ | – | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | "Days to deliver (real / agreed) —/—", "100.0 %" style. | pu-p-performance |
| `/procurement/forecast` | manager | P | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | "Insufficient history (0 of 6 months needed)", "Forecasts are estimates, not actuals". | pu-p-forecast |

### Sales & customers

| Route | Role | Vp | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Note | Shot |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/dashboard` (sales Home) | sales | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | sa-p-home |
| `/sales` | sales | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | sa-p-orders |
| `/sales` | owner | D | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ow-d-sales |
| `/sales/[orderId]` (confirmed) | sales | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | Header squeezed (title wraps beside "All orders" and "More"). "price typed by hand". | sa-p-order-detail |
| `/sales/[orderId]` | owner | D | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ow-d-so-detail, ow-d-so-draft |
| `/sales/board` | sales | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | sa-p-board |
| `/sales/customers` | sales | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Filter selects have no visible label ("Everyone", "All types"). | sa-p-customers |
| `/sales/customers?c=…` (split) | sales | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | sa-p-customers-split |
| `/sales/customers/[id]` | sales | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | sa-p-customer-detail |
| `/sales/customers/new` | sales | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 4 fields. Model screen. | sa-p-customer-new |
| `/sales/new` (3 steps) | sales | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | Customer chosen with a search box **and** a dropdown (two controls). Guava "74 in stock" here vs 6,563 pcs free on "Can we deliver?" (check). | w9-01…w9-05 |
| `/sales/orders/[orderId]/edit` | owner | D | ✓ | – | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 8 inputs (product lines). OK for a line form. | ow-d-so-edit |
| `/sales/quotations` | sales | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | "(quotations)" in intro. | sa-p-quotes |
| `/sales/quotations/[id]` | sales | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | sa-p-quote-detail |
| `/sales/quotations/[id]` (waiting) | owner | D | ✓ | ✗ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | "Approve now" plus "Approve discount" (two green). | ow-d-quote-detail |
| `/sales/quotations/new` | sales | P | ✓ | – | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | 6 visible inputs (search + select for the customer). | sa-p-quote-new |
| `/sales/quotations/[id]/edit` | owner | D | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | "Only a draft can be changed" with Back. Good. | ow-d-quote-edit |
| `/sales/price-lists` | sales | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | sa-p-prices |
| `/sales/price-lists/[id]` | sales | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | "Waiting for Ana Villanueva… Ben Ocampo". Good. | sa-p-price-detail |
| `/sales/price-lists/new` | sales | P | ✓ | – | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 inputs (incl. tick box). | sa-p-price-new |
| `/sales/price-lists/[id]/edit` | owner | D | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Draft-only message. | ow-d-price-edit |
| `/sales/returns` | sales | P | ✓ | – | – | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | **"1 item(s), 6.000000"** (raw decimal). | sa-p-returns |
| `/sales/returns/[returnId]` | sales | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | sa-p-return-detail |
| `/sales/returns/new` | sales | P | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | sa-p-return-new |
| `/sales/shipments` | sales | P | ✓ | – | – | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | Every row "0 box(es) · 0 pcs". Opens under the Operations sub-menu for the sales user. | sa-p-shipments-all |
| `/sales/shipments/[shipmentId]` (sent out) | warehouse | P | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | Title "Isla / Spa / Suppli / es" broken mid-word. | wh-p-shipment-detail |
| `/sales/shipments/[shipmentId]` | warehouse | T | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Fine at 820. | wh-t-shipment |
| `/sales/shipments/[shipmentId]` (delivered) | owner | D | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ow-d-shipment-open |
| `/sales/picking` | warehouse | P | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Empty: "ask the sales team". | wh-p-picking |
| `/sales/dispatch` | warehouse | P | ✓ | ✓ | – | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | "12 delivery receipt(s) not signed back". "0 box(es) · 0 pcs". | wh-p-dispatch |
| `/sales/packing/[shipmentId]` | warehouse | P | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | "The second check is done" vs "Boxes 0 of 0 checked", "still to send after this 48 pcs". | wh-p-packing |

## 3. Task walkthroughs

### Warehouse on a phone (Lito, 390×844)

| # | Task | Screens reached | Result / where it went wrong |
|---|---|---|---|
| W1 | Receive with a purchase order | Home → Receive tile → `/inventory/receive` → tap "Manila Print & Pack" → `/inventory/receive?po=…` (stopped before "Save and print labels") | 2 taps to the form, good. Then 6–7 fields, typed supplier code, a 5-year expiry pre-filled for cartons, and the destination as "QUA-01 … PKG-01" codes. The "Save for later / Save and print labels" sticky bar sits above the tab bar, so less than 70 % of the screen is left for the form. |
| W2 | Receive without a purchase order | `/inventory/receive` → "No purchase order (urgent buy)" → `?nopo=1` | 9 visible fields, a reason list with migration jargon, spare parts in the item list, no default unit. A first-timer will not finish this alone. |
| W3 | Print labels | Lot → ⋯ More → "Print a label" → `/labels/new?…` (two print buttons). Posted receipt → "Print labels (2)" (not pressed; it creates label jobs). Read-only previews: `/print/labels/test/<template>`, `/print/box-label/<box>` with page.pdf() | **A print station is still there.** The default action sends the label to "Warehouse 1 label desk (PC)", and `/labels` is that desk's queue. Preview vs PDF: the box label is clean. The raw-material 50×30 label is cut off and overlapping, and the 100×50 label's status bar is cut and covers the "scan to verify" text. Lot code is the headline, name smaller. |
| W4 | Which label to stick, how to scan it | Receipt says "stick a label on every container"; Scan help | No picture or example of the lot label vs box label vs shelf label. Scan says "Scan a label or type a number", and the camera fallback says "Type the lot number". The user only learns where to scan by trial. |
| W5 | Put away | Home → Put away (0) → typed "coconut" → Find lot | The list is empty (nothing approved by QA). The name search lists every coconut lot (expired and ready ones too), so the user cannot tell which one is waiting. |
| W6 | Move | Inventory → Move stock → "coconut" → Find → picked first row → step 2/3 (stopped before Confirm) | The first row offered is the **expired** lot. After picking it, only the QA cages are offered (correct rule, but no explanation of why). Shelf by name works. |
| W7 | Count | `/inventory/counts` → open count → "Start count" (not pressed) | Clear. The plan form is long (17 ticks) but understandable. |
| W8 | Fix stock | Inventory → ⋯ → Fix stock → New | Good: 3 fields, scan or name, "Send to manager". |
| W9 | Find a lot by name | Scan → type "coconut oil" → Look up | Works and shows status words. Results differ only by lot code. No shelf on lot rows. |
| W10 | Get from shelf | Menu → Packing & dispatch → To get from shelf | Empty ("ask the sales team"). Cannot be walked with demo data. |
| W11 | Second check of the box | Send out → delivery → `/sales/packing/<id>` | Only sent-out deliveries exist. The page contradicts itself (done / 0 of 0 / 48 pcs still to send). |
| W12 | Send out | `/sales/dispatch` | "Ready to send out (0)", "Waiting for second check (0)". 12 rows waiting for proof of delivery, each "0 box(es) · 0 pcs". Proof form on the delivery page is clear (name, when, signature). |

### Purchasing

| # | Task | Screens | Result |
|---|---|---|---|
| P1 | Request to buy (manager) | Management → Purchasing → "Ask to buy something" → `/procurement/requests/new` | Good: 5 fields, item by name, unit by default. Not saved. |
| P2 | Purchase order wizard (manager) | `/procurement/orders/new` | **Blocked**: "You don't have access… Ask your site manager" (he is the site manager). |
| P2b | Purchase order wizard (owner, phone) | 1 supplier (tap "Laguna Oleo Supply") → 2 items (Coconut Oil) → 3 when (+7 days) → 4 check, stopped before "Save and send for approval" | Clear wizard. The amount defaults to 18 kg while the screen says "Order at least 50 kg", and step 4 accepts it with no warning. "Takes about 7 day(s)". |

### Sales (Mara, phone)

| # | Task | Screens | Result |
|---|---|---|---|
| S1 | New customer | `/sales/customers/new` | 4 fields, the system makes the number. Best form in scope. Not saved. |
| S2 | New customer order | `/sales/new` → type "isla" → choose → Deliver by → Products → Acapulco Soap 48 → Check and save (stopped) | Smooth. "Deliver by" is required but only flagged after pressing Next. Two controls (search + dropdown) for one choice. Stock warning is clear. |
| S3 | Price offer | `/sales/quotations/new` (form opened, not saved) | 6 visible inputs. The same two-control pickers. The price fills from the usual price. |

### Owner

Opened every list and a record of each type on desktop 1440 (rows "owner D" above). Desktop has no layout breakage. The issues are the same words and two-button records as on the phone, plus the old "Stage materials" screen under Planning tools.

## 4. Old or superseded screens still reachable

| Screen | How reached |
|---|---|
| `/print/lot-label/receipt/<grId>`: old "Labels · GR-…" page with a **"Print station"** button, no app menu | Typing the URL. Also linked as "Try again" in the failure banner of the receipt label preview (`src/app/print/labels/receipt/[grId]/page.tsx`). |
| `/labels` as a **print-station queue** ("Labels to print · Warehouse 1 label desk (PC)") | Menu → Inventory → Counts & labels → Labels to print. Also the default "Send to the label printer" on `/labels/new`. |
| `/print/lot-label/<lotId>` (legacy URL, redirects to `/labels/new`) | Scan card action "Print label" (`src/modules/scan/card.ts:181`). |
| `/production/staging` "Stage materials" (work order / staging words) | Owner: Management → Planning tools → "Get materials by scanning". |
| `/labels/new` without parameters → raw 404 | Typing the URL or any stale link. |
| Text "open the print station" | Shown when a receipt label cannot render (`src/app/print/labels/receipt/[grId]/page.tsx`). Also "Label sent to the print station" in `src/app/(app)/sales/fulfilment-actions.ts:327,358`. |

## 5. Fix list

| # | What | Where |
|---|---|---|
| 1 | Make "Print here now" (phone/tablet printer or browser print) the one green button. Keep the desk queue only as a "⋯ More → send to the desk printer" option. Rename "Labels to print" to "Labels waiting at the desk printer" or hide it from floor menus. Drop "print station" wording. | `src/app/(app)/labels/forms.tsx:176`, `src/app/(app)/labels/page.tsx`, `src/app/(app)/nav.ts` (Counts & labels), `src/app/(app)/sales/fulfilment-actions.ts`, `src/app/print/labels/receipt/[grId]/page.tsx` |
| 2 | Retire `/print/lot-label/receipt/[grId]`: redirect it to the receipt and point "Try again" at the receipt's Print labels. Make the Scan card link to `/labels/new?…` directly. | `src/app/print/lot-label/receipt/[grId]/page.tsx`, `src/modules/scan/card.ts:181` |
| 3 | Fix the label layouts. Shrink or wrap the 50×30 fields so nothing is cut (drop INCI and supplier on the small size). Stop the reference text overlapping the expiry and the status bar. Put the material name as the biggest line and the lot code below. Replace "QUARANTINE" with "WAITING FOR QA" (needs QA sign-off per ADR-095 for printed records). | Label templates LT-RM-50X30, LT-RM-100X50 (admin templates) and the renderer in `src/modules/documents` |
| 4 | Record header on phones: put secondary actions (Change it, ⋯ More, All orders) on their own row below the title under `sm`. Never let the title column shrink below the full width. Same for the NextStep box (button below the text on phones). | `src/ui/record.tsx` (~line 53–84), `src/ui/guide.tsx` (`NextStep`) |
| 5 | Receive form: show quantity + expiry + "supplier's lot (optional, or photo)" only. Fold brand, "Not in this delivery" and the delivery paper number under More details. Show the destination as a shelf name ("Goes to the QA cage, then the packaging shelf"). Skip expiry for packaging items with no shelf life. Default the unit. Filter spare parts out of the item list. Change "Why no purchase order?" options to plain words and remove the migration options from the floor. | `src/app/(app)/inventory/receive/receive-form.tsx` (line ~426 and the no-PO block) |
| 6 | Show the receipt state as "Not finished / Saved", not Draft/Posted. Change "Damaged awaiting procurement approval" to "Damaged: waiting for purchasing (name) to accept". Rename "Create PO from this receipt" to "Make the purchase order" and move it to ⋯ More so there is one green button. | `src/app/(app)/inventory/receive/[grId]/page.tsx`, `src/modules/inventory/receiving-queries.ts:244` |
| 7 | Lot search results (Move, Put away, Scan): add the shelf name and "use this first" on each row. Hide expired and blocked lots from Move/Put away by default (show them under "Also not usable"). Put-away search should only list lots waiting to be put away. | Move and put-away pages under `src/app/(app)/inventory/`, `keywordMatches` callers |
| 8 | Scan: label "Scan the label (or type the item name)". Change the camera fallback to "type the item name". Add a small picture of the three labels (lot label on sacks, box label on boxes, shelf label on racks) and where they are stuck. Drop "goods receipt number" from the help. | `src/ui/scanner.tsx:93,284,289`, `src/app/(app)/inventory/scan/page.tsx` |
| 9 | Warehouse Home tile: "Send out · orders ready to go on the truck". | `src/modules/analytics/dashboard.ts:551` |
| 10 | Shipments/dispatch summary: fix "0 box(es) · 0 pcs" for sent-out deliveries (count shipped lines, not open boxes) and pluralise properly. Second-check page: when the delivery has already gone, hide the "Boxes 0 of 0 checked" card and the "still to send" line. | `src/app/(app)/sales/dispatch/page.tsx:58`, `src/app/(app)/sales/shipments/page.tsx:48`, `src/app/(app)/sales/packing/[shipmentId]/page.tsx` |
| 11 | Customer returns list: format quantity with the unit (`fmtQty`) instead of "6.000000", and pluralise "item(s)". | `src/app/(app)/sales/returns/page.tsx:55` |
| 12 | Purchasing access message: when the viewer *is* a site manager, say "Only the owner (or a purchasing person) can make purchase orders: ask Ana Villanueva". Name the person in "Waiting for purchasing". Seed a fictional purchasing user (and finance user) so the demo can show the purchasing flow. Decide (owner) whether the site manager should create purchase orders (ADR-091 lets him approve them). | Forbidden copy in `/procurement/orders/new`, `/procurement/returns/new`; `src/db/seed*.ts` |
| 13 | PO wizard: default the amount to the supplier minimum (50 kg). Warn in step 4 when below the minimum. | `src/app/(app)/procurement/orders/new` |
| 14 | One green button per record. Purchase order draft: drop the duplicate "Do it now" button. Request to buy and supplier return: make "Decide" open the decision, or show only the decision buttons. Quotation waiting: one "Approve". Label request: one print button. | `/procurement/orders/[id]`, `/procurement/requests/[id]`, `/procurement/returns/[id]`, `/sales/quotations/[id]`, `/labels/new` |
| 15 | Name-and-code: reservations rows should show the batch or product name, not "for WO-26-00002 · MAT-0021". Label-verification area chips should show shelf names. Supplier return lot rows should say "from Rejected goods cage" not "REJ". Count sheet title should show shelves. | `/inventory/lots/reservations`, `/quality/label-verification`, `/procurement/returns/[id]`, `/inventory/counts/[id]/sheet` |
| 16 | `/labels/new` without a lot: redirect to `/labels` with "Open a lot and choose Print a label" instead of a bare 404. | `src/app/(app)/labels/new/page.tsx` |
| 17 | Name pickers (sales order, price offer, no-PO receive): a single search-as-you-type list, not a search box plus a separate dropdown. | `NamePicker` usage in `/sales/new`, `/sales/quotations/new` |
| 18 | Words: "Insufficient history", "Forecasts are estimates, not actuals", "(203 dpi, demo)", "price typed by hand", "Stage materials / staging area / work order", "day(s)/item(s)/lot(s)/box(es)". Data: rename seed shelves "Quarantine cage" to "QA waiting cage" and "Dispatch bay" to "Send-out bay" (owner decision, A-G5-I1). | `/procurement/forecast`, printer names, `/production/staging`, seed |
| 19 | Verify the chunk-404 issue (section 0) on a real phone and network. If it happens, check proxy/CDN handling of `[`/`]` in `/_next/static/chunks/app/**/[param]/` paths. | Railway deployment / Next config |

## 6. Not covered and risks

- Not audited (no records exist): `/labels/jobs/[jobId]`, `/warehouse/packs/[packId]`, `/sales/picking/[pickId]`. Get from shelf and the second check of a box with real scans could not be walked. Seed one order ready to get from shelf and one boxing job.
- Buttons that write data were not pressed: Save and print labels, Print labels (2), Send to the label printer, Print here now, Start count, Save the order, Save and send for approval. So the actual post-save print preview of a receipt (`/print/labels/receipt/<gr>?jobs=…`) was not seen. The test-page and box-label renders were used as the closest read-only previews.
- The 44 px check is automatic (bounding boxes). The only small targets found were the header avatar/logo and the "?" help icons (~36 px).
- PAGE_REVIEW.md marks all of these screens ☑. This audit disagrees on 57 rows, mostly receiving, labels and phone headers.
