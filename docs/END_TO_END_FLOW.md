# End-to-end flow: from purchase order to boxed, sent and invoiced order (walked 1–6 Nov 2026)

The owner: *"I still can't follow the steps from Purchase Order to Boxing an Order, there is too much going on. I think
there are still older screens."* This document is the result of walking the whole chain for real on a local copy,
as the person who would really do each step. Every step started from that person's **Home** on a phone
(390 × 844, touch), and the walk created real records. No app code was changed.

**How to read it.** Part (a) is the chain as one table. Part (b) lists the screens that should not be on the path.
Part (c) is the ranked fix list, with the "How work flows" page (ADR-106 §5). Part (d) gives taps and screens per
role. Part (e) lists what was not walked, the caveats, and what to re-check.

## 0. What was walked, on which code, with which records

| Item | Value |
|---|---|
| Database | `bryels_zf_dev` (fresh migrate + demo seed, `ALLOW_DEMO_SEED=true`). Dropped at the end. |
| Server | `next dev -p 3536`, `DEMO_MODE=true`, phone viewport. |
| Code | The branch moved four times during the walk because other engineers merged into the shared checkout. Stages 1–3 and the planner ran on `22be7b3` (ADR-106 merge). From the production order approval to batch B-26-0006 the code was `08194ff` (ADR-107/108). From the first QA batch release to the pick list it was a frozen copy of `4cd16c4`. From "finish getting from shelf" to the invoice it was a frozen copy of `dbef55e` (ADR-104 §1 §3 §5, ADR-106 §1–3 as built). Findings in production stages 4b–4f marked **(re-check on dbef55e)** may already be changed by that merge. |
| Accounts | `procurement@` Tess Navarro · `manager.nfd@` Dino Reyes · `warehouse.nfd@` Lito Pascual · `warehouse2.nfd@` (display name also "Tess", for the second check of the box) · `qa.nfd@` Nina Quiambao · `qa.lead@` Teresa Ocampo (second QA person) · `sales@` Mara Santos · `planner.nfd@` Cora Villamor · `operator.nfd@` Rhea Mendoza with Jun Dela Cruz (`checker.nfd@`) picked as second person · `finance@` Rosa Lim · `finance2@` Ben Ocampo. Password `demo1234`. |
| Records made | PR-26-00003 → PO-26-00009 (Laguna Oleo Supply, Coconut Oil 200 kg) → GR-26-00016 → lot L-2611-00024 (4 sacks) → INS-26-00002 → put away to A-01. SO-26-00015 (Isla Spa Supplies, Guava Bar Soap 135 g × 500) → WO-26-00003 (378 bars, 4 batches B-26-0006…0009) → lots L-2611-00025…00028 → pick PK-26-000003 → delivery SH-26-00003 / DR-26-00003 → proof of delivery → INV-2026-000005 (₱35,000.00, issued, due 6 Dec 2026). |
| Evidence | 290 screenshots and PDFs (sack labels, box labels, delivery receipt) were in the session scratchpad `e2e-flow/` folder, which is not kept. Numbers such as **#039** below refer to those files. Each step's URL, title, "Next:" text and alerts were also logged. |

---

## (a) The chain as one table

"Next link?" means: does the screen where the step ends show a "Next: …" sentence **and** a button to the following
stage? ✔ = yes, ◐ = a sentence but no button (or the wrong one), ✘ = nothing.

| # | Stage | Who | How they learn it is their turn | Screens (URL) | Taps* | Next link? | Problems found (evidence) |
|---|---|---|---|---|---|---|---|
| 1a | Request to buy | Procurement (Tess) | **Nothing on Home.** Her Home has only "Scan / look up" and "QA queue" (#001). She must know the menu: Menu → Management → Purchasing → "Ask to buy something". | `/dashboard` → menu → `/procurement` → `/procurement/requests/new` → `/procurement/requests/[id]` | 9 | ✔ "Next: send this request for approval." | P1 Home has no buying work. P2 Purchasing sits three levels deep under "Management". Detail pages have the generic title "Bryel's Care ERP". |
| 1b | Approve the request | Site manager (Dino) | Message "Request to buy waits for approval" and the To approve list. **His Home said "Waiting for your approval 0 · Nothing to decide" while To approve held 11 items (#008/#009, code 22be7b3; showed 10 after the ADR-107 merge).** | `/approvals` → `/procurement/requests/[id]` | 3 | ◐ "Waiting for Tess … to order it" (correct hand-off, no link needed) | The inline Approve on To approve needs a second "Yes, approve" tap; the oldest-first list put the new request 10th. |
| 1c | Purchase order | Procurement | Message "Request to buy approved · Make a purchase order from it". | `/notifications` → `/procurement/requests/[id]` → "Make a purchase order" → `/procurement/orders/new` (4-step wizard) → `/procurement/orders/[id]` | 8 | ✔ (wizard pre-filled the request line after the supplier was picked) | **P3 The same 200 kg needs a second manager approval**: one for the request, one for the PO. The "Make a purchase order" button does not carry the request or supplier: she picks the supplier again. "Comes in 18 kg packs" but 200 kg is accepted without a word. |
| 1d | Approve the PO | Site manager | To approve → Open | `/procurement/orders/[id]` | 3 | ◐ | **The manager approves ₱37,000 with no price visible on the order page (#029)**: prices are hidden for his role, though the To approve row shows amounts for other POs. |
| 1e | Send the PO | Procurement | Message "Purchase order approved · Send it to the supplier". | `/procurement/orders/[id]` | 3 | ✔ "Sent … The warehouse receives it." | Warehouse is **not** told that a delivery is coming. It only appears in their Receive list. |
| 2a | Receive against the PO | Warehouse (Lito) | Home tile "Receive · 0 deliveries expected today" (the PO is due 8 Nov, so 0). Tap → list of POs → tap the supplier row. | `/dashboard` → `/inventory/receive` → `/inventory/receive?po=…` | 8 | ✔ goes straight to label printing | Clear form. The required supplier lot and expiry are explained well. The number of sacks is hidden under "More details" although it decides how many labels print. |
| 2b | Print sack labels | Warehouse | Automatic after "Save and print labels". | `/print/labels/receipt/[grId]` (#039, PDF 4 pages 100 × 50 mm) | 3 | ✘ after "Yes, they printed" the only link is "Back to the delivery" | **P4 Every one of the 4 sack labels says "Qty 200.00 kg"**, the whole lot and not the sack (should be about 50 kg each, or no quantity). Delivery page stepper says "Not finished (done) · Saved to stock (current step)" for a lot that waits for QA, and has a second "Print labels (1)" button. |
| 2c | QA incoming check | QA (Nina) | Message "1 new lot from Laguna Oleo Supply waits for the quality check". **Open goes to the whole QA queue, where the lot is 9th of 9 (#045), not to the lot.** Her Home "Next" sends her to To approve instead (3 other items). | `/quality` → `/quality/lots/[id]` → "Start the quality check" → `/quality/inspections/[id]` | 12 | ✔ inspection says "Waiting for a second QA person" | Two QA pages for one lot (lot page and inspection page). The sample box shows "200000 g here" instead of 200 kg. **P5 The results could be saved with no sample recorded, and after the results the sample form disappears, so the sample can never be recorded (#052–#053).** |
| 2d | Second QA check and decision | QA lead (Teresa) | To approve row "Quality check to confirm · A quality check INS-26-00002" (does not name the material or lot). | `/approvals` → `/quality/inspections/[id]` → "Go to the lot decision" → `/quality/lots/[id]` | 6 | ✘ after OK: no "Next: put away" | **P6 Nina's lot page still says "Next: … decide OK or not OK", but OK is blocked for her** ("You entered test results … another QA user must decide"). Nina is not told that Teresa checked. After OK the page reads "Release is not possible while the lot is released" (old words). For finished batches the same person **may** test and release ("tested and OK'd by the same person"), so the rule differs between lot and batch. CoA test passed although no CoA is attached. |
| 2e | Put away | Warehouse | Message "Coconut Oil lot is ready — put it on L-2611-00024 · A-01" and the Home tile "Put away 1". **Good hand-off.** | `/inventory/receive/put-away` → row → "Put away to A-01" | 3 | ✘ ends on "Done … movement MOV-26-000001" | Movement number shown to the floor. The operator also receives the put-away message. |
| 3a | Customer order | Sales (Mara) | No task. Home has no "New customer order" button; Sales tab → New. | `/sales/new` (3 steps) → `/sales/[id]` | 9 | ✔ "Next: send the order …" | "Deliver by" has no default and blocks Next. The product step warns "More than is free … you can have it made for this order", but that promise is not kept (3c). |
| 3b | Approve if needed | — | Credit check OK, confirmed at once. | `/sales/[id]?done=confirmed` | 1 | ✔ "Next: set aside the stock" | Fine. |
| 3c | It needs making | Sales → planner | **Nobody is told.** Set aside: "Not enough released stock — GBS-135: 378 pcs short … allocate again when more stock is released." The only button is "Set aside the rest". | `/sales/[id]` | 1 | ✘ dead end | **P7 "Make for this order" never appears.** (1) It is shown only to people with `production.work_order.create`, not to sales. (2) Even for the planner the card is missing: `salesOrderShortfalls` counts about 6,489 released Guava pieces lying in the **shipping area (SHP)** as "free", while set-aside (correctly) ignores them. The direct link says "Nothing is missing on SO-26-00015 line 1" while the order says 378 short (#086). Two definitions of "free stock". The planner's Home and Messages mention nothing (#081–#082). Words "released stock", "allocate". |
| 4a | Production order | Planner (Cora) | Only by being phoned by sales (no message, no Home line). Home → "See the orders" → New production order. | `/production/orders/new` → `/production/orders/[id]` | 6 | ◐ "Waiting for approval" | Created by hand, so **WO-26-00003 has no link to SO-26-00015**. 378 pcs became "4 batches expected" (3 × 123 = 369 is short). The order shows "Anyone can take it": no operator is told. |
| 4b | Approve production order | Site manager | To approve (now counted on Home after ADR-107). | `/production/orders/[id]` | 2 | ✔ "Batch B-26-0006: … Get materials" | Fine. |
| 4c | Get materials | Operator (Rhea) | Home "Your tasks today": 6 cards, our 4 batches plus 2 older ones, one using `/production/orders/without-order/…`. | `/production/orders/[id]/materials` | 7 | ✔ "Next: Start." | Palm Oil showed "Lot L-2611-00002 (+1 more)" instead of the lot-by-lot split of ADR-106 §1 **(re-check on dbef55e)**. "All taken" needs a confirm. |
| 4d | Weigh, with second person | Operator + Jun | Button from Get materials → step 1 clean-area check → Weigh. | `/step/1` → `/weigh` → **`/step/2`** | ≈45 per batch | ◐ | **P8 After the four line checks, "Step done" says "Waiting for the second check" again, and that check can only be given on `/step/2`, which the Weigh screen does not link (#113–#116).** Meanwhile the order page "Next step" jumps to the next batch (B-26-0007) and hides the waiting check (#114). **P9 From the second batch on, both scales "cannot be used", with no reason shown (#165)**: SC-01 needs a cleaning record after every batch and SC-02's calibration is overdue. The fix is on a master-data page (`/masterdata/equipment/[id]`, "BLOCKING RULE block", "dirty (per batch)", "PM plan") that nothing links to. The mixer MIX-01 is blocked the same way at step 4. The scale choice that blocks Save is hidden under "More details". **P10 Lot split (B-26-0009): the card proposed all 8,687.4 g from a lot with only 7,844.4 g free and refused with "…weighed or issued, not yet posted" (#193).** The split lives on `/weigh/more` ("Other ways to weigh"), which after the first part still proposed the emptied lot and previewed "line total 15,688.8 g" (#203) **(re-check on dbef55e)**. A handheld scan sometimes stuck at "Label scanned: lot …". The second person is only picked from a name list, with no PIN or own confirmation. |
| 4e | Steps 3–5 | Operator + Jun | Button at the end of each step. | `/step/3`, `/step/4`, `/step/5` | ≈14 | ✔ | The link says "Production area line clearance", the page says "Production area clean-area check". Step 4's "Mould used" text field disappears while the keypad is in use (it was skipped and still accepted). |
| 4f | Packaging and labels | Operator | Step 6. | `/step/6` → `/print/labels/batch-boxes/[batchId]` → back | ≈14 | ✔ "Go to Finish" | Box labels themselves are good: one per box, "48 / 48 / 27 · PART BOX" (PDF 3 pages). Printing needs two taps ("Print 3 box labels", then "Open the box labels and print"). Wrapper counts are asked here **and** again at Finish. |
| 4g | Finish | Operator | "Go to Finish". | `/production/[batchId]/finish` | ≈6, plus 6 rework | ◐ returns to the order page; "Next step" is the next batch | **P11 Finish takes 2 samples by default (121 left), but step 6 printed box labels for 123, so Finish is refused (#134) until "How many bars did you pack?" is changed to 121 and the labels are printed again ("destroy any you printed").** The good-bar count from step 6 is not pre-filled. "Goes to: QA hold cage" but the lot ended up at FG-01. The header says "123 bars · 4 batches made" while the body says "Batches: 0 of 4 done". The batch record link is `/production/[batchId]` (old route family). |
| 4h | QA OK of each batch | QA (Nina) | **No message per finished batch.** It appears in the QA queue "Batches waiting for QA check". | `/quality/check/[batchId]` | 10 per batch | ✘ after OK: "Pass by Nina … The batch is closed." | Word "Pass". Nothing points to the waiting customer order. Done 4 times (B-26-0006…0009). |
| 5a | Set aside (the rest) | Warehouse | **Nobody is told** that stock now exists for SO-26-00015. Lito reopened the old "Order confirmed" message. | `/sales/[id]` "Set aside the rest" | 3 | ✔ "Next: get it from the shelf" (shown twice) | The 500 pcs were set aside as **5 loose lots**, not as the 12 boxes made at Finish. |
| 5b | Get from shelf | Warehouse | Button on the order. | `/sales/picking/[pickId]` | 12 | ✔ "Next: finish, so a colleague can check the box a second time." | **P12 The boxes labelled at step 6 are not on the pick list.** It asks for "121 pcs loose" per lot. Scanning a real box label (BX-00000005) → "Box BX-00000005 is not for this order" (#233). The boxes are recorded in **QUA-01 (QA hold cage)** while their lots' stock is at FG-01: the boxes did not move when QA said OK, and never appeared in Put away. No lot labels exist for finished lots, so the picker has to type lot numbers and count pieces. |
| 5c | Second check of the box | 2nd warehouse person | **No message and no Home tile.** "Send out orders" opens the pick list. The check is found under Menu → Send out → "Waiting for the second check" → Check. The menu entry "Boxing" (`/warehouse/packs`) says "Nothing to box". | `/sales/dispatch` → `/sales/packing/[shipmentId]` | 16 + 4 detour | ✔ "Next: send it out." | **P13 Data error: scanning box BX-00000005 (not picked, not for this order, still in the QA cage) was ADDED "under the approved over-shipment (48 pcs)". No over-shipment had been approved. The order then showed "checked 548 pcs of 500" with Finish still enabled (#248, #271).** It could only be removed through "Take off…" inside the collapsed "Boxes on this delivery and scans". **P14 A typed lot number loses the counted quantity**: only the QR payload `BC:LOT:<lot>` carries it, and the message "Enter how many loose units … you counted" repeats although it was entered. The screen calls the 5 loose lots "Boxes · 0 of 5". |
| 5d | Send out | Warehouse | No message that the check is done. Menu → Send out, or the delivery page. | `/sales/shipments/[id]` | 6 | ✔ "Next: when the driver is back … save the proof of delivery." | Fine (driver, plate, confirm). The delivery receipt printed (DR-26-00003). |
| 5e | Proof of delivery | Warehouse | Same delivery page. | `/sales/shipments/[id]` | 3 | ✘ "Delivered. Nothing more to do." | No hand-off to billing is shown (finance had already been messaged at send-out). |
| 5f | Invoice | Finance (Rosa), then Ben | Message at send-out: "Invoice draft ready for (Isla Spa Supplies) DR-26-00003 … Total 35000.00 PHP". | `/notifications` → `/finance/invoices/[id]` → Ben: `/approvals` → invoice → Approve → "Save to the books" + password | 3 + 3 + 3 | ✔ "Next: when Isla Spa Supplies pays, save the payment here." | Good hand-off and separation of duties. The message format is raw ("35000.00 PHP", name in brackets). Tax ₱0.00: tax rates are configuration for the company's qualified reviewer (not judged here). Number formats differ across the chain (INV-2026-000005, SO-26-00015, PK-26-000003, DOC-26-0000024, B-26-0006, WOM-2611-027). |

\* Taps = taps, selections and typed fields on the happy path, counted from the scripts. Keypad digits count one tap
each.

### Hand-offs in one view

| From → to | Told how? | Verdict |
|---|---|---|
| Procurement → manager (request, PO) | Message + To approve | OK, but two approvals for one purchase. |
| Manager → procurement | Message | OK |
| Procurement → warehouse (PO sent) | Only the Receive list | Weak |
| Warehouse → QA (delivery in) | Message, but it opens the whole queue | Weak |
| QA → second QA → QA | To approve row without the material name; first QA not told | Weak |
| QA → warehouse (put away) | Message with lot and shelf + Home tile | **Good** (the model for the rest) |
| Sales → planner (needs making) | **None** | **Broken** |
| Planner → manager → operator | To approve; then "Anyone can take it" | Weak |
| Operator → second person | Round 5 (ADR-130): every check lands on the checker's list **Waiting for you to check** (`/production/checks`, one card per batch of weighings, one per step; their Home "Check" task opens it). A checker standing beside the operator may sign on her phone only with **their own password** (setting `production.sign_off.same_device`); a name alone never signs | **Good** |
| Production → QA (batch finished) | QA queue only, no message | Weak |
| QA → warehouse / sales (stock now available) | **None** | **Broken** |
| Picker → checker (second check) | **None**, not even a Home tile | **Broken** |
| Checker → dispatcher | None | Weak |
| Dispatch → finance | Message "Invoice draft ready" | Good |

---

## (b) Screens on the path that should not be there

| Screen | How it was reached | Why it does not belong on the path | What to do |
|---|---|---|---|
| `/procurement` hub with 10 sub-links | Menu → Management → Purchasing | A dashboard in the way. Tess's real work is "requests to order" and "orders to send". | Put both on her Home and keep the hub as "All purchasing". |
| `/procurement/requests/new` **and** `/procurement/orders/new` for the same purchase | Request → approve → PO → approve | Two documents and two manager approvals for one buy. | Approved request → PO in one tap (supplier pre-chosen), no second approval within the approved amount (owner decision, see C4). |
| `/quality` (whole queue) as the target of the "new lot" message | Message → Open | Wrong landing page: the lot is last of 9. | Message links to `/quality/lots/[id]`. |
| `/quality/inspections/[id]` as a second page next to `/quality/lots/[id]` | "Start the quality check" | One lot, two QA screens, two "Next" boxes that disagree (P6). | Fold the tests into the lot page, or make the inspection page the only page until the decision. |
| `/approvals` row "A quality check INS-26-00002" | Second QA person's To approve | No material or lot in the row. | Name: "Coconut Oil L-2611-00024: check Nina's results". |
| `/masterdata/equipment/[id]` (set-up page) | Operator, to record scale/mixer cleaning | An admin page with "BLOCKING RULE", "PM plan", "work order" words, needed every batch. | "Record cleaning" button on the Weigh card and step 4 when equipment is blocked. |
| `/production/orders/[id]/step/2` (second check of weighing) | Only by typing the URL; the Weigh screen does not link it | Hidden mandatory step. | Ask for the step check on the Weigh card, or drop it when every line already has a check. |
| `/production/orders/[id]/weigh/more` ("Other ways to weigh") | Weigh → More details → "Container weight, split over two lots, undo a weighing" | The normal lot split (ADR-106 §3) should happen on the Weigh card itself. | Propose the split on the card (re-check on dbef55e). |
| `/production/orders/without-order/…` | Operator Home cards for seeded batches | Old address family for batches without an order. | Redirect or attach demo batches to orders. |
| `/production/[batchId]` and `/production/[batchId]/finish` | "See the full batch record", "Go to Finish" | Old route family next to `/production/orders/[id]/…`. | Move Finish under `/production/orders/[id]/finish?batch=`. |
| `/warehouse/packs` "Boxing" | Menu → Operations → Boxing | Says "Nothing to box" while 12 labelled boxes exist. The order's box check is elsewhere. | Rename to "Box a batch (advanced)" or remove from the order path. |
| `/sales/picking` as the Home tile "Send out orders" | Warehouse Home | The tile name says send out but it opens the pick list. Packed orders waiting for the check or the truck are not on Home. | Three Home lines: To get from shelf · To check (second person) · To send out. |
| `/sales/dispatch` → `/sales/packing/[id]` for the second check | Menu → Send out → Check | The check of the box is hidden inside "Send out". | Give the check its own Home line and message to the second person. |
| `/sales/board` as the target of "Next: 1 customer order is past the promised delivery date" | Manager and sales Home | A board for a single late order. | Link to the order. |
| `/dashboard` "Production by stage · See every step" → `/operations` | Owner, manager, QA, sales Homes | This is the start of the "How work flows" page, but it is not the chain and not role-specific. | Replace with the page in C1. |

---

## (c) Ranked fix list

Ranks: **1 = breaks the chain or the data**, 2 = makes the next step invisible, 3 = slows or confuses. File paths are
for `dbef55e`.

| Rank | ID | Fix | Where (files) |
|---|---|---|---|
| 1 | C1 | **Second check accepted a box that was not picked and not for the order** and labelled it "approved over-shipment" without any approval. Refuse any box not on the pick list unless an over-shipment approval row exists for that order line. Never count beyond the ordered quantity silently. Show "548 of 500" as an error that blocks Finish. Integration negative test needed. | `src/modules/sales/packing.ts` (`overShipmentBox`, around lines 242–320: the refusal only fires when the total is already over), `src/app/(app)/sales/packing/[shipmentId]/page.tsx` |
| 1 | C2 | **One definition of "free stock".** `salesOrderShortfalls` counts released stock in any location (including the shipping area), while set-aside uses only `locations.kind = 'storage'`. As a result "Make for this order" disappears. Use the allocation rule. Also find why about 6,489 pcs sit in SHP after past shipments (seed or ledger). | `src/modules/production/production-orders.ts` (`salesOrderShortfalls`, "free" subquery), `src/modules/sales/allocation.ts` (line ~62), demo seed `src/db/seed.ts` / `src/db/seeds/*` |
| 1 | C3 | **Boxes made at Finish are invisible to the pick list and stay in the QA cage.** On QA OK, move each sealed box with its lot to the lot's shelf, list the boxes in Put away, set aside whole boxes first, and put boxes (BC:BOX) on the pick list. Finish creates the boxes "in the hold area" (ADR-104 as built) but nothing moves them later. | `src/modules/quality` (batch release), `src/modules/inventory` containers / put-away, `src/modules/sales/allocation.ts`, `src/modules/sales/picking.ts` |
| 1 | C4 | **Make for this order, visible to sales.** Sales sees the shortage card with "Ask the planner to make 378" (creates a message and a Home line for planners). The planner sees "Customer orders short" on Home and in production orders new. The production order keeps the sales order link. | `src/app/(app)/sales/[orderId]/page.tsx` (line ~63 `ctx.can("production.work_order.create")`), planner Home `getPlannerNext`, `src/app/(app)/production/orders/new/page.tsx` |
| 1 | C5 | **Equipment blocked after every batch with no reason and no fix on the floor.** Show the reason ("SC-01 needs cleaning after the last batch") and a "Record cleaning" button on the Weigh card and step 4, with the same audit as the equipment page. Do not hide the scale choice under More details when it blocks Save. | `src/app/(app)/production/orders/[workOrderId]/weigh/weigh-flow.tsx` (~line 416), `src/modules/production/execution-queries.ts` (`equipmentOptions`), `src/modules/masterdata/equipment.ts` (`deriveAvailability`) |
| 1 | C6 | **Finish vs box labels.** Step 6 must already subtract the retained samples (or ask for them), so the labels printed there are right first time. Pre-fill good bars from step 6. Ask wrappers once. | `src/app/(app)/production/orders/[workOrderId]/step/[n]` (packaging card), `src/app/(app)/production/[batchId]/finish/forms.tsx` |
| 1 | C7 | **Sack labels carry the whole-lot quantity.** Print the quantity per sack (lot ÷ containers, or typed per container), or leave it out. QA and the labelling reviewer must confirm. | `src/app/print/labels/receipt/[grId]`, receipt label template (LBL-RM v1) |
| 1 | C8 | **QA sample must exist before results, and stay recordable.** | `src/app/(app)/quality/inspections/[inspectionId]/page.tsx`, `src/modules/quality` |
| 2 | C9 | **Hand-offs as messages and Home lines**, modelled on "Coconut Oil lot is ready — put it on A-01". (a) PO sent → warehouse "Delivery coming on 8 Nov". (b) New lot → QA, opening the lot. (c) Second QA done → first QA. (d) Batch finished → QA. (e) Batch OK and the order can now be set aside → warehouse and sales. (f) Picked → the second person. (g) Checked → dispatcher. (h) Production order approved → assigned operator. | `src/modules/inventory/receiving.ts` (line ~724 `link: "/quality"`), `src/modules/sales/picking.ts`, `src/modules/sales/packing.ts`, `src/modules/quality`, `src/modules/production/production-orders.ts` |
| 2 | C10 | **Every chain screen ends with "Next: …" + one button to the next stage** (ADR-106 §5). Missing on: sack label print (→ "Leave in the QA cage; QA is told"), lot OK (→ "Lito puts it away"), put-away done, sales shortage (C4), batch OK (→ "SO-26-00015 can now be set aside"), proof of delivery (→ "Finance bills it: INV draft"). | the pages named in table (a) |
| 2 | C11 | **Procurement Home**: requests to order, orders to send, deliveries late. Purchasing out of "Management". | `src/ui/role-names.ts`, `src/app/(app)/dashboard/simple-home.tsx`, `src/app/(app)/nav.ts` |
| 2 | C12 | **Weighing second check in one place** (P8), and the order page "Next step" must show a waiting check before the next batch. | weigh flow, `/production/orders/[id]` next-step logic |
| 2 | C13 | **Warehouse Home**: To get from shelf · To check (needs a different person) · To send out · Proof of delivery missing. | warehouse Home in `src/app/(app)/dashboard/` |
| 2 | C14 | **QA lot page "Next"** must respect the separation-of-duties rule ("Teresa decides, you entered the results"), and lot vs batch rules must match. Rule values are QA configuration (A-flag for QA). | `src/modules/quality/rules.ts`, `src/app/(app)/quality/lots/[lotId]/page.tsx` |
| 2 | C15 | **One approval per purchase** (owner decision): an approved request becomes a PO without a second approval while within amount and supplier; the PO button carries `?request=`. The manager must see the amount he approves. | `src/app/(app)/procurement/requests/[id]/page.tsx` (line ~80), `src/app/(app)/procurement/orders/new/`, field masking for `site_manager` |
| 3 | C16 | Words: "released stock", "allocate", "Release is not possible while the lot is released", "Pass", "Open … from the action centre" (seeded and automatic messages), "200000 g", "line clearance" vs "clean-area check", "Exact words of the step setup", "MOV-26-000001", "Total 35000.00 PHP". | `src/modules/sales/allocation.ts`, `src/modules/quality/rules.ts`, `src/modules/action-centre/items.ts`, `src/modules/finance/invoice-at-dispatch.ts`, step-name `plainWords()` |
| 3 | C17 | Generic page titles ("Bryel's Care ERP") on request, PO, lot, QA queue and Home pages. | page `metadata` |
| 3 | C18 | Lot quantity typed by hand at pick/check must be accepted (P14). | `src/app/(app)/sales/fulfilment-forms.tsx` (line ~75 `value.startsWith("BC:LOT:")`) |
| 3 | C19 | Production order header ("4 batches made" vs "0 of 4 done"); Finish "Goes to: QA hold cage" vs actual FG-01. | `/production/orders/[id]`, finish forms |
| 3 | C20 | Demo seed: two people called "Tess" (`procurement@`, `warehouse2.nfd@`). Old demo batches on `without-order` addresses. | `src/db/seed.ts` |

### C0 — The "How work flows" page (ADR-106 §5)

One page under Operations, `/operations/flow`, readable on a phone, one row per stage. Each row shows the stage in
plain words, **who** does it, **today's count**, the **oldest item's age**, and **one button** to the screen where
that person does it. A row is red when the count waits on nobody (no message sent, see C9). Tapping a count shows the
items, each opening its own record.

| # | Stage (words on the page) | Who | Count shown | Button opens |
|---|---|---|---|---|
| 1 | Ask to buy | Anyone → manager | requests waiting for approval | `/procurement/requests?status=submitted` |
| 2 | Order from the supplier | Purchasing | approved requests not ordered; POs approved, not sent | `/procurement/orders?status=approved` |
| 3 | Delivery coming | Warehouse | POs sent: coming (with the nearest expected date, e.g. "1 coming (11 Nov)"), due today, late | `/inventory/receive` |
| 4 | Receive and label | Warehouse | receipts not finished; labels not printed | `/inventory/receive` |
| 5 | QA check of deliveries | QA (two people) | lots waiting; checks waiting for the second QA person | `/quality` (lots section) |
| 6 | Put away | Warehouse | lots OK in the QA cage or dock | `/inventory/receive/put-away` |
| 7 | Customer orders | Sales | confirmed; short (needs making) | `/sales?status=confirmed` |
| 8 | Make it | Planner → manager | customer lines short with no production order; production orders to approve | `/production/orders/new?salesOrderLine=…` / `/approvals` |
| 9 | Get materials · weigh · steps · pack · finish | Operator + second person | batches per step; batches blocked (equipment, check waiting) | `/production/orders` (My work) |
| 10 | QA OK of batches | QA | batches waiting for the QA check | `/quality` (batches section) |
| 11 | Set aside | Warehouse / sales | orders that can now be fully set aside | `/sales?status=confirmed&short=0` |
| 12 | Get from shelf | Warehouse | orders set aside, not picked | `/sales/picking` |
| 13 | Second check of the box | A different warehouse person | picked, not checked | `/sales/dispatch#check` |
| 14 | Send out | Dispatch | checked, not sent | `/sales/dispatch#ready` |
| 15 | Proof of delivery | Dispatch | sent, no proof | `/sales/dispatch#proof` |
| 16 | Invoice | Finance (two people) | delivered or sent, not billed; drafts to approve; approved, not saved to books | `/finance/invoices?status=draft` |

The same 16 stages should also be the stepper on each record (the customer order stepper today skips "Second check"
and "Proof"), and each stage's screen ends with "Next: <stage n+1>" (C10). The Home "Production by stage" card becomes
a link to this page.

**Built 6 Nov 2026 (see section (f)).** Buttons as built: stage 2 also counts purchase orders waiting for approval;
stage 5 opens `/quality#lots`, stage 10 `/quality#batches`; stage 7 also counts orders waiting for approval; stage 8
opens `/production/orders` (each short order in its list opens `/production/orders/new?salesOrder=…`); stage 9 counts
batches to start, being made, and waiting for a second person's check; stage 11 opens `/sales?status=confirmed`;
stages 13–15 open `/sales/dispatch#check|#ready|#proof`.

---

### C1–C8 as fixed (6 Nov 2026, ADR-110 "data rules first")

| ID | Status | What changed | Tests |
|---|---|---|---|
| C1 | **Fixed** | A box that is not on the pick list is refused at the second check (`NOT_ON_PICK_LIST`) and never counted, even before the order is full, unless a site manager approved an over-shipment for that line with room for the whole box; never past ordered + the approved extra; a box in the QA cage is refused (not on a shelf). "548 of 500 pcs are checked, 48 too many" shows in red and replaces "Finish the check"; the service refuses Finish too (`OVER_ORDERED`). | `tests/integration/sales/second-check-pick-list.test.ts` (red on the old code, green now), `tests/integration/sales/fulfilment.test.ts`, `tests/unit/e2e-chain-c1-c5.test.ts` |
| C2 | **Fixed** | One rule for free stock: `freeFinishedStock` (inventory module: released, in date, storage places, minus set-asides and reservations) is used by set-aside and by `salesOrderShortfalls`. The 6,489 pcs in SHP came from the **demo month seed** (`src/db/seeds/w3a.ts`), not the ledger (shipments post out of SHP correctly): its opening lots received 5,000–6,000 pcs each into the bay and shipped a few hundred. The opening lots now hold exactly what the month ships (bay ends at 0 for them). The month's released batch lots (1,934 ACS, 981 GBS at NFD) still sit in the bay so the demo rehearsal's FEFO is unchanged; they are not free stock (owner to decide, A-E2E-02). | `tests/integration/production/make-for-order.test.ts` (C2 block) |
| C3 | **Fixed** | Built on ADR-111 `moveBoxesWithLot`: QA OK (and reject, and a re-opened QA decision) moves the lot's boxes with its stock; a box holding two lots refuses the move ("Split the box first"); Put away lists boxes ("2 boxes (96 pcs) + 25 pcs loose") and moves them with the lot when no amount is typed; set-aside takes whole boxes first; the pick list asks for `BC:BOX` and the box scan is accepted at picking and at the second check. | `tests/integration/quality/boxes-follow-lot.test.ts` |
| C4 | **Fixed** | Sales sees "Not enough stock: it needs making" and **Ask the planner to make 378** (one message per planner, deduped, audited `sales.sales_order.make_requested`); sales cannot create the production order. Planner Home: **Customer orders short** with **Make it** (pre-filled, keeps `salesOrderId`). The production order header reads "For SO-26-00015 (Isla Spa Supplies)". | `tests/integration/production/make-for-order.test.ts` (C4 block) |
| C5 | **Fixed** | The weigh card (when no scale can be used, above Save, not under More details) and the step's equipment choice say why ("SC-01 needs cleaning after the last batch", "SC-02 calibration is overdue since 1 Nov") and offer **Record cleaning of SC-01** to people with `masterdata.equipment.edit` (same `recordServiceRecord` and audit as the equipment page). Calibration/maintenance: "Maintenance or the site manager fixes it (names)". `nextActors` has no maintenance hand-off, so the site managers are named. | `tests/integration/production/equipment-why.test.ts`, `tests/unit/e2e-chain-c1-c5.test.ts` |
| C6 | **Fixed** | Box labels on the packaging step default to expected − retained samples and say "QA keeps 2 bars as samples. Do not box them"; Finish pre-fills good = boxed + samples when no daily count exists. Wrapper counts written at the step were already shown at Finish with "Change" (asked once). | `tests/integration/production/box-labels-samples.test.ts` |
| C7 | **Fixed, QA to confirm** | Lot labels of a delivery in N sacks print the quantity per sack when it splits evenly ("3.75 kg each · sack 1 of 4"), otherwise no quantity ("Sack 1 of 4"); one container keeps the lot quantity; stored labels without a sack count render byte-for-byte as before. A-LBL-SACK-01. | `tests/unit/labels/sack-quantity.test.ts`, `tests/integration/inventory/sack-labels.test.ts` |
| C8 | **Fixed, QA to confirm** | Incoming-lot checks refuse results until a sample is recorded (`SAMPLE_REQUIRED`; the page says "Record the sample first"); the sample form stays while the check is open, also when it waits for review. A-QA-SAMPLE-01. | `tests/integration/quality/w2c-inspections-release.test.ts` ("incoming lot inspection") |
| — | **Fixed** (coordinator note) | A routing with a filling step and a packaging step: the packaging step no longer says "No wrappers or labels are recorded" when the filling step recorded them (recorded once). | `tests/integration/production/packaging-two-steps.test.ts` |

## (f) Status of the fixes (6 Nov 2026)

Branch `worktree-agent-a74afdca240ffb0c0` (UX/front-end slice of ADR-110). C1–C9 and C20 belong to other engineers.

| ID | Status | What was done |
|---|---|---|
| C0 | **Fixed** | `/operations/flow` "How work flows" (Operations menu): the 16 stages of the C0 table with who, counts, oldest age, one button; numbered cards on phones, a table from 1024 px; red with "Nobody was told" when an item waits that no message points to (A-FLOW-01); each number lists its records (`/operations/flow/<count>`). One read model `getWorkFlow` (current site, a count needs its own view permissions, one query per count). Home "Production by stage" links to it. The customer order stepper has "Second check of the box" and "Proof of delivery". Help: `docs/help/work-flow.md`. |
| C10 | **Fixed** (one part open) | Delivery page after labels: "Next: leave the sacks in the QA cage … QA is told" (+ "Open the QA check" for QA); the print screen itself (`src/app/print/**`) is not changed. Lot OK: "Next: put it away on A-01" (button for the warehouse, else names via who-can-do). Put-away done: next lot or "nothing else waits" (no movement number). Batch QA OK: "Next: SO-… can now be set aside" + "Open SO-…". Proof of delivery: "Finance bills it: open the invoice draft". Sales shortage (3c) is C4. **ADR-124 (7 Nov):** after the proof of delivery the delivery and the customer order follow the invoice (`billingStepOfShipment` / `billingStepOfOrder`, words in `src/lib/billing-step-words.ts`): no invoice or a draft → "Next: finance bills it" (+ "Open the invoice draft"); sent for approval → "The invoice is sent for approval. Waiting for Ana (owner) to approve the invoice" (`nextActors` "invoice", the same record as To approve, owner fallback of ADR-122); approved → "Next: finance saves it to the books"; saved → "Billed … Next: get paid". The Home splits "not billed" the same way (to make, waiting for approval, to save) and "How work flows" stage 16 already counts these stages (`not_billed`, `inv_draft`, `inv_to_approve`, `inv_approved`). |
| C11 | **Fixed** | Procurement Home: one next step + "Your buying work" (requests to order, orders to send, deliveries late, due today). Buyers find Purchasing under Operations (not only Management). |
| C12 | **Fixed** | Weigh screen: "Waiting for the second check of the weighing step" with "Open the check". The order's Next step shows a waiting check (or the check you can sign) before the next batch. |
| C13 | **Fixed** | Warehouse Home: To get from shelf · To check (needs a different person) · To send out · Proof of delivery missing, with counts and buttons; the misnamed "Send out orders" tile is gone for them. |
| C14 | **Fixed** (rule flagged) | Lot page: "Next: you entered the results, so another QA person says OK" with names (nextActors, people kept out never listed). Both rules (lot and batch) shown side by side from the configuration on the lot page and Check quality; values unchanged, A-QA-LOTBATCH-01 for QA. |
| C15 | **Fixed** (owner to confirm) | Server rule `requestApprovalCover` in `submitPurchaseOrder`: inside the approved supplier, items, quantity and amount the order is approved at once (request's approver recorded, audit `approved_by_request`); above the amount, another supplier, no supplier/estimate, more than requested or the approver making the order → normal approval. "Make the purchase order" carries `?request=` and the named supplier. Approvers see the total on the request and the order (A-PO-1APP-01/02). |
| C16 | **Fixed** (seed texts open) | Shortage message in plain words on screen; "Release is not possible while the lot is released" → "OK to use is not possible: this lot is already OK to use"; "Pass/Fail" → "OK to use/Not OK"; action-centre messages no longer say "from the action centre" (already seeded messages keep the old text until a demo reset); "200000 g" → "200 kg"; step buttons use the plain step names; "Exact words of the step setup" → "Words as written in the recipe steps"; no MOV number after put-away; invoice-draft message "₱35,000.00" and "Invoice draft ready: Isla Spa Supplies, DR-…". |
| C17 | **Fixed** | Titles: Home, Request to buy, Purchase order, QA check of a lot, Quality test, Check a batch or delivery, How work flows. |
| C18 | **Fixed** | A lot number typed by hand at pick and second check keeps the counted pieces (`scan-qty.ts`, unit test). |
| C19 | **Fixed** | Header "123 bars made so far · 1 of 4 batches finished" (or "378 bars expected · 4 batches"); body "1 of 4 finished · 0 of 4 decided by QA". Finish says the stock waits in the QA hold area and moves to the finished-goods shelf when QA says OK. |

### Round 5 floor fixes (8 Nov 2026, ADR-130 draft; `docs/ux-audit/round5/A-floor.md`)

| Stage | What changed on the path |
|---|---|
| Get materials | One short block per item (name and amount, shelf, lot …last 4 and how much is in it), the same numbers as Weigh, no stale "1 of 7 taken", "Container almost empty? Use a second lot", and the green button names the next step ("Next: Check the area is clean"). |
| Weigh | kg for 1 kg or more (grams stored), the lot shown once, Save under the keypad, "Saved: …" after each line; the operator goes on to the next ingredient while checks wait. No signal: queued on a phone that may work offline, else the typed values stay (never a full-page error). |
| Second person | Every check is on the checker's list **Waiting for you to check** (`/production/checks`): one card per batch of weighings (A-CHK-01), one per step, "Looks right" / "Not right" (tapped reason). The checker stays on the list. On the operator's phone only with the checker's own password (`production.sign_off.same_device`). |
| Steps | Plain sentences: "90 °C is above the 75 °C limit. Check again. If it is right, say why."; an empty required value is refused, nothing saved; tapped correction reasons; "Done — go to <next step>". |
| Label and pack | Work listed in order, one green button, piece and box labels on one print page (same size), QA samples get no label (A-LBL-SAMPLES-01). |
| Finish | It is the last step ("Move to the QA waiting area", step 7 of 7) in the step template; one Yes/No per packing item (counts open on "No"); an empty count is refused by the server; the success message is scrolled into view on the order. |
| Receive | Packaging may be received without an expiry date (A-RCV-EXP-01, setting). |
| Get from shelf / send out | Customer name as the title, each box once, a tap needs a tapped reason, "A box is missing" visible; the delivery receipt is printed (draft) before the truck leaves; the last driver and plate are filled in. |
| Problems | "Report a problem" on the batch record, each step and the lot page; the reporter sees "Sent to QA" and goes back. |

### Round 5 office fixes (8 Nov 2026, ADR-131; `docs/ux-audit/round5/C-office.md`, `B-owner-manager.md`)

| Stage | What changed on the path |
|---|---|
| What to buy | `/procurement/reorder` first lists what is short now: what open production orders still need (recipe minus set aside) plus the minimum to keep, minus free stock and what is coming. "Ask to buy N" opens the request filled in (item, kg or pieces, usual supplier, last price). The request shows supplier and price (no fold) and says what skipping the price costs. |
| Request → purchase order | One approval per purchase, as amended by the owner (A-PO-1APP-01): a request without a supplier is covered for any approved supplier; a top role's own approved request carries over to the order they make; only a higher amount than approved needs a second OK. Wizard: the price is a visible field on step 2 (from the request, the last order or the supplier price; a different price than last time is flagged), checked on Next in words with the item's name; "Arrives on" = the request's date or the next working day (never today or a Sunday); the banner says what the request really named and "change" keeps the request; step 4 says whether a second OK is needed. |
| Send to the supplier | Bug B1 fixed: the deferred same-person trigger no longer re-checks unchanged columns (migration 0041), so an order the owner made and approved alone can be sent, answered and received; email trouble is a note ("Sent. Email is not set up … print it"), never "Something went wrong". |
| Delivery problems | A short, damaged or wrong delivery messages purchasing and is listed under Buy & stock › Buying › Delivery problems (`/procurement/delivery-problems`): "The supplier sends the rest" / "Ask the supplier for money back" (finance is told) / "Not needed – close the rest" (the order line is short-closed). The message clears once decided. |
| Customer order | "Confirm the order" (not "Send"). A price offer's button is "Make a draft order". A confirmed order line can be changed or cancelled with the reason (sets aside less, never below what is sent; raising only before set-aside and within credit; in "What happened"). Header "Can ship from" (A-CANSHIP-01). "Make the missing N for this order" for planners; "Asked the planner on …" after asking; "Where is it now: 30 Acapulco Soap · in progress by Rhea, step 4 of 8 …, ready about 17 Nov". The step strip says "Set aside 70 of 100". Set aside asks first and names an earlier-dated order that needs the same stock (A-SETASIDE-ORDER-01). Printable and emailable order confirmation (`/print/order-confirmation/[id]`). A ₱0.00 line is stopped on Next. Customers with no credit limit: big orders wait for an OK (A-CREDIT-NOLIMIT-01). |
| Price offer / invoice "sent" | "Ready to give the customer" until it is emailed (Brevo, ADR-118) or printed and marked given; the invoice reads "In the books – not given to the customer yet". Invoices without a tax rate say "Tax: not set up yet – ask your accountant". |
| Invoice, payment | Below the owner's amount (A-FIN-1STEP-01, default ₱50,000) one finance person saves the draft to the books in one step. Payments read "Will pay on invoices or bills" and "Left over (kept on their account)" (B14). |
| Supplier bill | No default supplier or kind (B13); each delivery line in the order's unit with the order's price (25 kg at ₱185 per kg, never per g); a different price is flagged while typing. "Does not match" offers "I typed it wrong – change the bill" / "The supplier charged more" / "Accept the difference". Change the bill (draft or not matching); Fix a mistake (bill in the books: undo + copy in one step). |
| Month end | "Before you close <month>": deliveries not billed, deliveries without a bill, unfinished invoices, bills, payments, credits, claims, each a link. The current month only with "Close anyway (with the reason)"; a future month never. |
| Customers | New numbers keep the CUS-nnn shape (CUS-003 after CUS-002). "Already a customer?" while typing; saving needs "This is a different customer" when the phone, email or name matches. |

### Round 5 leftovers, part B (13 Nov 2026, ADR-133; flows and documents)

| Stage | What changed on the path |
|---|---|
| Finish (checker) | When the move-to-QA step needs a checker, Finish offers **"Send the counts to be checked"** (always; the only way while `production.sign_off.same_device` is off). The counts are checked like Finish (a dry run, rolled back), then wait as a card "Check the counts" on the checker's list `/production/checks` (also on their Home, and a message). The operator's Finish shows "Waiting for Jun or Dino to check the counts" with what was sent and "Take the counts back to change them". "Looks right" moves the batch to the QA waiting area in one transaction (operator = doer, checker = signer on their own session; a repeated tap answers once). "Not right" (tapped reason) goes back to the operator with the reason and a message. The operator never confirms their own counts; another site's checker never sees the card. With the setting on, "They are here (their password)" keeps working. |
| Weigh ("Other ways") | The advanced weigh form on the batch record sends how the lot was given: a typed number is refused while `scan.typed_code_counts_as_check` is off; a lot tapped in the list is confirmed like the main Weigh (`production.weighing.lot_confirm`). |
| Weigh with no signal | The queued weighing is built by `queuedWeighCommand` (the card's own function) and tested through the phone outbox and the server replay. |
| Proof of delivery | Save after a refused first try works: the signature is read from the box when Save is tapped, and the typed fields stay. |
| Production order | When the order fits one batch, the form offers one choice "Make it one batch · 1 batch of 100 bars" (no second, identical "Split into 1 batch"). |
| Recipe wizard | "Copy from this recipe" keeps the source's "How do you count one batch?" (pieces stay pieces). From a product of another piece size, packaging and steps that name the old size wait for an answer: "Leave it out", "Copy and change 135 g to 100 g" (steps), "Copy it anyway". |
| Trace | The export (CSV/XLSX) lists the orders a lot waits for (`direction = waiting`: set aside / taken off the shelf for order SO-…, customer, quantity), only at the viewer's sites. |
| Sales without invoice access | With `sales.show_invoice_stage_without_invoice_access` off, a billed order reads "Sent out" on the list, the page, the board, the customer's history and the counts, and Home's recent activity leaves out invoice events. |
| Customers | The import asks about a row with the same phone or email as a customer ("possible duplicate"), warns on twin rows in one file and does not load the second one (reason in the report). |
| Delivery receipt | Renderer v2 prints the product name first and the code small after it. Receipts issued on v1 keep printing (and re-render) with v1; a template moves to v2 only through a new version QA approves (Set-up › Layouts › "Start a new version with the newer layout"). The demo data approves v2. The boxing note's product reads name first. |

## (d) Taps and screens per role (one order through the whole chain)

| Role | Distinct screens visited | Taps on the happy path | Detours that cost time |
|---|---|---|---|
| Procurement (Tess) | 7 | ≈20 (9 request + 8 PO + 3 send) | Menu → Management → Purchasing every time. |
| Site manager (Dino) | 6 | ≈8 (request 3, PO 3, production order 2) | Home count 0 vs 11 (old code). |
| Warehouse (Lito) | 10 | ≈56 (receive 8 + labels 3 + put away 3 + set aside 3 + pick 12 + send 6 + proof 3, plus messages and menus) | No lot labels for finished goods: typed 5 lot numbers and 5 counts. Reopened an old message to find the order. |
| Second warehouse person | 6 | ≈16 | 4 screens searched to find the check. The wrong-box detour (find "Take off…") added 4 taps. |
| QA (Nina) | 7 | ≈12 incoming + ≈40 for 4 batches (10 each) | Lot hidden 9th in the queue. Blocked from the decision after doing the work. |
| QA lead (Teresa) | 5 | ≈6 | — |
| Sales (Mara) | 4 | ≈11 | Dead end at "378 short". |
| Planner (Cora) | 6 | ≈6 | Had to be told by phone; order not linked. |
| Operator (Rhea, with Jun) | 14 (+ master data) | ≈85–95 per batch, ≈350 for 4 batches | Second check only on `/step/2`; scale and mixer cleaning on master data before each later batch (≈6 taps × 2 per batch); relabel at Finish (6 taps); lot split on `/weigh/more` (≈10 taps). |
| Finance (Rosa + Ben) | 3 + 2 | ≈9 (3 + 3 + 3 with password) | — |
| **Whole chain** | **≈45 distinct screens** | **≈530 taps** (≈350 on the floor) | — |

---

## (e) Not walked, caveats, risks, next steps

**Completed and evidenced:** every stage from request to buy to invoice issued, with real records (section 0).

**Not walked:**
- Customer payment.
- An order needing approval (credit hold).
- A QA "not OK".
- Offline/scanner-camera paths. Scans were keyboard-wedge events only.
- Batches 2–4 were run by the same scripted taps as batch 1, with screenshots at key points only.

**Caveats:**
- The code changed four times during the walk (section 0). Production findings P8–P11 were seen on `08194ff`/`4cd16c4`. Stages 5b–5f were seen on `dbef55e`.
- Re-check C5, C6, C12 and P10 on `dbef55e`, where ADR-104/106 "as built" changed the weigh card and the pick plan.
- The manager-Home approval count was already fixed by ADR-107 during the walk.
- The dev server restarted itself often (memory), so a few "no navigation" moments were retried. They are not counted as app faults.

**Data risks to raise with the owner and QA:**
- C1, over-shipment without approval: the shipment could have carried 48 extra pieces from a box still in the QA cage.
- C3, boxes recorded in the QA cage after release.
- C7, sack labels with the wrong quantity.
- C8, QA results without a sample.

**Next steps:**
1. The fulfilment engineer fixes C1–C3 with integration negative tests.
2. The production engineer re-checks P8–P11 on `dbef55e` and fixes C5, C6 and C12.
3. The UX lead builds C0 and C9–C13.
4. The owner decides C15 (one approval per purchase).
5. QA confirms the label quantity (C7) and the sample rule (C8).
