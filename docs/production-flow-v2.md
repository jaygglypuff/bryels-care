# Production flow v2: one order, few steps, made for a small soap and lotion plant

**Status.** Proposed design (manufacturing process engineer, 2026-10-30). Not built yet. Nothing in
this document changes code. When the owner accepts it, the principal architect records it as
**ADR-080 "Production flow v2"**, which amends ADR-074 (status mapping, see §3), and the new assumptions
(`A-PF2-nn`, Appendix D) go into `docs/PRD.md`.

**Binding decisions this design follows.** ADR-073 (owner override, audited), ADR-074 (one production
order; Draft → Approved → In progress → Done; daily log with defects), ADR-076 (editable lists),
ADR-077 (warehouse sections), ADR-078 (checker picks their name; second-person weighing check is a
setting), ADR-079 (Acapulco soap example). Owner decisions from the iPad trial: simple everyday
English, the owner can do everything alone (audited), the operator should not be bombarded with fields.

**Every formula, time, temperature, limit, tolerance and defect type below is an example. Verify with
authorized personnel before production use.** Statements about GMP are marked
**[GMP: confirm]** where they are a judgement that a GMP consultant must confirm.

**Reading time.** Sections 1 to 8: about 15 minutes. Appendices A to D are for the people who build it.

---

## 1. Principles

### 1.1 How the new flow behaves

1. **One thing to follow.** The owner follows a *production order*. Batches, weighings, steps and QA
   records still exist underneath, but are reached from the order, never as separate menus.
2. **One big button.** The order page always shows one next action ("Approve", "Get materials",
   "Start", "Weigh", "Next step", "Finish", "Check quality"). Nobody has to know which screen comes next.
3. **One screen per step, one decision per screen.** A step screen shows the instruction, at most three
   fields, and "Done". Everything else is under "More details".
4. **Defaults everywhere.** Today's date, the formula's batch size, the oldest usable lot (first expiry,
   first out), the site's usual scale, the usual hold area, the person signed in, the counts already
   written in the daily log. The operator corrects a default; they do not type it.
5. **Exceptions only when needed.** A second person, a reason, a photo or an approval is asked *only*
   when something is outside the limits or a setting requires it. The happy path has no extra fields.
6. **Nothing is faked and nothing is lost.** Every tap is recorded with who and when. Posted stock and
   finished records are never edited; a mistake is corrected by a new entry with a reason (unchanged
   rule).
7. **Words a Filipino operator uses.** "Weigh", "Mix", "Pour", "Cut", "Cure", "Wrap", "Good bars",
   "Rejects", "Hold area", "Pass / Fail". No "dispense", "staging", "quarantine", "disposition",
   "routing", "line clearance" on operator screens (glossary in §6.3).
8. **Same engine, simpler face.** The state machines, stock ledger, formula snapshot, lot checks,
   QA release and audit stay as built and tested. v2 changes what people see and merges taps into single
   commands; it does not remove controls that GMP needs.

### 1.2 What GMP really asks of a small cosmetics maker, and what is optional

The reference is ISO 22716 (cosmetics GMP guideline) and the ASEAN Cosmetic GMP guideline that the
FDA Philippines refers to for cosmetic manufacturers **[GMP: confirm which document and edition the
FDA Philippines applies to Bryel's licence]**. Neither one prescribes software screens, statuses or
signature methods. They ask that the work is controlled, written down and traceable.

| # | Control | Required or optional | Our default in v2 | Note |
|---|---|---|---|---|
| G1 | A batch record for every batch: product, batch number, formula version, each material with its lot and actual quantity, dates, who did each step | **Required** | Always on, built automatically from the taps | Core of ISO 22716 production and documentation clauses. |
| G2 | Only accepted (released) raw materials and packaging are used | **Required** | Always on (lot status checked at weighing and at wrapping) | |
| G3 | Correct material, correct amount (within the tolerance the company set) | **Required** | Always on; wrong lot or out-of-tolerance weight is blocked unless approved with a reason | Tolerances are the company's to set. |
| G4 | Scales and measuring equipment are checked or calibrated | **Required** | Calibration status checked when the scale is used (existing rule); daily scale check is one item of the Start check | How often: company SOP **[GMP: confirm]**. |
| G5 | A **second person** verifies each weighing | **Judgement** **[GMP: confirm]** | Setting with three choices: *all lines / only lines marked "needs a check" in the formula / none*. Recommended: **only marked lines** (lye solution, colour, extract, fragrance, preservative) | Many small makers meet the intent with a check of critical additions. A name-only signature (ADR-078) shows who was named, not proof they were present. |
| G6 | Area and equipment are clean and free of the previous product before starting, and before packaging | **Required in substance**; the form (checklist, how many, who signs) is the company's choice | One short **Start check** inside "Start", and one short **Before wrapping check** inside the wrapping step. Checker off by default | The paper BMR has three clearances; v2 keeps two checklists because label mix-ups happen at packaging. |
| G7 | In-process checks the company defined are done and recorded | **Required** (once the company defines them) | Shown as readings on the step (0 to 3 per step) | Which checks: QA decides (examples in §4). |
| G8 | Finished product checked against its specification and **released by an authorized person** before sale | **Required** | "Check quality" with Pass / Hold / Fail; stock is sellable only after Pass | Whether the owner may release their own batch is a **judgement [GMP: confirm]**; the owner override (ADR-073) records every case. |
| G9 | Batch number (and expiry where applicable) on every unit | **Required by labelling rules** **[GMP: confirm with the regulatory adviser]** | The batch number and expiry are printed on the order page and the wrap label | |
| G10 | Retained (reference) samples of each finished batch | **Judgement** **[GMP: confirm]** | Setting, default **on: keep 2 units** per batch, recorded at Finish | ISO 22716 refers to retaining samples; quantity and time are the company's. |
| G11 | Deviations (anything outside the procedure) are recorded, assessed and approved | **Required** | A "Report a problem" button on every step; required only when a limit is broken | |
| G12 | Reconciliation of printed packaging (wrappers, labels with batch codes) | **Good practice, expected for printed items** **[GMP: confirm]** | On for wrappers and labels; tolerance 0 by default | Prevents printed labels going astray. |
| G13 | Yield compared with expected | **Good practice** | Shown automatically; outside the range needs a reason | Limits are the company's. |
| O1 | Separate warehouse transfer to a staging location, scanning every lot | Optional | **Off**: a pick list with "Got it" ticks; the lot is confirmed at weighing | Traceability is kept by the weighing record (G1). |
| O2 | Password for every co-signature | Optional (not in ISO 22716) | Off (ADR-078) | Recommended alternative: each person signs in with their own short PIN on the shared tablet (future). |
| O3 | Tare / gross / net, equipment selection on every step | Optional | Net weight only; usual scale preselected | Tare/gross stay under "More details". |
| O4 | A separate "close batch" step after QA release | Optional | **Merged**: Pass closes the batch automatically when nothing is open | The required part is reviewing the batch record before release (in "Check quality"). |
| O5 | Two-person approval of reopening a closed batch | Optional | Kept as built, reached only from "More details" | Rare event. |
| O6 | Paper pages scanned and reviewed | Optional | Hidden unless the setting "We also keep paper records" is on | |

---

## 2. End-to-end flow: from demand to stock

```
Customer order / low stock
        |
  [1] New production order ........................ Draft
        |
  [2] Approve (checks and sets materials aside) ... Approved
        |
  [3] Get materials (pick list) ................... Approved  "Getting materials"
        |
  [4] Start (Start check) ......................... In progress
  [5] Weigh ....................................... In progress "Weighing"
  [6] Make: mix, pour (lotion: heat, mix, cool) ... In progress "Mixing"
  [7] Wait: set in mould, cure (lotion: rest) ..... Curing     "Curing until 4 Dec"
  [8] Cut / Fill, Wrap / Label (+ in-process checks)In progress "Wrapping"
  [9] Finish: count, rejects, wrappers, hold area . Quality check
 [10] Check quality: Pass / Hold / Fail ........... Done (or back to Quality check / In progress)
 [11] Ready to sell: stock, customer order told ... Done
```

Daily log ("What happened today") can be added on any day from step 4 to step 9 (§5.1).

### 2.1 Step by step

Legend: **M** = always mandatory; **S** = switchable setting (default shown).

| # | Step (operator word) | Who | Trigger | What the person sees and enters | What the system does by itself | Status shown | Mandatory / settings | Typical time | When it goes wrong |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **New production order** | Owner or planner | (a) "Make for this order" on a customer order that is short; (b) low-stock alert "Make more"; (c) "+ New order" | Product (search); **How many** (pieces or batches, defaults to whole batches that cover the need); **Needed by** (defaults to customer order date, else today + lead time). More details: line, batch size, number of batches, notes. | Picks the approved formula and steps; rounds to whole batches; shows expected pieces ("2 batches ≈ 247 bars"); links the customer order line; gives the order number. | Draft | M: product, quantity. Draft can be deleted (ADR-075). | 1 min | No approved formula: message with "Who can approve the formula" (ADR-073 who-can-do). |
| 2 | **Approve** (also inline in **To approve**, kind `approval.production_order`; the approvers at the site get an in-app notification when the order is created) | Owner or manager | Draft order | One button "Approve". If materials are short: list "Coconut oil: need 7.4 kg, have 4 kg, short 3.4 kg" with **Buy** (creates a purchase request) and **Approve anyway** (only if the setting allows). | In one transaction (exists, ADR-074): plan, release, set the oldest usable lots aside (FEFO), create the batch(es), freeze the formula and steps used (snapshot), batch number. | Approved | M. S: second approver different from creator (`approvals.sod.work_order_release`, default as today); "Approve anyway with shortage" (default off). | 10 s | Shortage: nothing changes, list shown. Formula changed after the order: the batch keeps the version frozen at Approve. |
| 3 | **Get materials** | Operator or storekeeper | Approved | Pick list grouped by warehouse section (ADR-077): ingredient, how much, which lot and where ("Palm Oil 8.7 kg, lot PO-0412, Raw materials shelf B"). Tap **Got it** per line or **Got everything**. More details: change lot, scan labels, move stock to the production area. | Ticks are recorded. When every line is ticked the batch becomes "materials ready" (`materials_staged`). With S on, a stock move to the production area is posted. | Approved, "Getting materials" | M: every line ticked (or "not needed"). S: `production.prepare.move_stock` **default off**. S: scanning (default off; "Scan labels instead" link). | 10–20 min | Lot missing or damaged: "Use another lot" offers the next usable lot (approval only if the setting requires substitution approval). |
| 4 | **Start** (Start check) | Operator | Materials ready | Up to 6 yes/no items in plain words, each prefilled blank, plus **All OK**: "Area clean", "No materials or labels from the last product", "Tools and moulds clean", "Scale checked today", "Wearing gloves, goggles, mask" (soap: lye). | Records the checklist; the batch starts (`in_process`); the order shows In progress; start date set. | In progress, "Starting" | M: every item answered. A "No" stops the step until fixed or a problem is reported. S: checker for the Start check (**default off**). | 1–2 min | "No" answer: fix and answer again, or **Report a problem**. Scale out of calibration: blocked, choose another scale. |
| 5 | **Weigh** | Operator (+ checker on marked lines) | Started | One card per ingredient, in formula order: **target** ("3,723.2 g, OK from 3,686 to 3,760 g"), lot **preselected**, field **Weight (g)**, button **Save**. Green tick or red "too much / too little". Lines marked "needs a check": the checker taps their name. More details: tare/gross, another scale, split over two lots. | Checks right material and lot, lot still usable, within tolerance; records the weighing; posts the stock use now (S, recommended on). Progress "3 of 5 weighed". | In progress, "Weighing" | M: all lines weighed and in tolerance. S: second-person check **all / marked lines (recommended) / none** (extends ADR-078 setting). S: `production.post_consumption_at_dispense` recommended **on** for v2 (stock is right on the day). | 15–30 min | Out of tolerance: weigh again; if it cannot be fixed, **Ask for approval** (reason + approver, problem report created). Wrong lot: blocked, shows the expected lot. |
| 6 | **Make** (each step) | Operator | Previous step done | Step card: instruction text, **0 to 3 readings** from the steps set up for the product (e.g. "Oil temperature °C"), button **Done**. Readings outside limits turn red and ask for a reason. More details: equipment, start/end time, photo, note. | Records times, readings vs limits, who did it. | In progress, step name ("Mixing") | M: readings marked required. S: per step "needs a checker" (default off). | Soap mix/pour 30–60 min; lotion heat/mix/cool 2–4 h | Reading out of limits: reason, and a problem report if the step is marked critical. |
| 7 | **Wait** (set, cure, rest) | Nobody; operator ends it | Step of kind curing/hold started | Card: "Curing until **Fri 4 Dec**" with days left. Button **Curing finished** (active from that date). | Calculates the ready date from the minimum time; reminds the operator on the ready date; the board shows the order under Curing. | **Curing** ("Curing until 4 Dec") | M: minimum time. Ending early needs approval with a reason. | Soap: set 1–2 days, cure about 4–6 weeks (example only); lotion: rest 0–24 h | Finished early: approval + reason (existing exception). |
| 8 | **Cut / Fill, Wrap / Label** | Operator | Wait finished | Soap cut step: **Bars cut** (number). Wrap step: Before wrapping check (3 items) + **Wrappers taken** (prefilled from pick list) + **Good bars wrapped** (prefilled from cut − rejects). Lotion: Fill step with fill-weight checks (§4.2). More details: wrapper lot, label template, printed batch code check. | Records counts; prints/updates the label with batch number and expiry. | In progress, "Cutting" / "Wrapping" | M: count; Before wrapping check (S: **default on** for wrapping and filling). | Cut 30 min; wrap 1–2 h per 120 bars | Wrong label or wrapper lot: blocked at the lot check; printed batch code wrong: re-print, spoiled wrappers counted. |
| 9 | **Finish** | Operator | Last making step done | One screen, prefilled: **Good pieces** (from wrap count / daily log), **Rejects by type** (from daily log), **Samples kept** (default 2), **Wrappers: taken / used / spoiled / returned** (only spoiled and returned are typed), **Put in**: hold area (default). Button **Finish**. | In one transaction: records output and yield, rejects as scrap with type, packaging reconciliation, posts remaining stock use, creates the finished lot in the hold area with expiry, creates the quality check task, tells QA. Shows "Expected 123, made 118, 96 %". | **Quality check** | M: good pieces; wrapper balance must be zero (tolerance setting, default 0). S: retained samples (default on, 2). S: checker at Finish (default off). | 5 min | Yield outside the range: a reason is required and a problem report is opened (approval as today). Wrappers do not balance: count again; still wrong → problem report. |
| 10 | **Check quality** | QA person, or owner (audited override) | Finished | Batch summary on one page (what was weighed, readings, rejects, yield, anything outside limits, open problems) and the **tests from the product's check list** (e.g. appearance, weight of 10 bars, pH for lotion). Buttons **Pass**, **Hold**, **Fail**. | Pass: the lot becomes ready to sell, the batch record (BMR PDF) is generated, the batch closes when nothing is open, the order becomes Done. Hold: stays in hold area with a reason and review date. Fail: lot rejected; choose "Redo" (rework) or "Throw away". | Quality check → **Done** | M: all required tests; G8 above. S: who may pass (role `qa_qc`; owner with override). | 10–30 min, often 1–3 days of waiting for tests | Open problem report: Pass is blocked until it is closed or accepted by QA. |
| 11 | **Ready to sell** | System | Pass | Order page: "118 bars ready to sell, lot AS-2611-01, expires 4 Dec 2028". Link to the customer order. | Available stock updated; the linked customer order line is offered allocation (sales module) and the salesperson is notified. | Done | — | instant | Customer order cancelled meanwhile: stock simply stays available. |

### 2.2 How one order for 2 batches is shown

An order shows the status of its **least advanced unfinished batch**, plus "1 of 2 batches done".
Most Bryel's orders are expected to be one batch (ADR-074 default).

---

## 3. Status model

### 3.1 The list the owner and operators see

| Status | Meaning in one sentence | Next action button |
|---|---|---|
| **Draft** | Written down, not approved yet. | Approve |
| **Approved** | Materials are set aside; ready to get materials and start. | Get materials / Start |
| **In progress** | Somebody is working on it (subtitle names the step: Weighing, Mixing, Cutting, Wrapping). | Weigh / Next step / Finish |
| **Curing** | Waiting for time to pass (subtitle "until 4 Dec"). Lotion: "Resting until 14:00". | Curing finished (from the date) |
| **Quality check** | Made and in the hold area; waiting for Pass / Hold / Fail. | Check quality |
| **Done** | Decided: ready to sell (or failed and thrown away, shown in red). | none |
| *Cancelled* | Stopped before starting, with a reason (off the main path). | none |

The **progress strip** stays the owner's four steps (Draft → Approved → In progress → Done, ADR-074).
*Curing* and *Quality check* are shown in the same chip position as waiting states of "In progress" on
the strip, and as their own columns on the owner board, because they are the two places where orders
sit for days and the owner asked to see where an order is stuck. **This changes ADR-074 in two
points: (a) the two waiting statuses are added; (b) "Done" now means QA decided, not "posted to the hold
area".** Today a work order becomes `completed`, and is shown as Done, when its last batch is moved to
quarantine, which is before QA has passed it. That would tell the owner an order is done while the stock
cannot be sold yet.

### 3.2 Mapping from the underlying machines (no new state machine)

The work order (`work-orders-state.ts`) and batch (`state.ts`) machines stay. The simple status is a
read model (`production-order-status.ts`) computed from the least advanced live batch.

| Work order | Batch (least advanced live) | Extra condition | Shown |
|---|---|---|---|
| draft, planned | any | | Draft |
| released | planned | pick list not complete | Approved ("Getting materials" if at least one tick) |
| released | materials_staged | | Approved ("Materials ready") |
| released, in_progress | in_process | an open step of kind `curing` or `hold` is started and not completed | Curing (until `earliest_completion_at`) |
| released, in_process | in_process, rework_approved | otherwise | In progress (subtitle = name of current step; "Redo" for rework) |
| in_progress, completed | awaiting_qc, quarantined | | Quality check |
| completed, closed | all live batches released or rejected (closed or not) | | Done (red "Failed" tag if every batch rejected; "Part failed" if some) |
| cancelled | any | | Cancelled |

### 3.3 What was removed or merged, and why

| Old step the owner saw | v2 | Why it is safe |
|---|---|---|
| Plan, Planned | **Merged into Approve** (done in ADR-074) | Planning is a calculation, not an event on the floor. The production plan screen stays for forecasting only ("advanced"). |
| Release | **Merged into Approve** (done) | Same transaction already. |
| Batch (create) | **Merged into Approve** (done) | Batch number and snapshot are created automatically. |
| Stage (scan each lot to staging) | **Becomes "Get materials" pick list** with ticks; stock move and scanning become settings (default off) | GMP needs the right lot used (checked at weighing, G2/G3), not a transfer transaction. In a small plant the store room and the mixing area are a few steps apart. |
| Line clearance (3 separate signed steps) | **Start check** (in Start) + **Before wrapping check** (in Wrap); checker off by default | Keeps the substance (G6) with two short checklists at the two moments where mix-ups happen; the weighing-area and production-area clearances are the same room in a small plant **[GMP: confirm]**. A site with separate rooms keeps three clearances in its step setup. |
| Weigh | **Kept**, one card per ingredient, lot preselected | Core GMP control (G1–G3). |
| Steps | **Kept**, one step per screen, 0–3 readings | |
| Output, yield, scrap, packaging count, transfer to quarantine (5 forms) | **Merged into Finish** (one screen, prefilled) | Same records written in one transaction; nothing is skipped. The scan of the quarantine location becomes a default hold area (scan still possible). |
| QA (inspection, results, disposition) | **"Check quality"**, one screen with Pass / Hold / Fail | Independent release is kept (G8). |
| Close | **Automatic on Pass** when every closure check passes; otherwise the order page lists what is open | The closure checks are unchanged; only the extra tap goes. |

---

## 4. Product details

### 4.1 Soap (example: Acapulco Soap 135 g, cold process)

**Example step setup** (replaces the five-step example of ADR-079 when accepted; all values to verify
with authorized personnel before production use):

| # | Step | Kind | Readings (example; QA sets which and their limits) | Notes |
|---|---|---|---|---|
| 1 | Start check | line_clearance | checklist only | Includes "lye safety gear on". |
| 2 | Weigh | dispensing | weights | Lye solution, colour and extract marked "needs a check". |
| 3 | Mix and pour | process | oil temperature °C; lye solution temperature °C; trace reached (yes/no) | Mould number under More details. |
| 4 | Set in mould | curing | — | Minimum 24 h (example). |
| 5 | Cut | cutting | **Bars cut** (number); trimmings/ends (g, optional) | Cut weight target shown, e.g. "cut at ___ g" set by owner. |
| 6 | Cure | curing | — | Minimum 28 days (example). Shows "Curing until …". |
| 7 | Wrap and label | packaging | Before wrapping check; good bars wrapped; weight of 10 bars (g) | Wrapper lot checked. |
| 8 | Finish | transfer | (Finish screen) | |

**Cut weight and cure weight loss.** Cold-process bars lose water while curing, so a bar cut at 135 g
will weigh less after curing. The **cut weight target** must be set by the owner so that the cured bar
still meets the declared net weight on the wrapper. The system shows the target; it does not invent it
(A-PF2-04). The weight-of-10-bars reading at wrapping checks it.

**Two yields, both automatic.**

| Figure | Formula | Example (fictional) |
|---|---|---|
| Expected bars | batch mass × expected yield % ÷ bar weight, rounded down | 17,600 g × 95 % ÷ 135 g = 123 bars |
| Cut yield | bars cut ÷ expected bars | 121 ÷ 123 = 98.4 % |
| Final yield | good bars wrapped ÷ expected bars | 118 ÷ 123 = 95.9 % |
| Reject rate | rejects ÷ (good + rejects) (A-S2-04) | 3 ÷ 121 = 2.5 % |

The expected yield % and bar weight come from the formula and product; the acceptable yield range is
the existing setting `production.yield.limits_pct` per product.

**Wrapper reconciliation (one line on Finish).** Taken (from pick list) = Used (= good bars wrapped +
samples) + Spoiled (typed) + Returned (typed). Difference must be 0 by default
(`production.packaging.reconciliation_tolerance`). Spoiled printed wrappers are destroyed and counted,
not reused **[GMP: confirm]**.

**Starter defect list for soap** (editable, setting `production.defect_types`; owner/QA confirm):
Cracked bar · Soda ash (white powder on top) · Air holes · Sweating (beads of water) · Soft bar ·
Wrong weight · Uneven cut / chipped edge · Colour streaks or spots · Bad wrapping · Wrong or missing
batch code · Other.

**What is in stock while it cures?** Bars count as stock only after Finish (in the hold area) and as
sellable only after Pass. While curing they are shown on the owner dashboard as "Curing: 121 bars,
ready 4 Dec" from the cut count (A-PF2-05). The raw materials are already used up at weighing (with the
recommended setting), so stock figures are correct on the day.

**Lye solution.** The paper BMR uses "33.33 % Lye Solution" as one ingredient, i.e. it is made ahead as
its own lot. v2 default: a short production order of the product "Lye solution 33.33 %" (steps: Start
check with safety gear, Weigh sodium hydroxide and water with a check, Dissolve and cool, Label). Its lot
is ready for use after the maker's check; whether QA must pass it first is a setting
**[GMP: confirm]** (Open question 3).

### 4.2 Lotion and cream: what is different

| Topic | Soap | Lotion / cream |
|---|---|---|
| Making steps | mix, pour, set, cut, cure, wrap | heat water phase, heat oil phase, mix (emulsify), cool while stirring, add heat-sensitive ingredients below a set temperature, rest |
| Readings (examples; QA sets limits) | temperatures, trace | phase temperatures °C, mixing time and speed, temperature when adding fragrance/preservative, **pH**, **viscosity** (or "thickness OK" if no viscometer), appearance, smell |
| Where pH / viscosity sit | — | an in-process check on the bulk before filling; a fail stops filling until QA decides |
| Waiting state | curing (weeks) | resting / waiting for test result (hours); same "Curing" status, labelled **"Resting until …"** |
| Bulk | none | the bulk can be held in a tank before filling; optional intermediate lot when filling is on another day |
| Count | bars cut, bars wrapped | **filled containers**; fill-weight check: weigh N containers every X minutes (example: 5 every 30 min), each within the fill tolerance |
| Yield | bars | filled units × fill weight + bulk left in tank vs batch mass; "filling loss" shown |
| Reconciliation | wrappers | **containers, caps, labels** (and boxes if printed): taken = used + spoiled + returned, per item |
| Typical defects | (see above) | Separation · Too thick / too thin · Wrong pH · Underfilled · Overfilled · Leaking cap · Dented or dirty container · Air bubbles in bottle · Odd smell or colour · Bad or crooked label · Wrong or missing batch code · Other |

The same six operator screens serve both products; only the step setup (routing) differs.

---

## 5. Day to day

### 5.1 Daily log ("What happened today")

Already built (ADR-074): append-only entries per order and day, corrections with reason. v2 changes:

1. **One "Today" page for the whole plant**, not only per order. It lists every order that is In
   progress or Curing with one row each: **Good pieces today**, **Rejects** (type + number, "+ add"),
   **Note**. Date = today, shift = the only shift unless more are set (A-PF2-06), person = signed in.
2. **Plant notes for the day** (one free-text box: "Power cut 10:00–11:30", "Ana absent").
3. **What the log feeds.** Good pieces and rejects written during the days are **prefilled into
   Finish**, so nothing is counted twice. Finish turns them into the official output and scrap records;
   the log itself stays as the day record.
4. A short "Downtime (minutes)" field under More details, for later analysis; not required.

### 5.2 Owner dashboard (one page)

| Tile | Shows | Source |
|---|---|---|
| **Orders board** | Columns Draft · Approved · In progress · Curing · Quality check · Done (last 7 days). Each card: product, quantity, needed-by date, red if late. Tap → order page. | §3 read model |
| **Today's output** | Good pieces today and this week per product | daily log + Finish |
| **Rejects %** | Last 7 and 30 days per product, top 3 reject types | `defectSummary` |
| **Yield vs target** | Last 10 batches: final yield % with the target range | yield records |
| **Late orders** | Needed-by date passed, or the expected done date (incl. cure and QA days) is after the customer's date | order + curing date + setting "usual QA days" |
| **Coming out of curing** | This week: product, bars, date | curing steps |
| **Waiting for me** | Approvals, quality checks, problem reports the owner can act on | `/approvals` (ADR-075) |

---

## 6. Screens

### 6.1 Operator screens (six)

| # | Screen | On the screen | Under "More details" |
|---|---|---|---|
| S1 | **Production orders** (list; board for the owner) | Order no., product, how many, needed by, status chip with subtitle, big next-action button per card | Filters (status, product, line), search, cancelled orders |
| S2 | **Order** (the hub) | Status strip; next-action button; product and quantity; batch number(s); needed by and customer; "What happened today" (add entry); rejects summary | Formula and step versions used, reservations, history (audit), batch record PDF, reopen, cancel, paper records |
| S3 | **Get materials** | One line per item grouped by section: name, quantity, lot, place, "Got it"; "Got everything" | Change lot, scan labels, move stock to production area, print pick list |
| S4 | **Weigh** | One card per ingredient: name, target and OK range, lot (preselected), Weight, Save; checker name picker on marked lines | Tare/gross, scale, split lot, void a weighing, exception request |
| S5 | **Step** (generic: Start check, Mix, Wait/Cure, Cut, Wrap, Fill) | Instruction, 0–3 readings or the checklist, the count for cut/wrap/fill steps, Done | Equipment, times, photo, notes, report a problem, checker for this step |
| S6 | **Finish** | Good pieces, rejects by type, samples kept, wrappers/containers spoiled and returned, hold area, expected vs made %, Finish | Scrap vs redo split, reason codes, location scan, checker |

### 6.2 Owner and QA views

| View | Purpose |
|---|---|
| **New order** (sheet over S1) | Product, how many, needed by; More details: batches, size, line, notes, customer order |
| **Today** | Plant daily log (§5.1) |
| **Owner dashboard** | §5.2 |
| **Check quality** | §2.1 step 10: batch summary, tests, Pass / Hold / Fail |
| **Rejects and yield report** | Existing `/production/defects` extended with yield |
| **Advanced** (hidden unless allowed) | Production plan, work orders (detailed), board (detailed), batch workspace (full), staging by scan, paper records, reopen |

### 6.3 Words to use (operator word → system term)

| Say on screen | System term (code, docs) | Do not show operators |
|---|---|---|
| Production order | work order + its batches | work order |
| Batch number | `batches.batch_number` / finished lot number | lot genealogy |
| Approve | plan + release + reserve + create batches | release, plan |
| Set aside | stock reservation | reserve, allocate |
| Get materials, pick list, Got it | staging, `materials_staged` | stage, staging |
| Start check, Before wrapping check | line clearance step | line clearance |
| Weigh, weight, OK range | dispense record, tolerance | dispense, tolerance |
| Check (by a second person), Checked by | checker co-signature | co-sign, SoD |
| Step, reading | process step record, process parameter | routing, parameter |
| Curing, Resting, ready on | step of kind `curing` / `hold`, `earliest_completion_at` | hold step |
| Good pieces / good bars | batch output, actual units | output, yield record |
| Rejects (type) | scrap record + defect type | scrap, nonconformance |
| Redo | rework (`rework_approved`) | rework |
| Taken / used / spoiled / returned | packaging issue and reconciliation | reconciliation |
| Samples kept | retained samples | retention |
| Hold area | quarantine location (section `qa_hold`) | quarantine |
| Quality check; Pass / Hold / Fail | inspection + disposition release / hold / reject | disposition, awaiting QC |
| Ready to sell | lot status `released` | released |
| Report a problem | deviation | deviation, CAPA |
| Ask for approval | controlled exception (CX-TOL etc.) | exception |
| Expected, made, % | theoretical yield, actual yield, yield % | variance |
| Done | batch closed / work order closed | close |

---

## 7. Gap list and build plan

### 7.1 Keep, change, hide, delete

| Area (code) | Decision | Detail |
|---|---|---|
| Batch and work order state machines (`state.ts`, `work-orders-state.ts`) | **Keep** | No new machine. |
| Approve (`production-orders.ts`) | **Keep** | Add customer-order link and needed-by date. |
| Status read model (`production-order-status.ts`) | **Change** | Add Curing and Quality check; Done = QA decided (§3.2). Needs batch and step facts, not only work-order status. |
| `nextProductionAction` | **Change** | One action per step of §2 (Get materials, Start, Weigh, Next step, Curing finished, Finish, Check quality). |
| Staging (`staging.ts`, `/production/staging/*`) | **Change + hide** | New pick-list mode: ticks reach `materials_staged` without a stock move when `production.prepare.move_stock` is off. Scan flow under More details. |
| Line clearance (`line-clearance.ts`) | **Keep service, change setup** | Example routing uses one Start check and one Before wrapping check; checker off by default. "All OK" button. |
| Dispensing (`dispensing.ts`) | **Keep rules, change screen** | Weigh card UI; second-person check mode `all / marked / none` using `bom_lines.requires_checker` (column exists). |
| Steps / process (`steps.ts`, `process.ts`, `execution.ts`) | **Keep, change screen** | Generic step card; curing card with ready date and reminder. |
| Output, yield, packaging, scrap (`output.ts`, `yield.ts`, `packaging.ts`) | **Keep services, add one command** | `finishBatch` calls them in one transaction (Appendix A). Default hold area setting replaces the mandatory scan. |
| QA disposition (`quality/dispositions.ts`) | **Keep, new screen** | "Check quality" page; Pass triggers auto-close. |
| Closure (`closure.ts`) | **Keep checks, remove the manual tap** | Auto-close on Pass when `closureChecks` are all green; else listed on the order. Reopen stays (advanced). |
| BMR (`bmr*.ts`) | **Keep** | Generated at Pass; layout follows the paper BMR (docs/reports-and-templates.md). |
| Daily log (`daily-log.ts`) | **Keep, extend** | Plant "Today" page; prefill Finish; downtime minutes. |
| Board (`board.ts`, `/production/board`) | **Change** | Columns = v2 statuses; old configurable board → advanced. |
| Production plan (`planning.ts`, `/production/plan`) | **Hide** (advanced) | Keep for demand overview; "Make for this order" on sales order replaces it for daily use. |
| Work orders pages (`/production/work-orders/*`) | **Hide**, `/new` **redirects** to `/production/orders/new` | Duplicates. |
| Direct batch creation (`/production/new`) | **Hide** (already behind `production.batch.allow_without_work_order`) | Delete the menu entry. |
| Batch workspace (`/production/[batchId]`, 683 lines) | **Hide** behind "More details → Full batch record" | Operators use S3–S6. |
| Closure page (`/production/[batchId]/closure`) | **Hide** (advanced: reopen, amendments) | |
| Paper records | **Hide** unless setting on | |

### 7.2 Build plan in vertical slices

Each slice: failing test first; data model, permissions, validation, loading/empty/error states, audit,
tests, docs. Negative tests for cross-site access and role escalation in every slice.

| Slice | Delivers | Acceptance criteria | Risks |
|---|---|---|---|
| **V2-1 Status v2** | New read model (§3.2) on list, order page, board columns | Each row of §3.2 has a unit test; an order with batch in `awaiting_qc` shows Quality check, not Done; curing shows the date; multi-batch shows least advanced + "1 of 2 done" | Changes ADR-074 meaning of Done → ADR-080 first; dashboard KPIs that count "done" orders must be re-checked. |
| **V2-2 Order hub + demand link** | Needed-by date, "Make for this order" from a sales order line (uses `work_orders.sales_order_id`), late flag, one next action for every step | From a short sales order line the order is prefilled and linked; late when needed-by < today and not Done; next action matches §2 for every state (table test) | Need-by column needs a migration; sales permissions on the link (view only). |
| **V2-3 Get materials pick list** | Ticks, "Got everything", setting `production.prepare.move_stock` (default off) | With setting off, all ticks → `materials_staged`, no stock movement, audit per tick; with setting on, behaviour as today; a lot on hold is refused | Today `startBatch` refuses work-order batches unless staged by scan; must allow the tick path. Reservation expiry (`reservation_ttl_hours`) still applies. |
| **V2-4 Start check + Weigh cards** | Start check with "All OK"; weigh card; checker mode all/marked/none; consumption at weighing recommended on | Marked line without checker cannot be saved when mode = marked; unmarked line can; wrong lot and out-of-tolerance still blocked (existing tests stay green); owner override path audited | Changing the boolean setting to an enum needs a settings migration and a default for existing organizations (keep "all" for orgs that had true). Posting at weighing changes when stock drops: reconcile with existing postings tests. |
| **V2-5 Step card + Curing** | Generic step screen; curing card with ready date; reminder notification on the ready date; Curing status | Curing finished before the date requires approval with reason; reminder sent once; board shows Curing column | Scheduler job for the reminder (worker) must be idempotent. |
| **V2-6 Finish** | `finishBatch` command: output, scrap per defect type, samples, packaging reconciliation, consumption, finished lot into default hold area, inspection task — one transaction, idempotent; prefill from daily log | Retrying with the same key creates nothing twice; wrapper imbalance blocks; yield out of range requires reason + opens problem report; result equals the five old commands run separately (comparison test) | Largest slice: many services in one transaction; lock order (batch → lots → locations) must match `postMovement`. New settings `production.output.default_hold_location`, `production.output.retained_samples`. |
| **V2-7 Check quality + auto-close** | One QA page; Pass/Hold/Fail; Pass releases lot, generates BMR, closes batch when checks pass, sets order Done, notifies the linked sales order | Pass with an open problem report is refused; non-QA user refused (negative test); owner pass audited as override; failed batch → Done with "Failed" tag | Auto-close inside the disposition transaction couples quality and production modules: use the existing hook pattern (`execution-hooks.ts`), not a direct import. |
| **V2-8 Today page + owner dashboard** | Plant daily log page; dashboard tiles §5.2 | Totals reconcile with daily log entries (corrections counted once); late-order rule tested; empty states when nothing is in progress | Defect rate into the KPI catalogue needs a KPI definition (ADR-074 consequence). |
| **V2-9 Example setups** | Soap example v2 (8 steps, §4.1) and a lotion example; lye solution product | "Use the example" stays idempotent; nothing approved automatically | Example values could be mistaken for a real recipe: notes on every example say "fictional, verify". |
| **V2-10 Hide and redirect** | Navigation: Orders, Today, Rejects; Advanced menu; redirects | Every old URL still works or redirects; e2e on iPad viewport (768–1180 px) walks one soap order from Draft to Done in ≤ 25 taps excluding typing of counts | Bookmarked old pages; training material (`docs/training-plan.md`, `docs/help`) must be updated in the same slice. |

Suggested order: V2-1, V2-2, V2-3, V2-4, V2-6, V2-7, V2-5, V2-8, V2-9, V2-10 (V2-5 can run in parallel
with V2-6 once V2-4 is in).

---

## 8. Open questions for the owner

| # | Question | Recommended default |
|---|---|---|
| 1 | Who passes finished batches (quality check) today? | The owner, using the audited owner override, until a QA person is named; ask the GMP consultant whether that is acceptable for Bryel's licence. |
| 2 | Second-person weighing check: all ingredients, only marked ones, or none? | Only marked ones: lye solution, colour, extract, fragrance, preservative. |
| 3 | Lye solution: made ahead as its own lot (as on the paper BMR) or inside each soap order? | Made ahead as a short order of its own; usable after the maker's check, no QA pass. |
| 4 | Soap times: how long in the mould, how long curing, and what cut weight gives a 135 g bar after curing? | No number is assumed for the cut weight (owner must enter it). Placeholders: 1 day in mould, 28 days curing. |
| 5 | Do you move materials to the production room in the system, or just bring them? | Just bring them (pick list ticks, no stock move). |
| 6 | One daily log per day, or per shift? | One per day. |
| 7 | How many finished units do you keep as samples per batch, and for how long? | 2 units, kept until expiry + 1 year (to confirm with the GMP consultant). |
| 8 | Should "Curing" and "Quality check" appear as their own statuses (this design) or only as subtitles of "In progress"? | Own statuses on the board, subtitles on the progress strip (as designed). |

---

## Appendix A. Builder notes per step (service mapping)

| Step | Existing service(s) | New / changed | Permission | Audit |
|---|---|---|---|---|
| 1 New order | `createProductionOrder` | `neededBy`, `salesOrderLineId` input | `production.work_order.create` | `production.work_order.created` |
| 2 Approve | `approveProductionOrder` | none | `production.work_order.approve` | as today |
| 3 Get materials | `stageMaterial`, `getStagingView` | `confirmPicked(batchId, lines[], idempotencyKey)`: records ticks; when complete, `transitionBatch(planned → materials_staged)`; posts moves only if `production.prepare.move_stock` | `production.batch.edit` (tick); `inventory.movement.post` (when moving) | `production.pick_line.confirmed`, `production.batch.state_changed` |
| 4 Start | `submitChecklist` | "All OK" fills every item `yes` client-side, still one answer row per item | `production.line_clearance.create` (as today) | as today |
| 5 Weigh | `recordDispense`, `checkDispense` | checker requirement = setting mode × `bom_lines.requires_checker` at batch creation (snapshot) | `production.dispense_record.create` / `.approve` | as today |
| 6–8 Steps | `startStep`, `recordReading`, `completeStep`, `issuePackaging`, `countPackaging` | curing reminder job; count fields stored as step readings with codes `units_cut`, `units_wrapped`, `units_filled` | as today | as today |
| 9 Finish | `recordYield`, `recordScrapRework`, `countPackaging`, `postBatchToQuarantine` | `finishBatch(ctx, {batchId, goodUnits, rejects[{type, qty}], samplesKept, packaging[{materialId, spoiled, returned}], locationRef?, idempotencyKey})`, one transaction, calls the bodies of the above (extract `…Locked` variants as done for ADR-074) | `production.batch.post` + the yield/scrap create permissions | existing events + `production.batch.finished` |
| 10 Check quality | inspection + `quality/dispositions.ts` | hook `onBatchReleased` → `closeBatch` when `closureChecks` pass | `quality.disposition.approve`; closure runs as system action inside the same transaction, audited with the QA actor | `quality.disposition.approved`, `production.batch.closed` |
| 11 Ready to sell | sales allocation | notify the linked sales order owner; no automatic allocation unless the sales module's rule says so | — | `sales.order.stock_available` (notification) |

## Appendix B. Settings (new or changed)

| Key | Scope | Default | Restricted / approval |
|---|---|---|---|
| `production.prepare.move_stock` | org, site | false | requires approval |
| `production.prepare.scan_lots` | org, site | false | — |
| `production.weighing.second_person_check` | org, site | **changed to enum** `all | marked | none`; existing `true` → `all`, `false` → `none`; new organizations `marked` | requires approval |
| `production.line_clearance.checker` | org, site | false | requires approval |
| `production.post_consumption_at_dispense` | org, site | recommend true for new organizations (existing ones unchanged) | requires approval (as today) |
| `production.output.default_hold_location` | site | first location of section `qa_hold` | — |
| `production.output.retained_samples` | org, site | `{ enabled: true, units: 2 }` | requires approval |
| `quality.release.tester_may_release` | org, site | true (ADR-080 §8, built in G3) | restricted, requires approval |
| `production.quality.usual_days` | org, site | 2 (for the late-order forecast only) | — |
| `production.daily_log.shifts` | org, site | `["Day"]` | — |
| `production.paper_records.enabled` | org | false | — |

## Appendix C. Acceptance walk-through (fictional data)

1. Customer order SO-0103 asks for 200 Acapulco Soap; stock 80. "Make for this order" → order PO-0042,
   2 batches, needed by 15 Dec. Status Draft.
2. Owner taps Approve. Lots set aside; batches AS-2611-01/02 created. Status Approved.
3. Storekeeper ticks 5 lines + wrappers. Status Approved "Materials ready".
4. Operator: Start check All OK → Weigh 5 cards (lye solution and colour checked by Ben, who picks his
   name) → Mix and pour (two readings) → Set in mould: Curing "until 31 Oct".
5. 31 Oct: Cut, 121 bars → Cure: Curing "until 28 Nov". Dashboard: "Curing: 121 bars, ready 28 Nov".
6. 28 Nov: Wrap: Before wrapping check, 118 good, 3 rejects in the daily log (Soda ash 2, Cracked 1).
7. Finish (prefilled): 118 good, 3 rejects, 2 samples, wrappers taken 125 / used 120 / spoiled 2 /
   returned 3 → balance 0. Status Quality check.
8. QA (owner, override audited) checks appearance and weight of 10 bars → Pass. Batch record PDF made,
   batch closed, 116 bars ready to sell. When batch 2 passes, PO-0042 is Done; SO-0103 is notified.

## Appendix D. New assumptions (to add to docs/PRD.md when accepted)

| ID | Assumption | Configurable | Owner approval |
|---|---|---|---|
| A-PF2-01 | Order status = least advanced live batch; Curing and Quality check added; Done = all batches decided by QA | read model | Owner |
| A-PF2-02 | Pick list ticks replace staging transfer by default | `production.prepare.move_stock` | Owner, GMP consultant |
| A-PF2-03 | Two short checklists (Start, Before wrapping) replace three clearances in the example routing | routing setup | QA, GMP consultant |
| A-PF2-04 | Cut weight target is entered by the owner; the system never derives it | product/routing field | Owner |
| A-PF2-05 | Curing bars are not stock; shown from the cut count only | — | Owner |
| A-PF2-06 | One daily log per day unless shifts are configured | `production.daily_log.shifts` | Owner |
| A-PF2-07 | Pass by QA closes the batch automatically when all closure checks pass | — | QA |
| A-PF2-08 | Second-person check defaults to lines marked in the formula | `production.weighing.second_person_check` | QA, GMP consultant |
| A-PF2-09 | 2 retained samples per batch by default | `production.output.retained_samples` | QA, GMP consultant |
| A-PF2-10 | All soap/lotion times, temperatures, limits and defect lists in this document are fictional examples | routing, settings | Process owner, QA |
