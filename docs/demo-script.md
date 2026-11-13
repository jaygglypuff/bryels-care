# Client demo script (presenter's guide)

A short walk-through of the Bryel's Care ERP on the **small demo** (owner request 2026-11-06). The
demo has one plant, two products and a few records, each stopped at a different step. You pick
them up and carry them one step further while the audience watches.

**The story in one sentence:** the plant makes Acapulco Soap and Aloe Hand Lotion; one soap batch
is done and in boxes, one lotion batch waits for QA, one soap batch is half made, one lotion order
waits for its materials, a supplier delivery waits on the dock, and a customer waits for soap.

**The four messages to land:**

| Message | Where the audience sees it |
|---|---|
| **Traceability**: every gram is linked from supplier lot to customer | Scenes 3, 5, 7 |
| **Quality control**: nothing is used or sold until QA says OK | Scenes 2, 4 |
| **Operator-first**: big buttons, one job per screen, works on a phone | Scenes 3, 5 |
| **The owner sees it all**: Home says what to do next | Scenes 1, 8 |

---

## 1. Before the demo

### 1.1 Address and accounts

- Open the app in Google Chrome (the address your engineer gives you). The green bar at the top says
  **Demo environment — fictional data**.
- Every demo account uses the password **demo1234**. All emails end in `@bryels-care.test`.
  On the sign-in page you can also tap **Try the demo** and pick a person.

| Sign in as | Person (fictional) | Job in the story |
|---|---|---|
| `owner@` | Ana Villanueva | Owner: sees everything, Home says what to do next |
| `manager.nfd@` | Dino Reyes | Site manager: approves production orders and purchase orders |
| `planner.nfd@` | Cora Villamor | Planner: makes production orders and recipes |
| `operator.nfd@` | Rhea Mendoza | Operator: makes the batches |
| `checker.nfd@` | Jun Dela Cruz | Second operator: checks the weighing |
| `warehouse.nfd@` | Lito Pascual | Warehouse: deliveries, shelves, getting orders from the shelf |
| `qa.nfd@` | Nina Quiambao | QA: checks materials and batches |
| `qa.lead@` | Teresa Ocampo | Second QA person (approvals that need two people) |
| `procurement@` | Joy Navarro | Buying: purchase orders |
| `sales@` | Mara Santos | Sales: customer orders |
| `finance@` | Rosa Lim | Finance |
| `floor.nfd@` | Floor TV North Fields | The TV on the production floor (look only) |

The plant is **North Fields Plant**. There is only this one plant in the small demo.

### 1.2 Start fresh (always do this before presenting)

Sign in as `owner@`, open **Reset demo data** in the green bar, type `RESET` and confirm. It takes
about 10 seconds and puts every record back at the step in the table below. Everyone is signed out.

A new deploy of the app with new demo data does this by itself the first time it starts
(see `docs/deployment-railway.md` §2.4).

### 1.3 What is in the demo

| What | Where it stopped | Who picks it up |
|---|---|---|
| **Acapulco Soap 135 g**, one recipe, one list of steps | approved | — |
| **Aloe Hand Lotion 250 mL**, one recipe, one list of steps | approved | — |
| Production order 1, Acapulco Soap | done: QA said OK; 120 made, 2 kept as samples, 118 to sell, in 5 boxes (4 of 24 and 1 of 22), box labels printed, on the **Finished goods bay** | — |
| Production order 2, Aloe Hand Lotion | made, waiting for the **QA check** in the QA waiting area: 96 made, 2 kept as samples, 94 to sell | `qa.nfd@` (scene 2) |
| Production order 3, Acapulco Soap | in progress: weighed, heated and mixed; next step **Pour into moulds** | `operator.nfd@` (scene 3) |
| Production order 4, Aloe Hand Lotion | approved, ready for **Get materials** | `operator.nfd@` (scene 5) |
| Purchase order to Manila Print & Pack (wrappers, bottles) | **sent** to the supplier | — |
| Purchase order to Laguna Oleo Supply (coconut oil, glycerin) | delivered: the coconut oil is OK and **waits to be put on a shelf**; the glycerin **waits for the QA check** | `warehouse.nfd@` (scene 4), `qa.nfd@` |
| Customer order from Luntian Wellness Stores (48 soap bars) | 2 boxes set aside: **ready to get from the shelf** | `warehouse.nfd@` (scene 6) |
| Customer order from Isla Spa Supplies (48 lotion bottles) | confirmed; production orders 2 and 4 are made for it, so it is **covered by stock that is coming**: production order 2 made 96 bottles (2 kept as samples, 94 to sell) that wait for QA, and the order needs 48 of them, so it is not short | after scene 2 |

Stock to show "use first": one **Palm Oil** lot expires in about 20 days (it is used first), one
**Coconut Oil** drum is already opened (part used by the soap batches), and one **Glycerin** lot waits
for the QA check.

The scale and the mixer are clean and calibrated (next calibration in about 60 days), so a new batch
can be weighed at once. Every batch belongs to a production order, and nothing waits in the
sending-out bay.

Numbers like `WO-26-00003`, `B-26-0003` or `L-2611-00016` contain the year and month of the reset,
so they change from month to month.

---

## 2. The demo, scene by scene

### Scene 1: The owner's morning (2 min). Sign in as `owner@`

1. **Home** opens. The green box **What to do next** says what needs someone today (for example
   "1 finished batch waits for the QA check").
2. Point at the cards: sales today, production progress, stock to look at, waiting for approval.
3. Tap **Operations → Production orders**. Four orders: one done, one at the QA check, one in
   progress, one approved. Say: "each one is at a different step; we will move them along."

### Scene 2: QA checks the lotion (2 min). Sign in as `qa.nfd@`

1. Home shows the lotion batch waiting for the check. Open it.
2. Type the test results (pH between 5.0 and 6.5, "Looks right": Conforms). These test names and
   limits are **examples only**; the company's QA sets the real ones.
3. Tick **I looked at the batch record and the things that did not go as planned**, tap **OK to use**, then
   **Yes, OK to use**. The lotion is now OK to sell and moves to
   the finished goods bay. The Isla Spa order (this production order was made for it) can now get its bottles.
4. Before this scene, **How work flows** shows the Isla Spa order as "waiting for stock that is coming:
   48 waiting for QA" — not red, nothing needs making. (96 made, 2 kept as samples, 94 to sell wait for QA;
   the screen counts only the 48 this order needs.) Every production order in the demo was made by
   the planner (Cora) and approved by the site manager (Dino).
5. **Presenter note (which lot is set aside):** when the Isla Spa order gets its stock set aside after the
   full rehearsal, the system takes the lotion of production order 2 (loose bottles), not the new boxed batch
   of production order 4, although both have the same use-by date. This is the company's "use first" rule
   (FEFO, `allocation_rules`, A-PRD-16): what expires first goes first; on the same use-by date, the one made
   first, then the one that came into stock first (FIFO), then the lot number (`compareCandidates` in
   `src/modules/inventory/reservations.ts`). Inside a lot, whole boxes go before loose pieces (ADR-050). So the
   new boxes stay on the shelf. That is correct, not a fault; if the audience asks, say "the oldest stock
   leaves first".

### Scene 3: The operator finishes the soap (3 min). Sign in as `operator.nfd@` (phone size is best)

1. Home shows **Pour into moulds** for the soap batch. Tap it and tap **Step done**.
2. The next step is **Cure**. The screen shows when the curing is finished (2 days in the demo).
3. Open step 7 **Wrap and pack** to show what comes: it is locked ("Finish step 4, 5 and 6 first; then you
   will pack 24 bars in a box and print one label per box"), with the planned boxes and the box label.
4. **Print the BMR** of this batch: it prints a working copy marked "IN PROGRESS — NOT THE FINAL RECORD"
   with everything recorded so far. The final record is generated when the batch is done.
   Say: "the system will not let anyone cut the soap before it is hard; ending early needs a
   problem report for QA."

### Scene 4: Put the delivery away (1 min). Sign in as `warehouse.nfd@`

1. Home says the coconut oil is ready to put away. Tap **Put away**, scan or pick the **Oils rack**,
   confirm.
2. Show that the glycerin of the same delivery still waits for QA: it cannot be put on a shelf or
   used until QA says OK.

### Scene 5: Get materials for the lotion (2 min). `operator.nfd@`

1. Open production order 4 (Aloe Hand Lotion). (If you open **Weigh** first, it says "Start the batch first:
   get the materials, then do the clean-area check on step 1".) Tap **Get materials**.
2. The list says which lot to take from which shelf and how much, the one that expires first
   first. Tick them and confirm. The next screen is the start check (**Check the area is clean**).

### Scene 6: Get the customer's soap from the shelf (2 min). `warehouse.nfd@`

1. Open the Luntian Wellness Stores order from Home, or **Operations → Packing & dispatch → To get from shelf**
   (office people: **Sales & Customers → Customer orders**). It is ready to get from the
   shelf: two boxes on the **Finished goods bay**.
2. Scan the two box labels (or tap them). The order moves on to the second check of the box.

### Scene 7: Where did it come from? (1 min). `qa.nfd@` or `owner@`

1. Open the soap lot of production order 1 (scan a box label or search its lot number).
2. Show the trace: the coconut oil, palm oil and wrapper lots that went into it.
3. Show the way forward. The soap is not sent out yet, so **Waiting to be sent to a customer** names the
   order: "Set aside for order SO-… (Luntian Wellness Stores)" before scene 6, or "Taken off the shelf for
   order SO-… (Luntian Wellness Stores)" after it. **Customers who got it** still says "No customer has
   received this". Say: "if QA stops this lot now, we know which order to hold, before it leaves."
4. To show a lot that did leave, trace the lotion lot sent to Isla Spa Supplies (after the full
   rehearsal): it reads "Sent to Isla Spa Supplies on <date>" with the order and the delivery receipt.

### Scene 8: The owner sees what happened (1 min). `owner@`

1. Back to Home. The numbers moved: the lotion passed, the soap order moved on.

---

## 3. If something goes wrong

| What you see | What to do |
|---|---|
| "Email or password is incorrect." | Check the email ends in `@bryels-care.test` and the password is `demo1234`. |
| "This account is locked" | Five wrong passwords lock an account. Reset the demo data (1.2). |
| You are suddenly on the sign-in page | The demo data was reset (by you or by a new deploy). Sign in again. |
| A record is not at the step in the table | Someone used the demo after the last reset. Reset (1.2) during a break. |
| A button shows a red message | Read it aloud. It is a rule of the system (for example "the checker must be a different person"). |
| The page is blank or shows an error | Reload the page. If it stays, call your engineer. |

---

## 4. What is real and what is not

- **Everything you click is real**: it runs the same rules, numbers, stock postings and audit trail
  as real work. The demo records themselves were made with those same commands when the demo was
  loaded.
- **All data is fictional**: company, people, suppliers, customers, prices and lots.
- **Recipes, amounts, the 2-day cure, test names and limits are demo values.** The company's QA and
  process owner set the real ones. In the demo the materials do not ask for a certificate (CoA) file,
  because no files are attached; QA turns "needs a certificate" on per material.
- **Signatures are records of who did what and when**, not validated electronic signatures.

---

## 5. For engineers

- Profile: `DEMO_PROFILE=lite` (default) loads `src/db/seed-demo.ts` → `src/db/seeds/lite.ts`; `full`
  loads the older large seed `src/db/seed.ts` (used unchanged by the integration tests).
- Every storyline record is made through the services (recipe wizard `saveRecipe`, `receiveAndPost`,
  `decideLot`, `putAwayLot`, purchase order commands, `createProductionOrder` / `approveProductionOrder`,
  `confirmPicked`, weighing, `stepDone`, `planBatchBoxes`, `finishBatch`, `decideQualityCheck`,
  `createOrder` / `submitOrder` / `allocateOrder`). The one shortcut: the finished soap batch's cure
  step start and "ready at" are moved two days back after the service opened it.
- `DEMO_SEED_VERSION` (`src/lib/demo.ts`) is written into the completeness marker
  (`platform.demo.seeded`, `after.profile` / `after.seedVersion`). Raise it whenever `lite.ts`
  changes so the next deploy reloads the demo.
- Tests: `tests/integration/platform/demo-lite.test.ts` (storyline, version reload, guards),
  `tests/unit/demo-profile.test.ts`.
- Browser rehearsal of the whole story (ADR-122): reset the demo, then
  `BASE=http://localhost:PORT node tests/e2e/demo-rehearsal.cjs` (screenshots in `SHOTS_DIR`, default the system temp
  folder). It runs scenes 1–8 and carries the lotion order on to the invoice: Get materials, Weigh (each lot label
  scanned, Jun confirms from his list "Waiting for you to check", one card for the batch's weighings, ADR-130), the steps,
  piece and box labels in one print trip, Finish as the last step, Check quality, set aside, get from shelf,
  second check (Dino), send out, proof of delivery, invoice (₱8,880 is below the ₱50,000 one-step amount, so Rosa saves
  it to the books alone with her password, ADR-131 §6; above that amount it goes to Ana on To approve first). Set aside
  and approvals ask "… ? Yes, continue" first. `ONLY=d,e` runs single sections. The server needs `FILE_STORAGE` (the signature on the proof of delivery is a
  file); a production build (`pnpm build && pnpm start`) is steadier than `next dev` for a full run.
- The old screenshots of the full demo (`docs/demo/*.png`, 23 Oct) were removed on 2026-11-06 (ADR-115 §5): they no longer matched the app.
