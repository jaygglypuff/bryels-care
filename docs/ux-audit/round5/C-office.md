# Round 5 usability audit C: office staff (sales, purchasing, finance, QA)

| | |
|---|---|
| Asked by | Owner, 2026-11-08: "Imagine you are an operator, owner, manager that is not very literate with computers, hence initial using is very difficult, including navigation." |
| Persona | A junior office clerk who knows basic Excel and Facebook and has never used an ERP. Gets interrupted often. Works on a 1366 × 768 laptop, sometimes on a phone. |
| Method | A production build at `http://localhost:3583` on a fresh small demo (`docs/demo-script.md`). Every task started at sign-in with no prior knowledge, using real clicks in Playwright at 1366 × 768, plus 390 × 844 (touch) for the phone checks. Real records were made: customers CUS-0001 and CUS-0002, quotation QT-26-00001, orders SO-26-00003 and SO-26-00004, request PR-26-00001, purchase order PO-26-00003, a short and damaged delivery GR-26-00005, QA decisions on B-26-0002, L-2611-00019 and L-2611-00018, problem report DEV-26-0001, delivery SH-26-00001, invoice INV-2026-000001, payment PAY-26-000001 and supplier bill BILL-26-00001. No code was changed. |
| Accounts | `sales@` Mara, `procurement@` Joy (the sign-in list calls the job "Buying"), `finance@` Rosa, `qa.nfd@` Nina, plus `manager.nfd@` Dino, `owner@` Ana and `warehouse.nfd@` Lito for the hand-offs. |
| Evidence | Screenshots are in the session scratchpad `novice/C/` (`NNx-name.png`); file names are quoted below. The scratchpad is not kept, so re-run the steps to see them again. |
| Earlier rounds | Checked again and confirmed fixed: menu words match screen titles; a "?" help button on every screen; one "What to do next" box per record; names before codes in lists; the PO wizard carries the request; the hand-off from purchasing to manager to purchasing; "Ask the planner to make N" on a short order; Ctrl K master search. Still open from `END_TO_END_FLOW.md`: the delivery-received stepper ("Not finished (done) · Saved to stock (current step)", 2b) and the damaged-goods hand-off. |

---

## Summary: can a novice clerk do each task alone?

| Task | Verdict | In one line |
|---|---|---|
| 1 Sales: customer → quote → order → ship date → change | **With help** | Adding a customer and a quote works. But **"when can it ship?" has no answer**. Once the order is sent it **cannot be changed and no single line can be cancelled**: the screen says to cancel it and type it again. |
| 2 Purchasing: what to buy → request → PO → send → follow up → short/damaged | **With help** | Nothing tells her **what to buy** ("Running low" is empty and nothing is linked to orders). A required price is hidden under "(you can skip this)". Damaged goods **never reach purchasing**. |
| 3 Finance: invoice → send → payment → bill → who owes → month end | **With help** | The steps are guided, but each invoice and each payment needs 4 steps and 2 people. **"Sent" means saved, not sent.** The supplier bill asks for the **price per gram**, so a ₱5,450,000 bill was saved. A typo on a bill cannot be corrected, only cancelled. |
| 4 QA: batch → material → hold → problem report → trace | **Yes, with small stumbles** | This is the best area. One hidden required field wipes the clerk's choice. Damage reported at the dock does not show in QA's queue. There are 24 stale messages. |
| 5–6 Navigation, finding things and fixing mistakes | **With help** | Finance and purchasing are split across two or three menus. Messages never clear when the work is done. Search does not find "order 4". Mistakes are caught late (on the last step) or explained with codes. |

---

## 1. Sales (Mara): a new customer phones

| Step | Where | Clicks + fields | What happened (hesitations quoted) | Shot |
|---|---|---|---|---|
| Home | `/dashboard` | 0 | Home has **no "New customer order" or "New customer" button**. "What to do next: Nothing waits for you." The card says "Sales today 2 orders · **Values hidden for your role**", yet the order list one click away shows ₱8,880.00. "Needs your attention: 1 finished batch waits for the QA check" is not her job. "Waiting for your approval 0" is shown in alarm pink. | `01-sales-home` |
| Find customers | Sales & Customers → Customers | 2 | Easy. The list mixes `CUS-001` / `CUS-002` (seed) with the new `CUS-0001` / `CUS-0002` (see bug B1). | `03-customers` |
| Add customer | `/sales/customers/new` | 1 + 4 fields + Save = **6** | A good form with only 4 visible fields. Empty Save shows the browser's "Please fill out this field". **Duplicate test:** "Luntian Wellness Store" with the **same phone** as "Luntian Wellness Stores" was saved with **no warning**. Both now appear in every customer picker. The new customer silently got "Wants at least 180 days before expiry", and a blank credit limit, which later reads "Credit check: **Not needed** for this customer" (unlimited credit). | `05a`, `05c-dup-saved`, `08a` |
| Quote | Quotes, prices & returns ▸ Price offers → New price offer | 3 to reach + customer (2) + product (2) + qty + price + Save = **11** | The page says "the usual prices fill in", but the demo has **no prices at all** ("No prices yet", `09a-prices`). So the error is "No approved price for this customer and product. Enter the quoted price." The clerk asks: "approved by whom? what is the usual price?" The date box shows `12/08/2026` (month/day): is that 12 August or 8 December? | `08d-quote-saved`, `09a-prices` |
| "Send" the quote | `/sales/quotations/…` | 1 | "Send the price offer" took about 2 s with **no busy sign**. Then the status read **"Sent to customer", but nothing was sent**: no email and no PDF. "Print" only appears after this step. The clerk believes the customer has it. | `10b`, `11a-after-send`, `12a-quote-print` |
| Make it an order | same page | Deliver by + PO no. + 1 = **3** | Clicking without a date did nothing visible (the browser bubble only). With a date it went to SO-26-00003, which is a **Draft** with "Draft saved." The clerk thinks "I said make it an order!" Next is a **second** "Send the order": "Send" again, and it does not mean sending. | `12b`, `13a-order-from-quote` |
| Confirm | `/sales/[id]` | 1 | "Order confirmed. The warehouse can now set aside the stock." The green button offered **to sales** is "Set aside the stock": whose job is it? The help panel says "press **Confirm order**", but the button is "Send the order" (bug B5). | `14a-order-sent`, `16a-order-qmark` |
| When can it ship? | same page | — | **No date anywhere.** "Stock is coming for this order: coming: 30 being made · nothing needs making" and "Quality check WO-26-00002 / Approved WO-26-00004" (production order codes, no dates). The clerk cannot tell the customer anything. There is **no order confirmation to print or email**. | `14b-order-sent-full`, `24a-isla-order` |
| New order from scratch | `/sales/new` | customer 2 + date 1 + Next + 2 products × (2 + qty) + Add + Next + Save + Send = **≈ 15** | Steps 1→2→3 let a **₱0.00 order** through to "Check the order" (Order value ₱0.00). The price error only appears after "Save the order", which jumps back to step 2. The ₱72 quoted to the same customer an hour earlier is not remembered. A typed price is labelled "(price changed by hand)" although no usual price exists. There are **two green buttons**: "Set aside the stock" and "Ask the planner to make 12". | `19b-check-no-price`, `20a-save-zero-price`, `21b-order2-confirmed-full` |
| Ask planner | same page | 1 | "Asked: 3 planners told…" is good. But the green button **stays** clickable, and Home **still** says "Next: 1 customer order is short of stock: ask the planner to make it" (bug B11). | `22a-ask-planner`, `25-search-bayanihan` |
| Change the order / cancel a line | ⋯ More | — | **Not possible.** More has only "Cancel order". `/sales/orders/[id]/edit` says "Only a draft can be changed. If the customer changed their order, cancel this one … and enter a new one." Cancelling one line therefore means retyping the whole order and losing any stock already set aside. | `21c-order2-more`, `23a-edit-confirmed` |
| Phone | 390 × 844 | — | No sideways scroll. The phone shows **two menus**: a ☰ at top left and "Menu" in the bottom bar. The tab row is cut ("Customer orders · Customers · O…"). | `69a`, `69c`, `69f` |

**Count:** customer 6 + quote 12 + order 4 = **22 actions** on the happy path, with no ship date and no confirmation to send. Changing one line means retyping the order: **+15**.

## 2. Purchasing (Joy): what to buy, request, PO, send, follow up

| Step | Where | Clicks + fields | What happened | Shot |
|---|---|---|---|---|
| Home | `/dashboard` | 0 | "Nothing waits for you. Ask to buy something when stock runs low." **It does not say what is low.** Messages show 2 NEW "Purchase order approved · Send it to the supplier" for POs **already sent / delivered** (bug B10). | `33b-purch-home-full`, `34a-purch-msgs` |
| Find what to buy | Operations ▸ Purchasing → Running low | 2 | "Nothing here. No item has a minimum yet." "Sales guess: No sales history yet." Nothing links the 12 lotion short on SO-26-00004 to bottles or ingredients. **A dead end; the clerk has to guess.** | `35b-reorder`, `34d-forecast` |
| Where is Purchasing? | menus | — | Joy finds it under **Operations ▸ Purchasing**. Rosa finds it under **Management ▸ Purchasing**. The page then shows a **third** navigation: a row of 9 chips ("Purchasing home · Requests to buy · …") under the sub-menu bar. On a record page that chip row sits *between* "What to do next" and the content. | `34b-purchasing`, `28a-fin-management`, `45b-po-sent` |
| Request | Ask to buy something | pick + qty + why + Save + Send = **5** | Clear, and the unit changes to pcs. **"Supplier or price you know (you can skip this)"**: skipping it later costs a **second manager approval**. The PO page says so: "No supplier or price was named on the request, so the order goes to the manager for approval." | `36a`, `38a-request-for-buyer` |
| Manager approves | To approve | 2 | Fine. No money is shown on the request. | `37b` |
| Make PO | "Make the purchase order" | supplier 1 + Next + date + Next + Save = 5, **+4 to recover** | The supplier list does not say who sells bottles or what they charged last time. The banner says "Supplier Manila Print & Pack, **as named on the request**" (it was not). Price sits under **"A different price (you can skip this)"**, yet it is required. Step 4 shows "price on save / worked out on save", then fails with **"Line 1: enter the unit price (no supplier price is recorded for MAT-0011 per pcs)"**, although PO-26-00001 bought the same bottle from the same supplier at ₱9.00. "Arrives on" defaults to **today (a Sunday)** although the request said 15 Nov. The same screen says both "needs no second approval" and "Save and send for approval … asks the manager". | `40a-po-items`, `41a-po-when`, `42z-after-save` |
| Manager approves PO | | 2 | Second approval for the same 500 bottles. | `43c-po-manager` |
| Send | PO page | 1 | "Email the order to orders@sup-0003.test" is ticked by default. That is good, but afterwards the page only says "Sent to the supplier." and **does not confirm an email went out**. A ₱9.50 price against last time's ₱9.00 got no warning. | `44a`, `45b-po-sent` |
| Follow up | ⋯ More | — | "The supplier answered" (their order number, promised date) is **hidden in More**, next to "Close" and "Cancel". | `45a-po-more` |
| Short + damaged delivery | warehouse receive, then PO | — | The warehouse typed 1,500 of 2,000 wrappers and 480 bottles marked "Damaged: 20 bottles cracked". The PO shows "here 480 · still to come 20". **Purchasing gets no message, no Home line and no "damaged" mark.** The damage goes to the owner or manager to "Accept the problem" (`51b-receipt`). "Send back to supplier" only takes "lots that QA marked Not OK", so there is **no path to claim credit for damage**. The clerk asks: "Do I order 20 more? Will they send them? Who calls the supplier?" | `48a-received`, `50a`, `50c-po1-after-short`, `51a-returns` |

**Count:** request 5 + approval 2 + PO 9 (+4 recovery) + approval 2 + send 1 = **19–23 actions and 3 people** for one line of bottles.

## 3. Finance (Rosa)

| Step | Where | Clicks + fields | What happened | Shot |
|---|---|---|---|---|
| Home | `/dashboard` | 0 | Before the delivery: "Nothing needs you right now", with Sales today, a sales chart and "Production by stage". It has **no money owed, no bills to pay and no late customers**. Those are on **Management ▸ Finance ▸ Money** (`/finance`), which is a much better finance home (`29a-money`). After a delivery: "Next: 1 delivery is not billed yet. Make the invoices" (good). | `27b-finance-home-full`, `62a` |
| Where things are | menus | — | Invoices, payments, statements and credits are under **Sales & Customers ▸ Billing & payments**. Bills, close the month and tax are under **Management ▸ Finance**. Expense claims are under **Home**. The Management page says it outright: "Customer invoices are under Sales & Customers; expense claims under Home." | `28a-fin-management` |
| Invoice | message or Home → invoice | 2 | The draft is pre-filled, which is good. **Tax ₱0.00** sits under "Change the tax or the note"; the only choice is "No tax" (configuration for the accountant, not judged here). There is **no preview or print before sending**. | `63b-invoice-draft-full`, `64a` |
| Approve + book | Send for approval → owner approves → Save to the books + password | 1 + 3 (owner) + 3 = **7, 2 people** | The owner must approve a ₱3,360 invoice. After "Save to the books" the status is **"Sent – not paid yet", but nothing was sent**. Print is in ⋯ More; there is no email. | `64b`, `65a`, `65b-invoice-issued` |
| Payment | "Record a payment" | method + Save + Send for approval (+ approver 3 + book 2) = **3 + 5** | Good defaults: amount, date and invoice are pre-filled. The saved payment then says "**Amounts chosen by hand**", "Used ₱0.00 · **Kept for later ₱3,360.00**", which reads as if the payment did not pay the invoice (bug B17). | `66a`, `67a-payment-saved` |
| Supplier bill | Management ▸ Finance ▸ Supplier bills → Enter | supplier + delivery + bill no. + 2 prices + Save + Check = **7** | The supplier **defaults to the first name** (Laguna Botanicals). Deliveries are named only "Delivery of 08 Nov 2026 (GR-26-00004)". Items show **"How many (g) 25000 · Price per g (₱)"** and the PO price (₱185/kg) is **not pre-filled**. A clerk typing the per-kg price got **₱5,450,000.00** and Save accepted it. "Check against order" then caught it ("Does not match"), but advises "**Ask the supplier for money back**" when the mistake is ours. ⋯ More offers only "Cancel the bill": **a typo cannot be corrected**. The "kind" field defaults to "utilities" behind a fold. | `31b`, `32a`, `70a-bill-filled`, `71a-bill-checked`, `72a-bill-more` |
| Who owes us | Money / Customer statements | 1–2 | Good: "Money customers owe us ₱3,360.00", ageing buckets, and one line per customer on statements. | `68a`, `68b` |
| Fix a posted invoice | invoice ⋯ More → credit | 4 | The reasons are clear ("Pricing or quantity error on the invoice"). But the clerk must **work out the money herself** (48 × the price difference). Nothing re-issues a corrected invoice, and the credit needs a second person too. | `68d-credit-new-full` |
| Month end | Close the month | — | Every month says "**All papers dated this month are finished**", even November, which has confirmed orders not yet shipped. "Close this month" is offered on the **current** month. There is **no checklist** (deliveries not billed, bills not entered, payments in draft). | `29f-periods`, `30b` |

**Count:** invoice 9 + payment 8 = **17 actions and 2 people per sale**. Bill 7 (+ cancel and retype on a typo).

## 4. QA (Nina)

| Step | Where | Clicks + fields | What happened | Shot |
|---|---|---|---|---|
| Home | `/dashboard` | 0 | "Next: 1 thing waits for your decision. **Open To approve**". The QA queue (1 batch + 3 deliveries) is a smaller link below. Sales today and a sales chart are on QA's home. The bell shows **24 unread**, most about things already decided. | `52b-qa-home-full`, `53d-qa-msgs` |
| Check the batch | Check a batch or delivery → Check this batch | pH + "Is it OK?" + **Observation** + Save + tick + OK to use + Yes = **7** (+3 recovery) | "Observation" looks optional, but Save fails with "Describe the observation." (shown twice). **The "Is it OK?" choice resets to "Not tested yet"** (bug B4). After OK: "Next: SO-26-00002 (Isla Spa Supplies) can now be set aside", an excellent hand-off. Tab order is correct. | `55a`, `55b-qa-results-saved`, `55f` |
| Check a received material | lot page | reason + OK = **2** | The lot page shows both "Start the quality check" and "Decide now" (two paths). Wrappers were OK'd with no test and no supplier paper. That is allowed by the configured rule, but the screen does not say what QA is expected to look at. The put-away hand-off names "Ana, Dino or **Jun (operator)**" and **not Lito (warehouse)** (bug B18). | `56b`, `57a-qa-lot-ok-direct` |
| Damaged lot | QA queue | — | The bottle lot reported "20 cracked" shows in the QA queue as just "Waiting for QA check" with no damage mark (it does show on the lot page). | `53c-qa-queue-full` |
| Hold | lot page | radio + reason + button = **3** | Clear. The success line "Saved: lot … is stopped by QA" appears **next to the button at the bottom**, not at the top. | `57c-qa-hold-done` |
| Problem report | lot ⋯ More → Report a problem | text + Send = **2** | Excellent short form. The next screen says "**You raised this deviation**" (jargon) and shows severity as raw `minor / major / critical`. It also says "No stock was stopped for this report" although the lot is on hold (not linked). | `58a`, `59b-problem-sent-full` |
| Trace | Quality ▸ trace | name + pick = **2** | Very good: back to supplier lots, forward to the orders it waits for. The quick list says "newest first" but starts with L-2611-00002. | `60b`, `60d-trace-soap-full` |

## 5. Navigation and finding

- **Menus per role (1366 px):** sales gets Home · Operations · Inventory · Sales & Customers · Management. Finance gets Home · Operations · Sales & Customers · Management. Purchasing gets Home · Operations · Inventory · Management. QA gets all five plus a "More" overflow in the Operations sub-bar. Each office role sees whole areas it never uses (Operations for sales and finance; Sales for QA).
- **Purchasing appears in two places** (Operations for Joy, Management for Rosa) and has its own chip row. That makes three navigation levels on one screen (`34b`).
- **Top-bar icons have no words at 1366 px** (search, cloud, a checklist icon for To approve, bell, ?). A novice will not guess the cloud icon (sync) or the checklist icon (To approve).
- **Two help buttons** on record pages: the frame "?" and a second "?" in the record header (Playwright found two "Help for this screen" buttons on the order page).
- **Two sub-menu drop-downs can be open at once** (`03c-billing-dd`).
- **Search (Ctrl K)** finds names ("bayanihan", "luntian") and full number tails ("00004"). It does **not** find "4", "SO 4", "order 4", "pasig" (address), "new customer" or "make order" (actions). Sales sees noise such as "Set aside · Acapulco Leaf Extract RSV-26-000004 · converted" and "Document · label DOC-26-0000004". The first Ctrl K on a freshly loaded Home was ignored once (not reproduced).
- **Keyboard:** no "Skip to content" link. It takes **17 Tab presses** to reach the first field of a new order, and no page focuses its first field. Enter on the date moves to the next wizard step (good). Pickers accept typing and Enter (good).
- **Getting back:** "‹ Customer orders" links on every record are good. But after a form, some pages open **scrolled down**, so the title is hidden (`05c-dup-saved`, `20a`).
- **Messages never clear**, so they stop being read: Joy has 4 NEW, of which 3 are already done; Nina has 24.

## 6. Mistakes

| Mistake | How the app guides the clerk | Verdict |
|---|---|---|
| Wrong price on an order (₱0 / forgot) | Caught only after "Save the order" on step 3, then bounced to step 2 | Late, but clear |
| Wrong price on a PO | Error on step 4 with item code MAT-0011; the field is on step 2 inside "(you can skip this)" | Poor |
| Wrong unit price on a supplier bill (kg vs g) | Saved as ₱5.45 m; caught by "Check against order"; the advice blames the supplier; cannot correct, only cancel | Poor |
| Wrong quantity on a confirmed order | Impossible; cancel and retype | **Blocker** |
| Duplicate customer | No warning; both show in every picker; their numbers differ only by one zero (CUS-001 / CUS-0001) | **Blocker** |
| Posted invoice wrong | A credit with clear reasons, but the clerk calculates the amount; a second person approves | OK, but heavy |
| QA test result typo | "Ask to correct this result" next to each result | Good |

---

## Top 15 problems, ranked by impact

1. **A confirmed customer order cannot be changed and no line can be cancelled** (`/sales/orders/[id]/edit`, `23a`).
   *Experience:* the customer phones to drop the lotion; the clerk must cancel and retype everything and lose the stock already set aside.
   *Why:* the order state machine allows edits only in Draft.
   *Fix:* on a confirmed order, give each line in "What they ordered" a ⋯ menu with **"Change how many"** and **"Cancel this line"** (reason required). Then:
   - Lowering a quantity or cancelling a line is allowed until that line is taken off the shelf. Its set-aside stock is released, and the change is logged as an amendment (actor, time, reason).
   - Raising a quantity or adding a product is allowed only until set-aside and re-runs the credit check.
   - Remove the sentence "cancel this one … and enter a new one".

2. **"Send" does not send** (quote "Send the price offer" → "Sent to customer"; order "Send the order"; invoice "Save to the books" → "Sent – not paid yet").
   *Experience:* the clerk tells the customer "it's in your email". Nothing went.
   *Fix:*
   - Make the next-step button on a quote and on a booked invoice **"Email to <customer e-mail>"**, with a ticked box and a **"Print"** button beside it, the same pattern as the PO ("Email the order to …").
   - Status words: quote **"Ready to give the customer"**, then "Given to the customer on <date> (email / printed)". Invoice **"In the books – not given to customer yet"**, then "Given to the customer".
   - Rename "Send the order" to **"Confirm the order"**, and make "Make it an order" on a quote confirm directly (one step, no Draft) when the credit check passes.

3. **No ship date for the customer** (order page "Stock is coming…", `14b`, `24a`).
   *Fix:* in the header under "Deliver by", add one line: **"Can ship from: <date>"**, worked out from stock on the shelf (today), batches waiting for QA (expected QA date) and production orders (planned finish + QA days, configurable). If nothing is planned, show "Can ship from: not known – the planner has been asked". Add **"Print order confirmation"** / **"Email order confirmation"** with that date.

4. **Finance work is spread over three menus, and finance Home is the wrong page** (`27b`, `28a`).
   *Fix:* give finance one top-level menu **"Money"** with: Invoices · Payments · What customers owe (statements) · Supplier bills · Money back (credits) · Close the month · Tax rates. Take Billing & payments out of Sales & Customers for the finance role (sales keeps a read-only "Invoices" entry). Make the **Money page (`/finance`) finance's Home**, with "What to do next" on top. Remove Sales today, the sales chart and Production by stage from finance Home.

5. **Purchasing is told nothing about what to buy** (`35b`, `34d`).
   *Fix:* make "Running low" into **"What to buy"**, listing for each material:
   - free stock;
   - what approved production orders and short customer orders need in the next N days;
   - what is already coming.

   Each row gets one button, **"Ask to buy N"**, which pre-fills supplier and last price. Purchasing Home's "What to do next" names the top shortage ("Lotion Bottle 250 mL: 12 short for SO-26-00004 → Ask to buy"). Until minimums exist, say so on Home, not only inside the page.

6. **Messages never clear when the work is done** (`34a`, `53d`: 24 unread for QA).
   *Fix:* when the thing a message points at moves past the step the message asked for, mark it **"Done by <name>"**, take it off the badge and move it to history. Badge count = only messages still needing that person. Remove "Mark read" and "I'm on it" from done messages.

7. **Supplier bill in grams with no PO price, and a typo cannot be fixed** (`70a`, `71a`, `72a`).
   *Fix:*
   - **Pre-fill each line with the PO price and the PO unit** (per kg, per pcs); show the quantity in the PO unit (25 kg, not 25,000 g).
   - Check the bill against the order **while typing** (amber text under the line: "Order price ₱185.00 per kg – yours is ₱180.00").
   - Add **"Change the bill"** while it is Draft or "Does not match".
   - Replace "Ask the supplier for money back" with three choices: **"I typed it wrong – change the bill" / "The supplier charged more – ask them for money back" / "Accept the difference (reason)"**.
   - Default the supplier to empty ("Choose…"), never to the first in the list.

8. **The required price is hidden under "(you can skip this)" in the PO wizard; errors come on the last step with item codes** (`40a`, `42z`).
   *Fix:*
   - Show **"Price each (₱)" as a normal visible field** on step 2, pre-filled with the last price from this supplier ("Last time ₱9.00 on PO-26-00001").
   - Validate on "Next" of step 2, in words ("Type the price of Lotion Bottle 250 mL").
   - Default "Arrives on" to the request's "Needed by" date or the supplier lead time, never "today".
   - Remove the false "as named on the request" and the contradictory "needs no second approval" when it does need one.

9. **Two approvals for one purchase; two people and four steps for every invoice and payment** (`38a`, `64b`, `67a`).
   *Fix:* these are owner policy (ADR-110 C15 promised one approval per purchase). Make them **settings with thresholds** under the owner-editable settings (ADR-126):
   - "PO needs approval above ₱ ___ or when it differs from the approved request".
   - "Invoice needs a second person above ₱ ___ / when the price differs from the order".
   - "Payment needs a second person above ₱ ___".

   Below the threshold, one person does it in one step ("Save to the books" straight from the draft). On the request form, move "Supplier and price" out of the fold and say what skipping costs: "Without a supplier and price, the purchase order needs the manager again."

10. **Duplicate customers are not caught, and two number formats coexist** (`05c`, `69f`, bug B1).
    *Fix:* while typing the name or phone on New customer, show **"Already a customer? Luntian Wellness Stores · +63 917 555 0101 · Open it"** for a matching phone or a similar name (case, plural, punctuation ignored); require a tick "This is a different customer" to continue. Make the seed and the number sequence use one format.

11. **Damaged and short deliveries never reach purchasing; there is no claim path** (`50c`, `51a`, `51b`).
    *Fix:*
    - A receipt problem (Damaged, Less than ordered, Wrong item) sends purchasing a message, and shows **"20 damaged – decide"** on the PO line, with three buttons: **"Supplier will send 20 more" / "Ask supplier for money back" / "Not needed – close the rest"**.
    - Allow "Send back to supplier" for damaged stock without a QA Not-OK.
    - On the receive screen, add a **"How many were damaged?"** number next to "Problem: Damaged" so the clerk does not have to decide between typing 480 and 500.

12. **Pages show other people's work and other people's buttons** (sales Home "1 finished batch waits for the QA check", sales order green "Set aside the stock" and Home "2 customer orders can now get their stock set aside"; QA and finance Homes show Sales today; `01`, `14a`, `69a`).
    *Fix:*
    - Home "Needs your attention" shows only items the role can act on.
    - On a customer order, sales sees **"Waiting for Lito (warehouse) to set aside the stock"** (the ADR-109 hand-off pattern), not a green button, unless sales really owns set-aside (owner to decide; then say so in the help).
    - One green button per page: "Ask the planner to make 12" becomes a white button. Once asked, it turns into the text "Asked Cora (planner) on <time>".

13. **Required fields that look optional, and errors that wipe choices** (QA "Observation" `55b`; receive "Expiry date" for wrappers and bottles `48a`; quote and order date).
    *Fix:*
    - Mark required fields with "(needed)" and optional ones with "(you can skip this)". Never hide a required field in a fold.
    - Keep every value after a server error (the "Is it OK?" select reset).
    - Make expiry **optional for packaging** (item setting "has an expiry date", default no for wrappers, boxes and bottles).
    - The QA Observation is required only when "No, not OK" is chosen.
    - Scroll the first invalid field into view **below the sticky header** and show the message in words under it, not the browser bubble.

14. **Month end has no checklist and says everything is finished** (`29f`, `30b`).
    *Fix:* above "Close it", show **"Before you close October: 0 deliveries not billed · 0 supplier bills not entered (deliveries received without a bill) · 1 payment in draft · 0 invoices waiting for approval"**, each a link. Make "Close this month" for the **current** month a white button behind "Close anyway (reason)". Replace "All papers dated this month are finished" with the real count.

15. **Search does not find what a clerk types; the frame is icon-only** (`25`, `26`; top bar).
    *Fix:*
    - Search: match short numbers ("4", "SO 4", "order 4" → SO-26-00004), addresses and contact names. Add **actions** ("New customer", "New price offer", "Record a payment", "Enter a supplier bill") to the screen list. Hide set-asides, documents and labels from roles that do not use them.
    - At 1366 px, show words beside the icons ("Search", "To approve", "Messages", "Help"), and move the sync cloud into the user menu unless something is waiting to sync.
    - Remove the second "?" in record headers.

---

## Navigation proposal per office role (home + menu, plain words)

The rule: **every office role gets one Home with its own "What to do next", plus only the top menu items it uses.** Words are the screen titles. Anything else stays reachable through search and links, not menus.

### Sales (Mara)
- **Home "Sales"**:
  - "What to do next": orders waiting for her (drafts, approvals sent back, short orders not yet asked, quotes about to expire, orders late against "Can ship from").
  - Two big buttons: **New customer order** and **New price offer**.
  - Cards: Orders today · Late orders · Quotes waiting for an answer.
  - No production or QA cards.
- **Menu**:
  - Home
  - **Orders**: Customer orders · Orders as a board · Deliveries
  - **Customers**: Customers · Prices · Customer returns
  - **Price offers**
  - **Invoices** (read-only: what the customer owes)

### Purchasing (Joy)
- **Home "Buying"**:
  - "What to do next" in this order: what to buy (shortages) → requests to order → POs to send → deliveries late → **delivery problems to decide**.
  - Buttons: **Ask to buy something** and **New purchase order**.
  - QA queue as a small line only.
- **Menu**:
  - Home
  - **Buying**: What to buy · Requests to buy · Purchase orders · Deliveries coming · Delivery problems · Send back to supplier
  - **Suppliers**: Suppliers · How suppliers do
  - (Sales guess moves under Reports.)
  - Purchasing lives here for every role that buys; the second copy under Management and the in-page chip row are removed.

### Finance (Rosa)
- **Home = the "Money" page**:
  - "What to do next" in this order: deliveries to bill → invoices to give to the customer → payments to book → bills that do not match → bills due this week → month to close.
  - Cards: Customers owe us (with late) · We owe suppliers (with late).
- **Menu**:
  - Home
  - **Money in**: Invoices · Payments · What customers owe · Money back (credits)
  - **Money out**: Supplier bills · Payments to suppliers · Expense claims
  - **Month end**: Close the month · Tax rates
  - **Reports**

### QA (Nina)
- **Home "Quality"**:
  - "What to do next" = the oldest item in the QA queue (batch or delivery), with **Check this batch / Check this delivery** as the green button.
  - Then: lots on hold · open problem reports · things to approve (second QA).
  - No sales cards.
- **Menu**:
  - Home
  - **Check**: Check a batch or delivery · Quality tests · Lots stopped by QA
  - **Problems**: Problem reports · Fix-and-prevent plans · Complaints · Recalls
  - **Trace**: Where it came from and where it went
  - Sales & Customers and Management are hidden; trace and search cover the rest.

### All four
- Top bar at ≥ 1280 px: **Search · To approve (n) · Messages (n) · Help · Me**, with words.
- On phones: **one** menu button (the bottom-bar "Menu"); the top-left ☰ is removed.

---

## Form design rules to apply app-wide

1. **Defaults come from the record you came from.**
   - From a request: supplier, item, quantity, needed-by date, price.
   - From a PO: bill lines, unit, price.
   - From an invoice: payment amount and date.
   - From a quote: delivery date (+ lead time).

   Never default to "today" for a future event, or to the first entry in a list (supplier, category "utilities").
2. **Required fields are always visible.** Folds ("you can skip this") contain only optional fields. A field is never "optional" in one case and silently required in another; if it depends on a choice, show it when the choice is made.
3. **Field order follows the phone call or the paper.** Who → what → how many → price → when → notes. For a bill: supplier → their bill number → delivery → lines. Put the reference number the clerk copies from paper next to the date on that paper.
4. **Units the person thinks in.** Show quantity and price in the purchasing or selling unit (kg, drum, pcs, box), with the base unit as small text. Never "Price per g".
5. **Validate on leaving the field and on "Next".** Messages in words, under the field, naming the item ("Type the price of Lotion Bottle 250 mL"). No item codes in messages. Never only on the last step.
6. **Keep every typed value after any error**, including selects and radios.
7. **One verb per outcome.** The button says what really happens: "Confirm the order", "Email to …", "Print", "Save as draft". "Send" only when something leaves the building.
8. **One step when one person can decide.** Save + submit + approve + post collapse to one button below the owner's thresholds (setting); above them, the screen names who approves next.
9. **Warn, don't block, on unusual values** (price differs from last time or from the order, quantity not a multiple of the pack, delivery date before lead time), with one sentence and the reference value.
10. **Duplicate check on every master record** (customer, supplier, item): same phone, email, tax number or a similar name shows "Already exists – Open it".
11. **After saving, land on the record with the title visible** (scroll to top), a one-line success message at the top, and the next step in the green box. Do not repeat the same sentence in both, as on PO-26-00003.
12. **Keyboard:** "Skip to content" as the first Tab stop; focus the first field on every "New …" page; Enter moves to the next step in wizards and submits single-step forms; Esc closes pop-ups.
13. **Dates in words next to the picker** ("Tue 15 Dec 2026") so `12/08/2026` cannot be read the wrong way.
14. **Status words describe the business state** ("In the books – not given to customer yet"), never a step the person did not do.

---

## Bugs found (separate from design)

| # | Bug | Steps to reproduce | Shot |
|---|---|---|---|
| B1 | Customer numbers in two formats: the seed has `CUS-001`, `CUS-002` and new customers get `CUS-0001`, `CUS-0002`, so "Luntian Wellness Store CUS-0001" sits next to "Luntian Wellness Stores CUS-001" | Fresh demo → sales → New customer → save → Customers list | `69f-phone-customers` |
| B2 | No duplicate warning for the same phone and a near-identical name | New customer "Luntian Wellness Store", phone 0917 555 0101 → saved silently | `05c-dup-saved` |
| B3 | Receiving requires "Expiry date" for wrappers and bottles; the browser bubble points to a field hidden under the sticky header | warehouse → Receive → PO-26-00001 → type quantities → Save and print labels | `48a-received` |
| B4 | QA check: after the "Describe the observation." error, "Is it OK?" resets to "Not tested yet" (pH is kept) | qa.nfd → Check this batch → pH 5.8, "Yes, OK", leave Observation empty → Save 2 results | `55b-qa-results-saved` |
| B5 | Order help panel describes old buttons ("press Confirm order", "Save the order") while the page shows "Send the order" | Any confirmed order → "?" in the record header | `16a-order-qmark` |
| B6 | PO from request: banner says "Supplier … as named on the request" when the request named none; the "change" link drops `?request=` | Approved request without supplier → Make the purchase order → pick Manila Print & Pack | `40a-po-items` |
| B7 | PO wizard: the price field is in "A different price (you can skip this)" but is required; the error appears only on step 4, with item code "MAT-0011" | as B6 → Next → Next → Save and send for approval | `42z-after-save` |
| B8 | PO wizard: "Arrives on" defaults to today, ignoring the request's Needed by | as B6, step 3 | `41a-po-when` |
| B9 | PO-26-00002 lines say "All here" but "Deliveries received: Nothing has arrived yet" | Open PO-26-00002 (Laguna Oleo, seed) | (text log, s70) |
| B10 | Messages stay NEW after the work is done ("Purchase order approved · Send it" for sent and delivered POs; QA 24 unread including decided lots) | procurement@ → bell | `34a-purch-msgs`, `53d-qa-msgs` |
| B11 | After "Ask the planner to make 12", the button stays green and clickable, and sales Home still says "ask the planner to make it" | SO with a short line → Ask the planner → reload the order and Home | `22a-ask-planner`, `25-search-bayanihan` |
| B12 | Supplier bill: no way to edit a draft or "Does not match" bill (More: only Cancel); the advice "Ask the supplier for money back" is shown for our own typo | Enter a bill with a wrong price → Check against order → ⋯ More | `71a`, `72a-bill-more` |
| B13 | Supplier bill: supplier defaults to the first in the list; "kind" defaults to "utilities" inside the fold | Enter a supplier bill | `31b-new-bill-full` |
| B14 | Payment made from an invoice reads "Amounts chosen by hand" and "Used ₱0.00 · Kept for later ₱3,360.00" | Invoice → Record a payment → Save | `67a-payment-saved` |
| B15 | After QA OK of a material lot, the put-away hand-off names "Ana (owner) or Dino (site manager) or Jun Dela Cruz (operator)" but not Lito (warehouse) | qa.nfd → wrapper lot L-2611-00019 → OK to use | `57a-qa-lot-ok-direct` |
| B16 | Delivery-received stepper still reads "Not finished (done) · Saved to stock (current step)" (END_TO_END 2b) | Open GR-26-00005 | `51b-receipt` |
| B17 | Two sub-menu drop-downs open at the same time | Sales & Customers → open "Quotes, prices & returns", then "Billing & payments" | `03c-billing-dd` |
| B18 | Trace quick list says "newest first" but starts with L-2611-00002 | Quality → trace | (text log, s60) |
| B19 | Problem report on a lot already on QA hold says "No stock was stopped for this report"; severity shows raw `minor/major/critical`; the "deviation" word leaks ("You raised this deviation") | Lot on hold → More → Report a problem → send | `59b-problem-sent-full` |
| B20 | "Values hidden for your role" on sales Home while the order list shows the values to the same person | sales@ Home, then Customer orders | `01-sales-home`, `02-sales-menu` |
| B21 | New order wizard lets a ₱0.00 order reach "Check and save"; the price error only comes after Save | New customer order with no price list → 2 products, no price → Next → Save | `19b-check-no-price`, `20a` |
| B22 | Duplicate "Help for this screen" buttons on record pages (frame and header) | Any customer order, at 1366 px | (Playwright strict-mode error, s16) |
| B23 | After saving, some records open scrolled down with the title hidden | Save a new customer with Enter; Save the order with a price error | `05c-dup-saved`, `20a` |
| B24 (not reproduced) | First Ctrl K right after loading Home was ignored once | sign in → Home → Ctrl K immediately | `25-search-bayanihan` |

### Risks to raise with the owner (not bugs, need a decision)

- **A blank credit limit means no credit check** ("Credit check: Not needed for this customer"), so a brand-new customer can order any amount. Suggest "no limit set = needs approval" as the default (configurable).
- **Set-aside goes to whoever clicks first, not to the earliest delivery date.** SO-26-00004 (deliver 25 Nov) took 24 soap before SO-26-00003 (deliver 20 Nov, confirmed earlier). The "free on the shelf" figure in the order wizard (70) did not count confirmed orders not yet set aside, so both orders were promised the same bars.
- **Tax on invoices is ₱0.00 with "No tax" as the only option.** This is configuration for the accountant (not judged), but a clerk will issue untaxed invoices without noticing; flag it on the invoice until tax rates are set.
- **QA can say OK to a received lot with no test and no supplier paper.** This is allowed by the configured rule; QA should confirm the rule per material.
