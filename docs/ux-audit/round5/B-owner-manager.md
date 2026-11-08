# Round 5 usability audit B: owner and site manager, seen by people who are not computer-literate (2026-11-08)

| | |
|---|---|
| Asked by | Owner: "Imagine you are an operator, owner, manager that is not very literate with computers, hence initial using is very difficult, including navigation." Coordinator added: "where is the main search?" (the owner could not find it). |
| Persona | Ana Villanueva (`owner@`), Filipino business owner in her 50s. She runs the company by phone and paper, uses a tablet and a laptop, is busy, does not know ERP words, and wants to know: is everything OK, what needs me, how much money. Dino Reyes (`manager.nfd@`), site manager. |
| App | Production build at `http://localhost:3582`, fresh small demo (`docs/demo-script.md`). Real records were made: SO-26-00003 (Luntian, 100 soaps), WO-26-00005, PR-26-00001 → PO-26-00003, product and recipe "Calamansi Soap 100 g" (F-0003), customer Bahay Kubo Pharmacy, supplier Batangas Coco Farms, operator Maria Dizon, problem report DEV-26-0001; one setting switched off and back on. |
| Method | Playwright at 1366×768, 1440×900, 820×1180 (touch), 390×844 (isMobile, touch). Header geometry was also measured at 1024, 1280 and 1920. Screenshots are in the session scratchpad `novice/B/` (132 files) and are not kept in the repository. File names are quoted below. |
| Earlier rounds | `docs/ux-audit/README.md`. Re-checked items are marked **(still open)** or **(fixed)**. |

---

## Summary

| Task | Can a novice owner or manager do it alone? |
|---|---|
| 1 "How is my business today?" (Home in 10 s) | **With help.** Sales today is clear. Money owed and money due are not on Home. Ten pipeline rows and an audit-style activity feed hide the answer. |
| 2 "What needs me?" | **With help.** At 1280 px and wider, To approve is an icon with no word. Its count lagged the list. Approving works in one tap but asks no confirmation. |
| 3 Take an order for 100 soaps and get it made | **No.** The order works (12 clicks). The production order cannot be linked to the customer order, so the owner cannot see where "her" 100 soaps are. |
| 4 Buy a low material | **No.** "Running low" is empty because no minimums are set. The purchase-order wizard refuses on its last screen because of a price field marked "you can skip this". "Send to the supplier" shows "Something went wrong" although the order was sent. |
| 5 Set up a product + recipe, customer, supplier, worker | **Yes for product, recipe and customer. With help for supplier and worker.** A supplier cannot be used until QA approves each item. A worker needs an email address, and the sign-up link has no Copy button. |
| 6 Money | **With help.** Money is Management › Finance › Money. Invoices are under Sales & Customers. There is no "this month's sales" anywhere. Searching "who owes" finds nothing. |
| 7 Find anything (search, menus, Settings) | **No (on a laptop).** At 1280 px and wider, search is a bare magnifier icon. On phones it is labelled "Scan" and opens a screen under Inventory. Settings has 23 groups and still uses engineering words. |
| 8 Manager: plan the day, deal with a problem | **No.** Production plan is hidden under Management › More. "Report a problem" points to a ⋯ More menu that does not contain it (bug). |
| 9 Navigation | **With help.** There are about 100 entries, 3 levels deep. Purchasing repeats its whole sub-menu as a chip row on every page. Phones have two Menu buttons that open the same drawer. Home is always one tap away (logo or Home tab): **yes**. |

---

## Per task: the walk

Clicks count taps, selections and typed fields on the happy path.

### Task 1. First sign-in: "How is my business today?"

1. Sign-in page (`/sign-in`, `01-signin-lap.png`): clear. "Try the demo" is helpful. 0 hesitation.
2. Home (`/dashboard`, `02-owner-home-lap.png`, `02-owner-home-phone-fold.png`, `02-owner-home-tab-fold.png`). What Ana reads, top to bottom:
   - Greeting, then a 2-line intro: *"This screen is for you, the owner…"*. She skips it.
   - Green box: **"Next: 1 finished batch waits for the QA check." [See the batches]**.
     - *Hesitation:* "Is that me? I am not QA." The owner's "what to do next" is somebody else's job, and it does not name Nina (QA). ADR-109 says every hand-off names who acts next.
   - Four coloured cards: Sales today ₱12,240 (good), Production progress 25%, Stock to look at 1, **Waiting for your approval 0 in a red card**.
     - *Hesitation:* "Red… is something wrong?" Red is used for zero.
     - At the same time `/approvals` held 1 item (`15-approvals-owner.png`, taken about 6 minutes later, shows the list with 1 item and the top-bar icon with no badge). About 2 minutes after that the badge showed 1 (`16-request-new.png`). See bug B14.
   - "Needs your attention: 1 lot expires within 30 days." Good, and plain.
   - "Production by stage": 10 rows (Expected deliveries, Receiving, Materials to check, Materials ready **15** with a full-width bar, Being made, Products to check, Boxing, Ready to sell, Orders to ship).
     - *Hesitation:* "Fifteen what? Is 15 good?" The biggest bar on the page is the least important number.
   - Recent activity: "Lito Pascual saved the stock move · GR-26-00004", "made the lot of Glycerin · L-2611-00018".
     - For Dino later: **"Ana Villanueva owner break glass the user site assignments"** and **"used the owner's override on the purchase order"** (`39-mgr-home-lap.png`). These are raw audit verbs, and they make normal owner actions look like emergencies (bug B5).
   - **Money:** nothing about who owes us, what we owe or cash. "How much money" is answered only as "sales today".
3. 10-second test: she gets sales today, and she gets "something about QA". She does not get "is everything OK" or "money".
   - The phone (`02-owner-home-phone-fold.png`) shows the green box and the 4 cards above the fold. That is good. The tab row cuts "Problem…" behind "More".

### Task 2. "What needs me?" (approve things, see who acts next)

1. On the 1366 laptop she looks for a word like "Approve" and finds 5 round icons with no words: magnifier, cloud, checklist, bell, question mark (`02-owner-home-lap.png`).
   - *Hesitation:* "Which one?" At 820 px the same bar has words: "Scan or search", "To approve", "Messages" (`02-owner-home-tab-fold.png`). **The bigger screen has fewer words.**
2. Card "Waiting for your approval" → `/approvals` (1 click). It shows one QA batch decision: *"Open the record to decide (it needs more details than a tap)"* (`15-approvals-owner.png`).
   - *Hesitation:* "The owner decides QA?" There is no hint that Nina normally does it.
3. Production order WO-26-00005 (`14-wo-draft.png`): "You can approve this yourself because you are the owner. Dino (site manager) can do it too." **[Approve]**. 1 click, done at once, no "Are you sure?".
   - After approval the owner sees a green **[Get materials]** (`14-wo-approved.png`), which is the operator's job, and "Anyone can take it".
   - *Hesitation:* "Do I have to get materials now?"
4. Request to buy PR-26-00001: [Approve] is 1 click and has no confirmation (`18-pr-approved.png`). Purchase order PO-26-00003: [Approve] is 1 click (`23-po-approved.png`). Recipe F-0003: [Approve] is 1 click (`31-recipe-approved.png`).
   - The recipe page does warn well: "GMP auditors usually expect a QA person…".
5. Invoice approval was not possible: there are no invoices in the small demo (`35-invoices.png`, "No invoices yet").
6. Messages (bell, 12 unread; `15-messages-owner.png`):
   - Four "Production order waits for your approval WO-26-0000x" are still **NEW** although all four were approved at seed time.
   - Warehouse messages ("Coconut Oil lot is ready — put it on L-2611-00017 · RM-01. QA released it. It is waiting in QUA-01") reach the owner.
   - Dino has 18 unread. His PR/PO approval messages stay NEW after Ana approved them (`40-mgr-messages.png`). See bug B9.

### Task 3. A customer calls for 100 soaps: take the order and get it made

| # | Screen | Clicks | What happened / hesitation |
|---|---|---|---|
| 1 | Top menu **Sales & Customers** → `/sales` (`05-sales-list-lap.png`) | 1 | Good list, names first, ₱ amounts. |
| 2 | **New customer order** → `/sales/new` step 1 (`06-so-step1-filled.png`) | 1 | Pick Luntian (1) and "Deliver by" (1); the date has no default. |
| 3 | **Next: Products** (`07-so-step2-filled.png`) | 1 | Product (1), how many 100 (1). *"Acapulco Soap 135 g (70 in stock)"* and a warning: *"More than is free… you can have it made for this order"*. **Price: "No usual price yet: type the agreed price", and ₱0.00 is accepted**: she can save a ₱0 order. Typing ₱70 (1). |
| 4 | **Next: Check and save** (`07-so-step3.png`) | 1 | *"Saving keeps the order as a draft. On the next screen you send it."* Hesitation: "Send it where? The customer is on the phone; I just want it confirmed." |
| 5 | **Save the order** → `/sales/[id]` (`08-so-saved.png`) | 1 | **The title is "SO-26-00003"**; the customer name is the grey subtitle. A 10-step stepper (Draft … Invoice, Done). |
| 6 | **Send the order** (`09-so-sent.png`) | 1 | "Order confirmed. The warehouse can now set aside the stock." But the green button **[Set aside the stock]** is offered to the owner. Hesitation: "Is that me or the warehouse?" |
| 7 | **Set aside the stock** (`10-so-setaside-after.png`) | 1 | Done instantly, no confirmation. 70 of 100 set aside. The message: *"Not enough stock that QA said OK to use: **PRD-0001**: 30 pcs short"*. Next to it: *"Stock is coming for this order: coming: 30 being made · **nothing needs making**"*, and below: *"Only part of the stock is set aside… The order waits"*. The stepper still says "Set aside (not yet)". Three messages about the same 30 bars disagree in tone. |
| | **Subtotal** | **12** | |
| 8 | Get it made: **Operations › Production orders › New production order** (`11-prod-new.png`) | 3 | The form has no "for which customer order?" field. "Needed by" and, under More details, "Finish by" are two dates that sound the same. |
| 9 | 100 bars (1), needed by 19 Nov (1) → the screen shows *"Split into 1 batch / 1 batch of 100 bars / Make it one batch / 1 batch of 100 bars"* (`13-prod-new-filled.png`). The same choice is shown twice. | 2 | |
| 10 | **Create order** → WO-26-00005 (`13-prod-created.png`). The title is the code. | 1 | |
| 11 | **Approve** (`14-wo-approved.png`) | 1 | No confirmation. |
| | **Total to "order taken and production started"** | **19** | |
| 12 | "Where is it now?" Back on SO-26-00003 | — | **The customer order does not show WO-26-00005, and the production order does not show the customer.** The production-order list shows "For SO-26-00002" (a code, not "For Isla Spa Supplies") only for seeded orders. Operations Center lists WO-26-00005 with **Due 08 Nov 2026** although "Needed by" was 19 Nov (`40-mgr-opscenter.png`, bug B11). `/operations/flow` (`15-flow.png`) is the only place that joins the road, as 16 rows of counts, not "your order". |

Verdict: the owner can take the order alone. She cannot connect it to production, and nowhere answers "where are Luntian's 100 soaps right now?" in one sentence.

### Task 4. A material is low: ask to buy, purchase order, approve, see it arrive

| # | Screen | Clicks | What happened / hesitation |
|---|---|---|---|
| 1 | "Which material is low?" Home says "0 low". **Management › Purchasing › Running low** (`16-running-low.png`) | 3 | *"Nothing here. No item has a minimum yet."* Nothing in the demo is "low", so the owner cannot find out. |
| 2 | Purchasing hub (`16-purchasing-hub.png`) | — | Two green buttons ("Ask to buy something", "New purchase order") **plus a row of 9 chips that repeat the Purchasing menu**. The same chips appear on every Purchasing page (`16-request-new.png`). Hesitation: "Ask to buy or New purchase order? I am the owner, I just want to buy." |
| 3 | **Ask to buy something**: Palm Oil (1), 50 (1), why (1), **Save the request** (1) → PR-26-00001 (`17-pr-saved.png`) | 5 | |
| 4 | **Send for approval** (1) → **Approve** (1) (`18-pr-approved.png`) | 2 | She approves her own request. The page says *"No supplier or price was named on the request, so the order goes to the manager for approval."* |
| 5 | **Make the purchase order** → supplier list (`19-po-from-pr-1.png`): Laguna Oleo Supply (1) | 2 | Step 2 says *"Supplier Laguna Oleo Supply, **as named on the request**. Within the approved supplier… **the order needs no second approval**."* Both halves are false (bug B3). |
| 6 | Step 2 **Next** (1), step 3 *"Arrives on: Suggested: **today**"* (the request said 15 Nov) **Next** (1), step 4 shows *"price on save · Total before tax: worked out on save"* (`20-po-step4.png`) | 2 | |
| 7 | **Save and send for approval** (1) → refused: *"Line 1: enter the unit price (no supplier price is recorded for **MAT-0002** per kg)."* There is no price field on this screen (`21-po-saved.png`). | 1 | **Dead end for a novice.** The price is on step 2 under **"A different price (you can skip this)"** (`22-po-price-open.png`), together with "Deliver to", "We pay within", "Tax on the supplier's quote", "Urgent", "Why urgent". |
| 8 | Back ×2 (2), open "A different price" (1), ₱95 (1), Next ×2 (2), Save and send (1) → PO-26-00003, "Waiting for approval" (`22-po-saved.png`) | 7 | She approves the same 50 kg a **second** time. |
| 9 | **Approve** (1) → **Send to the supplier** (1) → red *"Something went wrong. The change was not saved."* (`23-po-send-click.png`) | 2 | On reload the order **was** sent: "Sent – waiting for the delivery" (`24-po-send-box.png`), history "sent to the supplier", email "pending" (bug B1). A novice would press it again or call IT. |
| 10 | "See it arrive": the PO page says *"When it arrives, receive it here. So can Lito (warehouse) or Dino (site manager)."* **[Receive the delivery]** (`24-po-send-box.png`) | — | Good hand-off. Receiving itself was not walked (warehouse persona). |
| | **Total** | **≈ 26**, 2 approvals of the same purchase by the same person, 1 false error | |

### Task 5. Set up a product + recipe, customer, supplier, worker

**Product + recipe (≈ 20 clicks, works alone).**
- `/masterdata/products` (`26-products.png`) offers **three** ways to start: "New product", "Make a recipe (step by step)" and "Add a product here (without a recipe)".
  - *Hesitation:* "Which one?" The page's own "What to do next" says use the recipe. Keep only that one.
- Recipe wizard `/masterdata/recipes/new`:
  - "Make a new product": 5 fields, **Make this product** (`28-rw-product-made.png`).
  - Next → "Start from another product's recipe?": copied Acapulco (`29-rw-copied.png`). After copying, the "count by pieces" choice flipped to "By weight (kg)" by itself.
  - Ingredients, then steps (`29-rw-step3.png`, `29-rw-step4.png`), then check (`29-rw-step5.png`), then **Send for approval**, then **Approve** (owner alone, ADR-117; `31-recipe-approved.png`).
  - The new product appears in "New production order" at once. **(Fixed: ADR-116 behaves.)**
  - Risk: the copy kept **"Soap Wrapper 135 g"** and the step text **"Cut the block into 135 g bars"** for a 100 g soap, with no warning.
- **Customer (6 clicks, alone)**: `/sales/customers/new` has 4 fields (`33-customer-new.png`), then **Save the customer** (`34-customer-saved.png`). The new number is **CUS-0001**; the seeded customers are **CUS-001** and **CUS-002** (bug B8). The customer page then shows 13 sections (portal access, their own product codes, special rules…) for a shop with no orders.
- **Supplier (4 clicks, then stuck)**: "Add a supplier" leaves Purchasing for `/masterdata/suppliers/new` (`33-supplier-new.png`). After saving (`34-supplier-saved.png`): *"Nothing may be bought from this supplier yet. Suggest an item… QA says yes or no."*
  - *Hesitation:* "I am the owner, I chose them." Each item must go to QA before it can be bought.
  - The page title is generic ("Bryel's Care ERP"; bug B6).
- **Worker (5 clicks, with help)**: `/admin/users/invite` (`33-user-invite.png`) **requires a work email**. Most operators have none. The job list offers "Production TV", "Auditor (can only look)" and "IT person" next to "Machine operator".
  - After saving (`34-user-saved.png`): *"Email is not set up, so no email was sent. Send this link to the person yourself (chat or SMS)."* The link is shown as raw text, with **no Copy button and no QR code**. A novice cannot get it into Viber on a laptop.

### Task 6. Money: who owes us, what we owe, this month's sales

1. Home: only "Sales today ₱12,240" and "Sales this week". **No month and no money owed.**
2. Search "money" → "Money · Management › Finance" (`04-search-money-lap.png`). Search "who owes" → *"Nothing found"*.
3. `/finance` "Money" (`35-money.png`) is good and plain: "Money customers owe us ₱0.00", "Money we owe suppliers ₱0.00", ageing buckets. It is 2 levels under Management, while **Invoices** and **Payments** are under Sales & Customers › Billing & payments. Money is split across two top menus.
4. "This month's sales": Reports (`35-reports.png`) gives "last 4 weeks ₱19,240". Business overview (`35-biz-overview.png`) has a "This month" chip but leads with *"Trend data is stale. No nightly KPI snapshot has run yet"*, and its cards define themselves in engineering words: *"Finished output mass posted in the period divided by the planned mass…"*, "Yield loss 1 g", "ACTUAL".

### Task 7. Find anything: search, menus, Settings

**Search discoverability** (coordinator request; measured on `02-owner-home-*`, `48-header-1024.png`, `48-header-1280.png`):

| Width | What the search looks like | Where | Novice reading |
|---|---|---|---|
| 390 (phone) | Button **"Scan"** with a scan-frame icon | top bar, 2nd item after the logo | "Scan is for barcodes", not search. It opens `/inventory/scan` "Scan or search" with the **Inventory** bottom tab lit (`04-search-phone-scan.png`). The search box is good once there. |
| 820 (tablet) | Pill **"Scan or search"** | top bar, after the logo | Findable. |
| 1024 | A wide box, **"Search anything — a screen, a name or a number · Ctrl K"**, 308 px | top bar centre | Best of all widths (`48-header-1024.png`). |
| 1280 / 1366 / 1440 / 1920 | **44 px round magnifier, no word** (tooltip only on hover: "Search anything (Ctrl+K or /)") | far right, first of 5 unlabelled icons (x = 952 / 1038 / 1112 / 1325) | **Not found.** Her eyes go to the green menu pill in the centre and then to the page. The right corner reads as "settings stuff". |

The space is there. At 1280 the menu pill ends at x = 824 and the icons start at 952, so 128 px are free, plus ≈130 px empty between the logo and the menu pill. At 1366 the free gap is 171 px. A 240 px labelled box fits if the menu pill starts next to the logo (proposal in §Navigation).

The search itself works well:
- "Luntian" → customer + order; "SO-26-00001" → the order; "settings" → screens; "glycerin" → material + lots (`04-search-Luntian-lap.png`).
- **It does not find people** ("Dino" → nothing) or questions ("who owes" → nothing).
- Ctrl K and "/" both open it.

**Menus.** See §9 below.

**Settings** (`36-settings.png`, `37-settings-scan.png`, `38-settings-after.png`):
- 23 group chips; Ana must type her password first.
- Words in the Stock group: "Movement types per role… post", "Reservation time-to-live (hours)", "Recount above variance (%)", "Near-expiry alert buckets (days)".
- Scan and search has 2 settings, both clearly explained.
- Change → On/Off → reason → password → the button reads **"Send for OK"** although the card says *"You can change it alone"*. It saved at once with *"Saved. The change applies from the next request. **Audit event 01a1ba07-5dc8-…**"* (bug B15). 6 clicks.

### Task 8. Manager: plan and run the day, deal with a problem report

1. Dino's Home (`39-mgr-home-lap.png`, `39-mgr-home-phone.png`): "Next: 1 lot expires within 30 days." "Sales today 3 orders … Values hidden for your role." The rest is the same layout as the owner's.
   - *Hesitation:* "Where is today's plan?"
2. **Operations › Today** (`40-mgr-today.png`): *"Nothing written today yet. To write today's count, open the production order…"* It is not a plan, only a log.
3. **Production plan** (the real "what to make" screen, `40-mgr-plan.png`) sits under **Management › More**. It shows a demand table with codes (PRD-0001) and "Keep at least" minimums, all "—".
4. Operations Center (`40-mgr-opscenter.png`): a 9-card strip and a "Batches being made" table. It is the best "run the day" view, but its "Due" column is wrong for WO-26-00005 (bug B11).
5. **Problem report.** Operations › Quality › Problem reports (`40-mgr-problems.png`): *"To report a problem, open the batch or lot… and use ⋯ More → Report a problem."*
   - Dino opens the batch record B-26-0003 (`43-mgr-batch-record.png`). ⋯ More holds Print batch record / weighing sheet / traveler, Close the batch, Open the production order, and **no "Report a problem"** (`43-mgr-batch-more.png`). The same is true for the stock lot page and the step page (bug B4).
   - It exists only on the QA pages `/quality/batches/[id]` and `/quality/lots/[id]`, which no manager path opens.
   - `/quality/deviations/new` alone is a dead end (`40-mgr-problem-new.png`).
6. Reached through the QA batch page: the form is good, 2 fields (`45-mgr-report-form.png`). After **Send problem report** Dino lands on QA's investigation page (`46-mgr-report-sent.png`):
   - Green box: *"Next: say how serious it is…"* and **[Start looking into it]**, plus a "How serious? minor / major / critical" form.
   - *Hesitation:* "Do I have to do this now?" It should say "Sent to Nina (QA). You will get a message when she decides."
   - The page title is generic (bug B6).

### Task 9. Navigation

| Item | Count / finding |
|---|---|
| Top menu (desktop, ≥1280) | 5 pills: Home, Operations, Inventory, Sales & Customers, Management. Plus 5 unlabelled icons (search, sync cloud, To approve, bell, help) and the avatar. |
| Second row (tabs) | Home 3 (Overview, Problems & alerts, Help & my account ▾). Operations 8 (incl. Receiving ▾ 4, Quality ▾ 6, More ▾ 9). Inventory 4 + More. Sales 5 (incl. 2 dropdowns). **Management 8 chips, of which 7 are dropdowns with 4–9 entries each, and More ▾ holds "Production plan" and "Batch records"** (`50-*`). |
| Entries reachable by the owner | ≈ 100 (`nav.ts`; ADR-107 reported 73 *visible* plus the folded ones). 3 levels: top pill → tab chip → dropdown. |
| Duplicate navigation | Purchasing pages show a **third** chip row with 9 entries that repeat the Purchasing dropdown (`16-*`, `22-*`, `24-*`). The Management hub repeats every dropdown as cards (`03-menu-Management.png`). |
| Wrong "you are here" | Batch record `/production/[id]` lights **Management** and its "More" chip (`43-mgr-batch-more.png`; bug B13). Scan-or-search lights **Inventory** on the phone. |
| Phone | Top-left ☰ **and** bottom "Menu" open the same drawer (two "Open menu" buttons). The drawer has 5 groups that expand into the same ≈100 entries (`47-phone-drawer.png`). **Esc does not close the drawer** (bug B12). The bottom bar is Home · Operations · Inventory · Sales · Menu. There is no Money and no To approve; To approve sits in the tab row. |
| Back links | Present on records ("‹ Customer orders", "‹ Production orders", "← People"). **(Fixed.)** |
| Home always reachable | Yes: the logo, the Home pill and the bottom Home tab. **(Fixed.)** |

---

## Top 15 problems, ranked by impact

| # | Where | What the person experiences | Why | Concrete fix |
|---|---|---|---|---|
| 1 | **Search on laptops** (≥1280 px), all pages | "Where is the search?" She never finds the magnifier; Ctrl K means nothing to her. | Above 1279 px the labelled box collapses to a 44 px icon at the far right, among 4 other unlabelled icons. The tablet (820) and 1024 widths show words. | Show a **visible box at every width ≥ 768**: magnifier + the word **"Search"** + placeholder *"Search a customer, product or order number"*, 240–320 px. Put it **directly after the menu pill**. Move the menu pill left to start next to the logo (x ≈ 84); at 1280 the pill ends ≈ 716 and the box fits from 732 to 972. Drop the sync cloud from the top bar for office roles (show it only when not synced, as a pill "3 not sent yet"). Remove the duplicate magnifier icon. On phones rename the top button **"Search"** (magnifier) and keep "Scan a label" as the first line inside the search screen. Do not light the Inventory tab for it. Add **people** and **plain questions** ("who owes", "this month") as search answers that open Money and the people list. |
| 2 | **Customer order ↔ production order not linked** (`/production/orders/new`, `/sales/[id]`) | "I made 100 soaps for Luntian; where are they?" There is no answer anywhere. | The production order form has no "for which order"; the customer order shows only counts. Previously reported in END_TO_END_FLOW 4a. **(Still open.)** | On the customer order, whenever anything is short or "coming", show one green button **"Make the missing 30 for this order"**. It opens the production order form pre-filled (product, 30, needed-by = deliver-by − 2 days) and links both. On the customer order add a "Where is it now" line: *"30 bars: being made by Rhea, step 4 of 8 (Pour into moulds), ready about Tue 17 Nov."* The production order header reads **"For Luntian Wellness Stores (order of 20 Nov)"**, not "For SO-26-00002". |
| 3 | **Purchase order wizard price** (`/procurement/orders/new` step 2 → 4) | She presses "Save and send" and gets *"Line 1: enter the unit price (… MAT-0002 per kg)"* on a screen with no price field. | When no supplier price exists, the price is required but hidden under "A different price (you can skip this)", together with 6 unrelated fields. | Step 2: show **"Price per kg (₱)"** as a visible field next to "How much" whenever the supplier has no price for the item, pre-filled with the last price paid if any. Rename the fold to **"More (delivery place, paying days, urgent)"**. Step 4 shows the total, never "worked out on save". The error names the item: "Type the price of Palm Oil on screen 2", with a button **"Go to screen 2"**. |
| 4 | **Home does not answer "how much money"** (`/dashboard`, owner) | "Is the company making money? Who owes me?" Not on Home. | Home shows sales today, production %, stock and approvals; money lives under Management › Finance. | Replace the 4 cards with **"Sales this month ₱…"**, **"Customers owe us ₱… (₱… late)"**, **"We owe suppliers ₱… (due this week ₱…)"** and **"Needs you: N"**. Production % moves into the "Today at the plant" box (see §Page design). Never colour a zero red: a zero is neutral grey with "Nothing to decide ✓". |
| 5 | **"What to do next" on Home names someone else's job** | "Next: 1 finished batch waits for the QA check. [See the batches]". "Do I have to check it?" | The Home box shows the plant's first waiting item, not the owner's. | For owner and manager the box reads **"Nothing needs you now. Waiting on others: Nina (QA) checks 1 lotion batch · Lito (warehouse) puts away 1 delivery."** with names and no green button. The green button appears only when the item is theirs: "Approve 1 purchase order (₱4,750)". |
| 6 | **"Report a problem" is unreachable** for manager and owner | The instructions say "⋯ More → Report a problem"; that menu does not have it. | The action exists only on the QA batch and lot pages (bug B4). | Add **"Report a problem"** to ⋯ More on the batch record, the production order, every step page and the stock lot page. On `/quality/deviations` add a green **"Report a problem"** that asks "About which batch or lot?" (a name picker plus scan) instead of a dead-end paragraph. After sending, show the reporter *"Sent to Nina (QA) at 15:22. You will get a message when she decides."* and a "Back to the batch" button, not QA's investigation form. |
| 7 | **The same purchase approved twice by the same person; contradictory texts** (PR → PO) | Ana approves the 50 kg request, then the 50 kg order. The pages tell her both "goes to the manager" and "needs no second approval". | The ADR-110 "one approval per purchase" only applies when the request names supplier and price. | When the approver of the request is the owner or manager, the purchase order made from it within the request amount is **approved by that decision**. Remove the second Approve. For an owner, merge "Ask to buy" and "New purchase order" into one **"Buy something"** form: item, amount, supplier (suggested), price (last paid), arrives by. Approval is skipped for the owner. Fix the false "as named on the request" sentence. |
| 8 | **"Send to the supplier" shows "Something went wrong" although it was sent** | She thinks it failed and presses again, or calls IT. | The send commits, then the email step fails or is pending, and the UI shows the generic error (bug B1). | After the PO is saved as sent, always show success: *"Sent. Email to orders@sup-0001.test is waiting to go out (email is not set up). Print or call the supplier: [Print the order]."* Report email trouble as a yellow note, never as "not saved". |
| 9 | **Messages pile up and never clear** (bell 12 for owner, 18 for manager) | A bell full of stale "waits for your approval" items that were approved long ago; warehouse chores ("put it on RM-01") for the owner. | Messages are not closed when the thing they ask for is done, and are sent by role without a "who acts" filter. | Close (mark done) a message when its record leaves the state it asked about. Do not send put-away, pick or second-check messages to owner or manager. The bell count = only messages that still need *them*. Message text uses names and places: "Coconut Oil (delivery from Laguna Oleo) can go to the Oils rack", not "L-2611-00017 · RM-01 … QUA-01". |
| 10 | **Too many menu entries, 3 levels, repeated rows** | "Where is Production plan?" (Management › More). "Where is Money?" (Management › Finance › Money; Invoices under Sales). | ≈100 entries organised by department, not by the owner's questions; Purchasing repeats its menu as chips; Management hub repeats every dropdown. | See §Navigation proposal: 6 top items for owner and manager, everything else under **Set-up**; remove the Purchasing chip row and the hub card grids; move Production plan to **Make**, Money to its own top item. |
| 11 | **Record titles are codes** (customer order SO-26-00003, production order WO-26-00005, request PR-26-00001, purchase order PO-26-00003, problem DEV-26-0001) | The big word on the page is a code she never says on the phone. | ADR-103/108 "names before codes" applied to lists and next steps but not to record H1s. **(Still open.)** | H1 = what she would say: **"Luntian Wellness Stores — 100 Acapulco Soap"**, **"Make 100 Acapulco Soap (for Luntian)"**, **"Buy 50 kg Palm Oil from Laguna Oleo"**. The code goes into the small grey eyebrow line ("Customer order SO-26-00003"). |
| 12 | **The owner is shown other people's green buttons** (customer order "Set aside the stock", production order "Get materials", production list "Pour into moulds", "Check quality") | "Must I do this?" | The page shows the next action to anyone with the permission; the owner has all permissions. | For owner and manager show the next step as a **status line with a name**: "Next: Lito (warehouse) sets the stock aside", "Next: Rhea gets the materials". Put the action itself under ⋯ More as "Do it myself". Only show a green button when the role normally acts there. |
| 13 | **Approvals act with no confirmation** (production order, request, purchase order, recipe, set aside) | One tap and it is done; there is no "what happens next" for the PO request. | ux-system §1 principle 7 asks for a confirm on approve, release and post; the code goes straight through. | Keep it one tap, but show a **5-second undo toast**: "Approved. Rhea is told to get the materials. [Undo]". The server supports cancel or reopen before the next step. Where undo is impossible (recipe approval), a confirm sheet: "Approve Calamansi Soap recipe for production from today? [Yes, approve] [Not now]". |
| 14 | **Recent activity reads like an audit log** (Home and Operations Center) | "Owner break glass the user site assignments", "used the owner's override", "saved the stock move GR-26-00004". She thinks something is wrong. | Raw audit verbs and system events are shown to people. | Home shows at most 5 **business events**: "Luntian ordered 100 Acapulco Soap (₱7,000)", "Laguna Oleo's coconut oil passed QA", "Ana sent the Palm Oil order to Laguna Oleo". Hide technical events (moves, site assignments, documents, overrides) from Home; keep them in History of changes. "Break glass" and "override" for an owner acting within her rights should not be shown at all. |
| 15 | **Adding a worker needs an email and gives a raw link** | "Rhea has no email." The link is raw text with no Copy button. | The invite flow is email-first; email is not set up. | Make email optional for floor jobs: **"Sign-in name"** (e.g. `maria.dizon`) + a first password the owner reads out, changed at first sign-in. When a link is used, show **[Copy link]**, **[Show QR code]** (the worker scans it with their phone) and **[Send by SMS]**. Put the 4 floor jobs first in the job list (Machine operator, Warehouse, QA, Planner) and move Production TV, Auditor and IT person under "Other jobs". |

Also seen (lower impact):
- The ₱0 customer order can be saved; it should ask "No price — is this free?".
- "Deliver by" and PO "Arrives on" have no sensible default (today instead of the request's date).
- The recipe copy carries over the 135 g wrapper and "135 g bars" text into the 100 g product without a warning.
- Settings use engineering words (TTL, variance, movement types, buckets).
- The customer page shows 13 sections for a brand-new customer.
- The supplier cannot be used until QA approves each item, and the page does not say who to ask.

---

## Navigation proposal (owner and site manager)

Principles:
- Organise by **the owner's questions**, not departments.
- Use **6 top items** with plain words and icons.
- Have **2 levels at most** (top item → page with big tiles or tabs).
- Remove every repeated menu (chip rows, hub card grids).
- Make the menu word equal the page title (ADR-101 stays).

### Owner (Ana) and site manager (Dino), desktop and tablet

```
[logo]  [⌂ Home] [✓ Needs me 2] [🛒 Sell] [🏭 Make] [📦 Buy & stock] [₱ Money]   [🔍 Search a customer, product or order… ]   [? Help] [AV ▾]
```

| Top item (icon) | Opens | Tabs on that page (one row, max 5, no dropdowns) | Replaces today's |
|---|---|---|---|
| **Home** (house) | The new owner Home (§Page design) | — | Home › Overview |
| **Needs me** (check-list, badge) | One list: approvals + problems that need *this* person + messages that still need them | Approve · Problems · Messages | To approve icon, Problems & alerts, bell (3 doors → 1) |
| **Sell** (truck) | Customer orders (board by step, names first) | Orders · Customers · Prices & offers · Returns | Sales & Customers (5 tabs, 2 dropdowns) |
| **Make** (factory) | Today at the plant: plan for today + batches being made, each with person and step | Today · Production orders · Plan · Quality · Problems | Operations (8 tabs, 3 dropdowns) + Production plan (from Management › More) + Batch records |
| **Buy & stock** (boxes) | Stock overview with "Running low" and "Coming in" on top | Stock · Buy something · Coming in · Suppliers · Counts | Inventory + Management › Purchasing (chips) |
| **Money** (₱) | The Money page (owed to us, we owe, this month) | Owed to us (invoices) · We owe (bills) · Payments · Reports | Management › Finance + Sales › Billing & payments + Reports |

Everything else moves into **Set-up**, opened from the avatar menu ("AV ▾") and from Search:

| Avatar menu (AV ▾) |
|---|
| My account · Help · **Set-up** (products & recipes, materials, customers*, suppliers*, people & jobs, settings, labels & printouts, shelves and areas, machines, how numbers look) · History of changes · IT and system · Reset demo data · Sign out |

\*Customers and suppliers also stay as tabs where they are used.

Removed from owner and manager menus (still reachable through Search and Set-up, and through record links):
- Floor screen (TV), Decide many lots at once, Change requests, Recall check, Repack, Check the labels in an area, Boxes and sacks, Stock changes, Labels printed, Lists sent by email, What each number means, Compare over time, Sales guess, How suppliers do, Send back to supplier, Close the month, Tax rates.
- Units, Choice lists, Reasons, Sites, Warehouses, Making areas.
- The sync cloud (shown only when something waits to sync).
- **Removed entirely:**
  - the Purchasing chip row on Purchasing pages;
  - the Management hub card grid;
  - the "Help & my account" tab on Home (it is in the avatar menu);
  - the second "Open menu" button on phones;
  - the duplicate magnifier icon.

Width check at 1280:
- logo 24–68, then 6 pills ≈ 640 px (84–724), then Search 740–1000;
- then Help 1016–1060 and avatar 1068–1112;
- the To approve icon and bell are gone: they are the "Needs me" pill.
- 168 px are spare, which satisfies the ADR-123 fit rule.

At 1024–1279, the pills show icons + words at 13 px and Search shrinks to 200 px with the word "Search". At 768–1023, the pills go to the drawer and the top bar is ☰ · logo · **[🔍 Search]** · Needs me · avatar.

### Phone (390)

```
Top bar:     [☰]  Bryel's Care            [🔍 Search]  [AV]
Bottom bar:  [⌂ Home] [✓ Needs me •2] [🛒 Sell] [🏭 Make] [₱ Money]
```

- "Buy & stock" and Set-up live in the ☰ drawer, which lists the same 6 items + Set-up. Only **one** menu button; Esc and a swipe close it.
- Search opens a full screen: the box at the top, **"Scan a label"** as its first big button, then recent records. Search is no longer under Inventory.
- The tab row on phones scrolls with a visible fade and an arrow, or wraps to two lines. It never hides the 3rd tab half-cut behind "More" (`02-owner-home-phone-fold.png`, `47-phone-so.png`).

---

## Page design notes (app-wide)

1. **Owner Home: one question per band, the biggest number = the most important.**
   - Before (`02-owner-home-lap.png`): a 2-line intro, a QA "next" box, 4 equal pastel cards (one red for 0), a 10-row pipeline with full-width bars ("Materials ready 15" the longest), a sales chart, then 8 audit-style activity lines.
   - After:
     - **Band 1 (one line, large):** "Everything is on track today ✓", or "2 things need you" + [Open Needs me].
     - **Band 2: Money**, 3 big ₱ numbers: "Sales this month ₱19,240 (↑ vs October)", "Customers owe us ₱0", "We owe suppliers ₱4,750 (due 8 Dec)".
     - **Band 3: Orders**, one line per open customer order: "Luntian · 100 soap · due Fri 20 Nov · 70 ready, 30 being made (Rhea, step 4)".
     - **Band 4: At the plant today**, 3 lines with names: "Rhea: Acapulco Soap, pour into moulds" · "Nina: check 1 lotion batch" · "Lito: put away coconut oil".
     - **Band 5: Watch out**, only when non-empty: expiring, running low, stopped by QA, late.
     - Remove the pipeline (it lives on Make › Today and How work flows) and the activity feed (History of changes).
2. **Record header template (ADR-119), names before codes.**
   - Before: H1 "SO-26-00003", subtitle "Luntian Wellness Stores", a 10-chip stepper (`08-so-saved.png`).
   - After: eyebrow "Customer order · SO-26-00003"; H1 **"Luntian Wellness Stores — 100 Acapulco Soap"**; one line "Due Fri 20 Nov · ₱7,000"; a **5-step** stepper in owner words (Ordered → Ready → Packed → Sent → Paid). The fine steps (second check, proof) show inside "Packed" and "Sent".
3. **Dates.** Detail pages use "08 Nov 2026" and "20 Nov 2026"; messages use "Thu 19 Nov". Use **"Fri 20 Nov"** everywhere within this year and "20 Nov 2027" otherwise. Times: "15:10" → "3:10 pm" (Philippine habit; make it a setting). Native date inputs show "11/15/2026": add a line under them, "Sun 15 Nov".
4. **Codes in grey monospace everywhere** (PRD-0001, MAT-0002, FG-01, L-2611-00015, GR-26-00004) add noise for owners. Rule: owner and manager pages show codes **only** in the eyebrow and in Search results. Lists and messages show names and places ("Finished goods bay", "lot from 7 Nov"). The order-set-aside list (`10-so-setaside-after.png`) shows 3 identical rows with lot and product codes; collapse them to "70 bars on the Finished goods bay (3 boxes)".
5. **Intro sentences ("This screen is for…").** Every page opens with one, often 2 lines plus "more". For a novice they are read once, then they push the action down. Keep them, but **only the first 3 visits per user per page**, then fold them into the "?" button.
6. **Colour.**
   - Pastel cards (green, blue, yellow, red) carry no meaning on Home, and red on "0 to approve" reads as an alarm. Use neutral white cards; colour only a card whose state needs attention (amber "late", red "stopped"), always with icon + word (ux-system §1.4).
   - The green "What to do next" box is good. Keep **one** per page and make it the only green button.
7. **Density on desktop.**
   - Forms float in a 768 px column with 300 px empty either side (`16-request-new.png`) while the chip row above is full width. Put a short help or summary panel on the right ("What happens next: Dino approves, then Joy sends it to the supplier").
   - Or keep forms centred and **drop the chip row** (problem 10).
8. **Confirmation and "what happens next."**
   - Good examples: PO sent → "So can Lito (warehouse) or Dino"; recipe → "approved by you (owner) — no separate QA review".
   - Missing: after customer order confirm, production order approve and problem report. Standard toast: "Done. Next: <name> <does what>, usually within <time>. [Undo]".
9. **Messages and Settings words.**
   - Ban "post", "TTL", "variance", "buckets", "movement types", "audit event <id>", "next request", "break glass", "override" from owner and manager screens; extend `tests/unit/no-jargon-messages.test.ts` to audit-feed verbs and settings labels.
   - Settings: show the 6 groups an owner cares about first (Approvals, Sales, Buying, Stock, Quality, Labels) and fold the 17 others under "Technical (IT person)".

---

## Bugs found (separate list, with steps to reproduce)

| # | Bug | Steps to reproduce | Seen |
|---|---|---|---|
| B1 | "Send to the supplier" shows **"Something went wrong. The change was not saved."** but the purchase order **is** sent (status "Sent – waiting for the delivery", history "sent to the supplier", email "pending"). | Owner: make a PO (see B2), Approve, press **Send to the supplier** with the email option on (email not set up). | `23-po-send-click.png`, `24-po-send-box.png` (PO-26-00003) |
| B2 | PO wizard step 4 says "price on save / worked out on save", then refuses "Line 1: enter the unit price (no supplier price is recorded for MAT-0002 per kg)". The only price field is on step 2 inside "A different price (you can skip this)". | Owner: request to buy Palm Oil 50 kg (no supplier, no price) → approve → Make the purchase order → Laguna Oleo Supply → Next → Next → Save and send for approval. | `20-po-step4.png`, `21-po-saved.png`, `22-po-price-open.png` |
| B3 | Contradictory and false texts: request page "No supplier or price was named… the order goes to the manager for approval"; PO wizard "Supplier Laguna Oleo Supply, **as named on the request**… the order **needs no second approval**"; the PO then waits for approval. | Same as B2; read the request after approval, the wizard banner on step 2, and the PO after saving. | `18-pr-approved.png`, `19-po-from-pr-2.png`, `22-po-saved.png` |
| B4 | **"Report a problem" missing** from ⋯ More on the batch record `/production/[id]`, the stock lot page `/inventory/[id]` and step pages, for owner and manager. `/quality/deviations` and `/quality/deviations/new` tell users to use exactly that menu. It exists only on `/quality/batches/[id]` and `/quality/lots/[id]`. | Manager: Operations › Quality › Problem reports → read instruction → open batch B-26-0003 record → ⋯ More. | `40-mgr-problems.png`, `40-mgr-problem-new.png`, `43-mgr-batch-more.png` |
| B5 | Home and Operations Center "Recent activity" shows raw audit verbs: "Ana Villanueva **owner break glass the user site assignments**", "**granted the user site assignments** · maria.santos.op@…", "**used the owner's override** on the purchase order", "used the purchase order to Laguna Oleo Supply", "made the purchase order · DOC-26-0000009". | Owner: add a person (invite) and approve your own PO; then sign in as manager and open Home. | `39-mgr-home-lap.png`, `40-mgr-opscenter.png` |
| B6 | Generic browser title "Bryel's Care ERP" (no page name) on `/admin/users`, `/procurement/suppliers/[id]`, `/quality/deviations`, `/quality/deviations/new`, `/quality/deviations/[id]`. | Open each page and read the tab title. | t32/t34/t40/t46 logs |
| B7 | The production order form offers the same choice twice: "Split into 1 batch · 1 batch of 100 bars" and "Make it one batch · 1 batch of 100 bars". | New production order, Acapulco Soap, 100 bars. | `13-prod-new-filled.png` |
| B8 | New customer number **CUS-0001** while seeded customers are **CUS-001**, **CUS-002** (different width; sort and recognition break, and there is a risk of look-alike numbers). | Sales & Customers › Customers › New customer → save. | `34-customer-saved.png` |
| B9 | Messages are not closed when their subject is done: owner keeps 4 NEW "Production order waits for your approval WO-26-00001…04" (all approved at seed); manager keeps NEW "Request to buy waits for approval PR-26-00001", "Purchase order waits for approval PO-26-00003", "Production order waits for your approval WO-26-00005" after the owner approved them. | Fresh demo: open the bell as owner. Approve a PR/PO/WO as owner, then open the bell as manager. | `15-messages-owner.png`, `40-mgr-messages.png` |
| B10 | Customer order with part stock set aside: the stepper still shows "Confirmed (current step) / Set aside (not yet)" while the line says "set aside 70 of 100". The same page says "coming: 30 being made · **nothing needs making**" and "30 pcs short… the order waits". The refusal text uses the code "PRD-0001" instead of the product name. | Owner: new customer order Luntian, Acapulco Soap 100 → Save → Send → Set aside the stock. | `10-so-setaside-after.png` |
| B11 | Operations Center "Batches being made" shows **Due 08 Nov 2026** for WO-26-00005 whose "Needed by" is 19 Nov (Due seems to use "Finish by", which defaults to the start day). | Create a production order with Needed by = 19 Nov, approve, open Operations Center. | `40-mgr-opscenter.png` |
| B12 | Phone drawer does not close with **Esc** (the overlay stays; the bottom "Menu" can no longer be pressed). Two buttons named "Open menu" exist (top ☰ and bottom Menu). | 390×844: tap ☰, press Esc. | `47-phone-drawer.png` (Playwright: overlay intercepts clicks after Esc) |
| B13 | The batch record `/production/[id]` lights **Management** in the top menu and "More" in the tab row (it lives under Management › More › Batch records). It should light Operations or Make. | Open any batch record from a production order. | `43-mgr-batch-more.png` |
| B14 | To approve count lagged the list: at first sign-in Home showed "Waiting for your approval **0**" while the To approve list already held 1 item (QA batch, waiting since 15:06). In `15-approvals-owner.png` (15:12) the list shows 1 item and the top-bar icon has no badge. The badge showed **1** by 15:14 (`16-request-new.png`). Probably a cached count; it is consistent now. | Reset demo, sign in as owner, compare the Home card, the top-bar badge and `/approvals` within the first minutes. | `02-owner-home-lap.png`, `15-approvals-owner.png`, `16-request-new.png` |
| B15 | Settings: the card says "You can change it alone (with your password)" but the button reads **"Send for OK"**. It saves immediately with "Saved. The change applies from the next request. **Audit event 01a1ba07-…**" (UUID and technical words). | Owner: Settings › Scan and search › Change → Off → reason → password → Send for OK. | `37-settings-change-open.png`, `38-settings-after.png` |
| B16 | PO wizard step 3 "Arrives on — Suggested: today" ignores the request's "Needed by 15 Nov"; the PO is created with Expected 08 Nov (already "due today"). | As B2, look at step 3 and the saved PO "comes 08 Nov 2026". | `20-po-step3.png`, `22-po-saved.png` |
| B17 | Recipe wizard: after "Copy from this recipe", "How do you count one batch?" switches from pieces to "By weight (kg)" without a word. The 135 g wrapper and "Cut the block into 135 g bars" are copied into a 100 g product with no check. | New recipe → Make a new product (100 g) → Next → copy Acapulco Soap 135 g. | `29-rw-copied.png`, `29-rw-step5.png` |

Not reproduced as a bug: the To approve row title "Aloe Hand Lotion 250 mL: a batch B-26-0002" renders with a space (text extraction only).

---

## Re-check of earlier rounds (owner and manager scope)

| Earlier item | Status now |
|---|---|
| Back links on records; Home always reachable | Fixed |
| One "What to do next" per record | Fixed on records. Owner and manager see other roles' green buttons (problem 12) |
| Names before codes (ADR-103/108) | Lists and next steps fixed; **record H1s, messages and set-aside rows still lead with codes** |
| "Make for this order" from a short customer order (END_TO_END P7) | **Still open**: no link from production order to customer order |
| One approval per purchase (ADR-110 C15) | **Partly**: still two approvals when the request names no supplier or price |
| Recipe wizard keeps product and makes it orderable (ADR-116) | Fixed |
| Owner approves recipes alone (ADR-117) | Fixed, with a clear GMP note |
| Owner changes settings alone (ADR-127) | Works; button word wrong (B15) |
| Master search (ADR-121) | Works well **once found**; not discoverable at ≥1280 px or on phones (problem 1) |
| Menu fit at 1280 (ADR-123) | Fits, but by hiding every top-bar label |

## Not covered

- Receiving the delivery and invoice approval: no invoice exists in the small demo, and receiving is the warehouse persona's job.
- Dark mode.
- A real phone: Playwright emulation only.
- Screen readers.
