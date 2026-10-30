# UX review: Production flow v2 (`docs/production-flow-v2.md`)

Reviewer: UX/UI designer persona (ADR-007 owner of `docs/ux-system.md`). Date 2026-10-30.
Scope: the proposed flow, checked against `docs/ux-system.md` (§3 navigation, §6 states, §7 operator
mode), the current screens under `src/app/(app)/production/**`, `src/app/(app)/nav.ts`,
`src/app/(app)/shell.tsx` and `src/ui/**`. No file in the repo was edited.

Device targets used throughout: iPad 10th gen / Air in **portrait** (768–834 × 1024–1194 CSS px; below
the `lg` 1024 px breakpoint, so today it gets the drawer and bottom tab bar) and **landscape**
(1024–1194 × 768–834; gets the desktop top bar and rail). iPad mini portrait (744 px) must also work.
Users: Filipino operators, simple English, little ERP experience, often gloved (lye) or wet hands,
bright room, shared tablet on a bench or stand.

---

## 1. Verdict

**Approve with changes.** The direction is right and much better than what is built: one thing to
follow (the order), one big button, defaults everywhere, exceptions only when needed, and a real
operator glossary. The engine stays, which is correct.

It is **not ready to build as written**. Seven blockers would bring back exactly what the owner
complained about on the iPad:

- there are still two status vocabularies on one screen;
- the same count is typed in up to three places;
- Finish and Wrap break the doc's own "at most three fields" rule;
- the preselected lot means nobody actually checks which container is used;
- the iPad tab bar sends people to the old screens;
- quantities are shown in grams, not pieces;
- the iPad keyboard hides the button.

All seven can be fixed on paper before slice V2-1 starts. My decisions are below. The owner delegated
these decisions, but the GMP-flagged items still need the GMP consultant.

---

## 2. Findings

Tap counts below exclude typing digits. "Tap" = one deliberate touch on a ≥ 52 px target.

### 2.1 Blockers (fix in the design doc before V2-1)

| # | Finding | Where | Concrete fix (decided) |
|---|---|---|---|
| B1 | **Two status vocabularies at once.** §3.1 has 7 statuses (Draft, Approved, In progress, Curing, Quality check, Done, Cancelled) plus subtitles ("Getting materials", "Materials ready", "Starting", "Weighing"…). The progress strip still has ADR-074's 4 steps, and §3.1 puts Curing / Quality check "in the same chip position" as In progress. So the owner reads **Curing** on the chip and **In progress** on the strip, on the same screen. That is the "too many statuses" complaint again. | §3.1, §3.2, `parts.tsx` `ProgressStrip` (grid-cols-4) | **One list of 5 statuses, the same on chip, strip, list filter and board columns:** **Draft → Approved → In progress → Quality check → Done**, plus 2 end states off the strip: **Failed** (red, `octagon-alert`, 2 px border) and **Cancelled** (neutral). **Curing is not a status.** It is how In progress shows while waiting: hourglass icon plus the step's own word and date ("Curing until Fri 28 Nov", "In the mould until Fri 31 Oct", "Resting until 14:00"). The strip becomes 5 segments; under the In progress segment it shows "Step 6 of 8 · Curing until Fri 28 Nov". Quality check gets its own position because Done now means QA decided (keep §3.1 (b)). This amends ADR-074 (4 → 5 steps); record it in ADR-080. |
| B2 | **"Done · Failed" is a contradiction.** §3.1 shows a failed order as Done with a red tag. Operators read "Done" as good. Risk states must never rely on colour (ADR-007). | §3.1 Done row, §3.2 last rows | A failed order shows the **Failed** chip (icon + label + red + border), not Done. Part-failed shows **Done** plus a warning chip "1 of 2 batches failed". |
| B3 | **The same count is typed up to three times.** Good bars are typed in the daily log (§5.1), again at Wrap ("Good bars wrapped"), and again at Finish ("Good pieces"). Wrappers are typed at Wrap ("Wrappers taken") and again at Finish. Operators will get different numbers and won't know which one counts. That is the "can't follow" complaint. | §2.1 rows 8–9, §5.1 item 3, §6.1 S5/S6 | **Each number is typed once:** (1) **Bars cut**: Cut step only. (2) **Good pieces and rejects**: the daily log ("Today"), one row per day of wrapping or filling. (3) **Damaged wrappers** and **Wrappers left over**: Finish only. (4) **Wrappers taken** is never typed; it comes from the materials list. The Wrap step has **no count fields**: Before wrapping check, the "weight of 10 bars" reading, then **Step done**. Finish shows the daily-log totals as read-back with a **Change** link. If nothing was logged, Finish asks for good pieces and rejects. |
| B4 | **Finish has 6 to 9 inputs on one screen** (good pieces, rejects by type, samples, wrappers taken / used / spoiled / returned, hold area, plus yield). That breaks principle 3 ("at most three fields"). | §2.1 row 9, §6.1 S6 | **Finish = read-back first, then at most 2 typed fields.** Layout: (a) a summary card ("118 good · 3 rejects · 2 samples kept · Expected 123, made 118 (96 %)"), each line with **Change**; (b) the only typed fields, **Damaged wrappers** and **Wrappers left over**, on the in-app keypad; (c) a live balance line, "125 taken = 120 used + 2 damaged + 3 left over ✓" (or "5 missing, count again" with a warning icon); (d) "Goes to: Hold area A" as text, with Change under More details; (e) **Finish batch**. With an empty log it becomes 3 short screens: Good pieces → Rejects → Wrappers. |
| B5 | **A preselected lot means nobody checks the physical lot.** With scanning off (O1, default) and the lot preselected (S4), the system cannot "check right material and lot" (row 5). It only records the lot it chose. "Wrong lot: blocked, shows the expected lot" can never happen. G2/G3 traceability then depends on an operator taking the right drum without being asked. | §2.1 row 5, §6.1 S4, O1 | Add **one confirm action per ingredient**, the only extra input on the happy path. The card shows the lot in large type ("Lot **PO-0412**, use first, expires 3 Mar 2027") and asks "**Type the last 4 of the lot on the label**" on the keypad. A scan also fills it when a scanner is paired. The tap count stays: the 4 digits are typing, and Save checks both fields. New setting `production.weighing.lot_confirm` = `last4` (default) / `scan` / `none` (restricted; `none` needs approval and is flagged **[GMP: confirm]**). A mismatch gives the doc's own message: "This label says PO-0398. Use lot PO-0412, or tap Use this lot instead". The second option runs the FEFO/substitution rules. |
| B6 | **iPad portrait sends people to the old screens.** Below 1024 px the bottom tab bar (`shell.tsx`) shows **Batches → `/production`** (old batch list) and **Orders → `/sales`** (sales orders). On an iPad in portrait, "Orders" opens sales, not production orders, and "Batches" opens the screen v2 hides. | `shell.tsx` tab bar, §7.2 V2-10 | Move this into **V2-1, not V2-10**, because it costs nothing and fixes the first thing the owner touches. The tabs are set per role (see §5 of this review). The word "Batches" is never a tab. "Orders" is never ambiguous: use **Production** and **Sales**. |
| B7 | **Quantities are in grams.** The list and the order page show `fmtMass(quantityG)`, e.g. "35.2 kg in 2 batches". The owner and operators think in bars and bottles. §2.1 row 1 fixes the input but not the display. | `orders/page.tsx`, `orders/[workOrderId]/page.tsx`, §6.1 S1/S2 | Show **pieces first** everywhere outside More details: "**247 bars** · 2 batches", and on the hub "247 bars expected (2 × 17.6 kg)". Before Finish it says "expected", after Finish "made". Mass appears only under More details and on Weigh. |
| B8 | **The iPad keyboard hides the primary button and half the screen.** On iPad, `inputmode="decimal"` opens the full keyboard with a number row, not a small keypad. In landscape it covers about 50 % of the height, so a sticky bottom Save is covered or jumps. Gloved hands make it worse. | S4 Weigh, S5 readings and counts, S6 | On S4–S6 in operator mode, use the **in-app numeric keypad (ux-system §5.25, 56 px keys)** with the native keyboard suppressed. Portrait: keypad docked under the active card. Landscape: keypad in the right pane. The primary button sits **next to the field and on the keypad (the large ✓ key)**, never only at the bottom edge. The keypad has a decimal key only for decimal fields; count fields get whole numbers only. |

### 2.2 Should fix (before or in the slice that builds the screen)

| # | Finding | Fix (decided) |
|---|---|---|
| S1 | **Two buttons at Approved** ("Get materials / Start") break "one big button". | While any materials line is unticked the button is **Get materials**; after "All taken" it is **Start**. Never two primary buttons. |
| S2 | **The "least advanced batch" rule hides work on multi-batch orders.** While batch 1 cures, batch 2 needs weighing, but the order chip says "Curing". | The order chip follows the doc's rule (owner view). The order page shows **one row per batch, each with its own next button**, when there is more than one batch. The top primary button is the most urgent batch the user can act on now. Operator Home lists **batches**, not orders (see §5). |
| S3 | **"Hold" means two things.** It is both a QA decision ("Pass / Hold / Fail") and a place ("Hold area", where every finished batch already sits before Pass). "Hold" as a decision reads as "nothing changes". | QA buttons: **Pass** · **Not yet** (asks reason + "check again on" date) · **Fail**. "Hold area" stays as the place word. The board card for Not yet shows "Quality check · not yet, check again 3 Dec". |
| S4 | **"Got it" is ambiguous in Filipino English**: it usually means "I understand". "Pick list" is warehouse jargon. | Screen title **Materials list**. Per-line button **Taken**; bulk button **All taken**. An untick is possible until Start. |
| S5 | **Step button "Done" clashes with the order status "Done".** An operator taps "Done" on Mix and asks why the order isn't done. | Step screens use **Step done**. The last making step uses **Go to Finish**. The Finish screen uses **Finish batch**. "Done" is only an order status. |
| S6 | **The word "reading" will show up on screen** ("0 to 3 readings"). | Each field uses its own name and unit ("Oil temperature, °C"). "Reading" is never a label. Yes/no checks such as "Trace reached?" are two large buttons (**Yes** / **No**), not checkboxes. |
| S7 | **Start check: "each prefilled blank" plus "All OK"** invites tapping All OK without looking. It also clashes with the rule that each item is answered. | Show up to 6 items as Yes / No rows plus **All OK**, which is enabled only after the operator scrolls the list into view (all items visible, which they are on iPad with ≤ 6). After All OK, a read-back toast "6 checks recorded as OK". Any **No** turns that row red and changes the primary button to **Report a problem**. Max 6 items is a hard limit in step setup; more raises a setup warning. |
| S8 | **Nothing brings the operator back after 28 days of curing.** A reminder exists (row 7), but where does it land on a shared tablet? | Operator Home has a section **"Ready today"** (curing ends today or earlier), above "In progress". The reminder goes to the action centre for users with `production.batch.edit` at the site, not to one person. `Curing finished` before the date is disabled with the text "Ready on Fri 28 Nov. Ending early needs approval." plus a secondary link **Ask to end early**. |
| S9 | **Checker on a shared iPad.** "The checker taps their name" (ADR-078) needs a clear moment, or the operator will tap a colleague's name. | After Save on a marked line, a full-card prompt: "**Second check needed.** Ask someone to watch you weigh. [Pick their name]". The name list excludes the signed-in person. Then a confirm screen addressed to the checker: "**Ben, you watched 3,720 g of Lye solution, lot LS-0031?** [Yes, I checked] [No]". That makes 2 taps. If the owner is alone, they get **No one else here? Ask for approval** (ADR-073 override, reason required). Note: checker signatures are not captured offline (`docs/offline-sync.md` §11 item 7). The screen says so: "Second check needs a connection. Weigh now, the check is done when online." |
| S10 | **Tab rows on the order page** (Today / Daily log / Materials / Output) hide the next action on 3 of 4 tabs in portrait (`NextActionCard` sits inside the Today tab below `lg`). | No tabs for operators: one scrolling page in fixed order (see §3 S2). The primary button is **sticky at the bottom in portrait** and **sticky top-right in landscape**, on every scroll position. |
| S11 | **"Defects" in code vs "Rejects" in the doc.** Nav, `DefectTables` and `/production/defects` say Defects, Defect rate. | One word: **Rejects** (count) and **Reject type** (category). Rename nav item, page title, table headers and the dashboard tile in V2-8. "Reject rate" for the owner, "Rejects" for operators. |
| S12 | **The 25-tap acceptance target is undefined** (whole order? one batch? includes QA?). My count of the happy path for one soap batch is in §2.4. | Change V2-10 acceptance to **≤ 30 taps for one soap batch from opening the order to Finish batch, excluding digits, plus ≤ 4 taps per extra day of daily log, and ≤ 4 taps for Check quality excluding test values.** Measure it in the iPad e2e at both 820 × 1180 and 1180 × 820. |
| S13 | **Cut weight missing is found on cut day** (Q4, A-PF2-04). | Approve is blocked with "Cut weight for Acapulco Soap 135 g is not set. Ask the owner to set it in the product." plus a link for users who can edit the product. Better to fail on day 0 than on day 2 with soap in the mould. |
| S14 | **Each new order needs Approve** even when the owner made it themselves and is alone. | When the creator may approve and SoD is off, **New order** has a secondary **Save and approve** (the button on the sheet is labelled "Create and approve"). Approve still runs as a separate audited command. Saves 2 taps and a page load. |
| S15 | **State patterns are not specified per screen** (ux-system §6 requires them). | See §3: every screen lists loading, empty, error, permission denied, offline and blocked. Add this to the doc's §6.1. |
| S16 | **"Ask for approval" on Weigh has no "what happens now".** The operator does not know whether to wait, throw the weighing away, or carry on. | After the request: a card "**Waiting for approval** from Maria (owner). You can weigh the next ingredient." The out-of-tolerance line shows a warning chip with icon "Approval required". Start of the next *step* is blocked until it is decided. |

### 2.3 Nice to have

| # | Idea |
|---|---|
| N1 | A large **"?" help** per step that shows the work-instruction snapshot with photos of the correct result (trace, cut bar, wrapped bar). The text is shorter than any manual. |
| N2 | **Read-back voice**: none. Do not add sound. The floor is noisy, and haptics are not available on iPad Safari. Use a big green tick with "Saved" text for 1.5 s. |
| N3 | **Taglish microcopy** as a later localisation pack (ux-system §11 open question). Keep English as the source and allow `help_guides` in Filipino first. |
| N4 | **Big-number mode on Weigh**: the target in 44 px hero type, the OK range under it, the typed value in the same size next to it, so the comparison is visual at arm's length. |
| N5 | **Status chip colours**: Draft neutral, Approved info, In progress brand green, Quality check warning (hourglass + "waiting for QA" text), Done success, Failed danger, Cancelled neutral, struck through. One chip per card, never two. |
| N6 | The **progress strip on the board card** as a 5-dot mini strip, so the owner sees position without reading. |
| N7 | **"Continue where you left off"** on Home, opening the exact step screen last used on this tablet. |

### 2.4 Tap count (happy path, one soap batch, owner also operator)

| Moment | Taps | Notes |
|---|---|---|
| Home → order | 1 | Card on Home |
| Approve (+ confirm sheet) | 2 | Or 0 extra with "Create and approve" (S14) |
| Get materials → All taken → confirm | 3 | |
| Start → All OK → Step done | 3 | |
| Weigh 5 ingredients: Save each (lot digits and weight are typing) | 5 | |
| Checker on 2 marked lines: pick name + "Yes, I checked" | 4 | |
| Mix and pour: Trace Yes + Step done (temperatures typed) | 2 | Then In the mould starts by itself |
| Day 2: Home → batch → **Mould time finished** | 2 | |
| Cut: Step done (bars typed) | 1 | Cure starts by itself |
| Day 30: Home → batch → **Curing finished** | 2 | |
| Before wrapping check: All OK + Step done (weight of 10 typed) | 2 | |
| Daily log, 1 day of wrapping: Today → row → reject type + Save | 3 | |
| Finish: Finish batch + confirm | 2 | |
| **Total to Quality check** | **32** with confirm sheets, **30** with S14 | Target ≤ 30 (S12) |
| Check quality: 3 test results (typed/Yes) + Pass + confirm | 4 | Online only |

---

## 3. Wireframes (operator screens S1–S6 and owner dashboard)

Common rules for every screen below:
- **Operator density on** (`data-density="operator"`): 16 px body text, 18 px buttons, 52–56 px buttons, 56 px rows.
- **One primary button** (`--cta`, black). It is sticky at the bottom in portrait (above the tab bar and safe area) and sticky top-right in landscape.
- **Header line:** back arrow · title · batch number chip · sync chip. The site chip appears only if the user has more than one site.
- **Loading:** top progress bar and the previous screen at 60 % (ADR-043). No skeleton routes. Buttons show a spinner, are disabled while posting, and carry the idempotency key so a double tap is safe.
- **Action error:** a persistent toast "Couldn't save the weight for Coconut Oil. No connection to the server. Try again." The form keeps its values.
- **Permission denied:** a lock state, "You can't do this step at Site A. Ask Maria (owner)." `WhoCanHelp` names a real person.
- **Offline:** a banner "You're offline. Weighings and steps are saved on this tablet." On a non-registered device or for online-only actions, the disabled button carries the reason.
- **Blocked** (state machine refuses): a warning banner with an icon, the reason in one sentence, and who can unblock. Never a silent grey button.

### S1. Production orders (operator: "My work"; owner: list or board)

| | Portrait (768–834) | Landscape (1024–1194) |
|---|---|---|
| Layout order | 1. Title "Production" + **New order** (owner/planner only). 2. Status filter as 5 large segmented pills (Open = default, Draft, Approved, In progress, Quality check, Done) wrapping to 2 rows, never horizontal scroll. 3. Search field (order no. or product). 4. Cards, 2 columns. | Same header; filters on one row; 3-column cards. The owner gets a **List / Board** toggle; the board has 5 columns = 5 statuses, In progress grouped as "Being made" then "Curing / resting" sub-headers with ready dates. |
| Card | Product (18 px, bold) · "**120 bars** · 1 batch" · "Needed by Fri 15 Dec" (red + clock icon + "Late" if late) · status chip with subtitle ("In progress · Curing until 28 Nov") · full-width **next-action button** with the verb ("Weigh", "Curing finished · 28 Nov" disabled, "Check quality"). | Same card; button at the bottom of the card. |
| Primary | Per card: the next action. Page: **New order** only for creators (secondary for operators: hidden). | Same |
| More details | Filters by product and line, cancelled orders, "Show detailed screens" (advanced, permission-gated). | Same |
| Empty | Operator: "Nothing to make right now. New orders appear here when the owner approves them." Owner: "No production orders yet. [New order]". Filtered: "No orders are In progress. [Show all open]". | Same |
| Error | Inline card "Couldn't load production orders. Try again. Reference E-…". Header stays usable. | Same |

### S2. Order (the hub)

| | Portrait | Landscape |
|---|---|---|
| Layout order | 1. Header: product name, order no., status chip. 2. **5-step strip** with "Step 6 of 8 · Curing until Fri 28 Nov" under the current segment. 3. **Next-action card**: one sentence ("Weigh the 5 ingredients for batch AS-2611-01") + big button. 4. Key facts (2 × 2): How many (pieces expected/made), Needed by (+ customer name if linked), Batch number(s), Expiry (after Finish). 5. Batches (only if > 1): one row each with chip and own button. 6. **Today**: "What happened today?", the rows logged today, **+ Add today's count**. 7. Rejects so far (3 numbers: good, rejects, reject %). 8. **More details** (collapsed). | Two columns. Left (≈ 60 %): strip, facts, batches, Today, rejects. Right (≈ 40 %, sticky): next-action card with button, "Waiting for" info (who can help), Cancel (owner, under More). |
| Primary | The next action (one): Approve / Get materials / Start / Weigh / Next step name / Curing finished / Go to Finish / Check quality. Done or Failed shows no button, just "118 bars ready to sell · lot AS-2611-01 · expires 4 Dec 2028". | Same |
| More details | Materials (needed / set aside / used, lots), formula and step versions used, history (audit), batch record PDF, full batch record (old workspace), reopen, cancel, paper records (if on). | Same |
| Empty / special | Draft: "Not approved yet. Approving sets the materials aside." Shortage: warning banner with lines "Coconut oil: need 7.4 kg, have 4 kg" and **Buy** (secondary). Cancelled: neutral banner with reason, no button. | Same |
| Error | Not found / other site: "This order isn't available at your sites." Load error inline with retry. | Same |

### S3. Materials list (was "Get materials" / staging)

| | Portrait | Landscape |
|---|---|---|
| Layout order | 1. Title "Materials list · AS-2611-01". 2. Progress "3 of 6 taken". 3. Groups by warehouse section (ADR-077): section heading ("Raw materials shelf B"), then 56 px rows: material name (bold), **how much** with unit, lot ("PO-0412, use first"), **Taken** toggle button (right). 4. Packaging group (wrappers, labels) last. | Same list in 2 columns of sections when there are ≥ 3 sections; otherwise one wide list with the place column aligned. |
| Primary | **All taken** (when no line is ticked yet) → becomes **Done: materials ready** when every line is ticked. One tap per line is also possible. | Same |
| More details (per line) | Use another lot (next usable FEFO lot with reason), Not needed (reason), Scan label. Page level: Print list, Move stock to production (only when the setting is on). | Same |
| Empty | "Nothing to take. This order has no materials set aside. Ask Maria (owner)." (This means approval failed or was reversed.) | Same |
| Error / blocked | Lot now on QA hold or expired: the row turns into a risk row (icon + "QA Hold" label + border) with **Use another lot**. | Same |
| Offline | Ticks are queued only if the device is registered; otherwise "Needs a connection". | Same |

### S4. Weigh

| | Portrait | Landscape |
|---|---|---|
| Layout order | 1. Header "Weigh · AS-2611-01" + "2 of 5 weighed". 2. Ingredient strip: 5 chips (✓ done / current / waiting), tap to jump. 3. **Current ingredient card**: name (24 px), target in hero type "**3,723 g**", "OK from 3,686 to 3,760 g", lot block "Lot **PO-0412** · Raw shelf B · use first", field **Last 4 of the lot** [____], field **Weight (g)** [______] with a live tick or "too much by 12 g" (icon + text + colour). 4. In-app keypad docked below the card. 5. **Save** on the keypad ✓ key and beside the field. 6. On a marked line: the "Second check needed" step (S9). | Left pane (≈ 320 px): the 5 ingredients as a vertical list with ticks and actual weights. Right pane: current card on top, keypad below. Save on the keypad. No scrolling needed at 1180 × 820. |
| Primary | **Save** (then auto-advance to the next ingredient after 1.5 s "Saved" tick). Out of tolerance: Save becomes **Weigh again** (primary) with secondary **Ask for approval**. After the last ingredient: summary "5 of 5 weighed · total 17,598 g of 17,600 g" + **Step done**. | Same |
| More details (per card) | Container weight (tare/gross), another scale (calibration due date shown), split over two lots, INCI and material code, undo a weighing (supervisor, reason). | Same |
| Empty | Never empty in the flow. If reached by a deep link before Start: blocked "Start the batch first. [Go to Start]". | Same |
| Error / blocked | Wrong lot digits: "This label says PO-0398. Use lot PO-0412." Lot expired/on hold: risk banner, Save disabled, **Use another lot**. Scale overdue: "Scale S-02 check is overdue. Choose another scale." | Same |
| Offline | Allowed on a registered device (offline-sync §3). Pending weighings carry the Sync Pending chip. A second check must wait for a connection (S9). | Same |

### S5. Step (generic: Start check, Mix and pour, In the mould / Cure / Rest, Cut, Before wrapping check + Wrap, Fill)

| | Portrait | Landscape |
|---|---|---|
| Layout order | 1. Header "Mix and pour · AS-2611-01" + "Step 3 of 8". 2. **Instruction** (max 3 short lines, 18 px; "See how" link to photos). 3. **Up to 3 fields**, each with its own name and unit, the OK range under it, and a live tick/warning. Yes/No as two 56 px buttons. Checklists: up to 6 Yes/No rows + All OK. Counts (Cut only): **Bars cut**. 4. Keypad docked when a number field is focused. 5. Primary. | Left: instruction + photo (if any). Right: fields + keypad + primary. |
| Wait variant | Big hourglass, "**Curing until Fri 28 Nov**", "23 days left", "121 bars". Primary **Curing finished**, disabled before the date with that reason in text. Secondary **Ask to end early**. | Same, centred. |
| Primary | **Step done** (last making step: **Go to Finish**). Out of range: becomes **Save with a reason** (one reason field; if the step is critical, **Report a problem** is also opened). Checklist with a No: **Report a problem**. | Same |
| More details | Equipment, start/end time (auto), photo, note, checker for this step (if set), Report a problem (always reachable here and in the header "!" button). | Same |
| Empty | A step with 0 fields: instruction + **Step done** only. | Same |
| Error / blocked | Previous step not done: "Finish 'Weigh' first." with a link. | Same |
| Offline | Step ticks are queueable on registered devices; pending chip shown. | Same |

### S6. Finish

| | Portrait | Landscape |
|---|---|---|
| Layout order | 1. Header "Finish · AS-2611-01". 2. **Summary card** (read-back, each line with Change): Good bars **118** (from 2 days in the log) · Rejects **3** (Soda ash 2, Cracked 1) · Samples kept **2** · "Expected 123, made 118 (**96 %**)" with tick or warning. 3. **Wrappers**: "Taken 125" (text), fields **Damaged wrappers** [__] and **Wrappers left over** [__], live line "125 = 120 used + 2 damaged + 3 left over ✓". 4. "Goes to: Hold area A". 5. Primary. | Left: summary card. Right: wrappers fields + keypad + primary. |
| Primary | **Finish batch** → confirm sheet "Finish batch AS-2611-01? 118 bars go to Hold area A for the quality check. You can't change the counts after this. [Finish batch] [Back]". Yield out of range: a reason field appears (required) and the button reads **Finish and report the problem**. Wrappers not balanced: the button is disabled and the text says "5 wrappers missing. Count again." with a secondary **Report a problem** after a second try. | Same |
| More details | Rejects: throw away vs redo split, reason codes, change hold area / scan location, checker at Finish (if set). | Same |
| Empty | Log empty → 3-screen version (Good bars → Rejects → Wrappers), each with one decision. | Same |
| Error | Retry is safe (idempotent `finishBatch`). On success: green banner on the order page "Batch AS-2611-01 finished. 118 bars waiting for the quality check." | Same |
| Offline | **Online only** (one transaction across stock): disabled with "Finishing needs a connection." | Same |

### Owner dashboard (one page, owner and site manager)

| | Portrait | Landscape |
|---|---|---|
| Layout order | 1. **Waiting for me** (approvals, quality checks, problem reports, end-early requests), max 5 rows with a verb button each ("Approve", "Check quality"), "See all (8)". 2. **Orders**: 5 counters as one tappable row (Draft 2 · Approved 1 · In progress 4 · Quality check 2 · Done this week 6) plus a "**2 late**" danger chip. Tapping opens S1 filtered. 3. **Coming out of curing** this week (product, bars, date). 4. **Made this week**: good pieces per product (bar list, table twin). 5. **Rejects and made vs expected**: one tile with reject % (7 / 30 days) and top 3 reject types, plus the last 10 batches' made-vs-expected % against the target band. | 3-column grid: column 1 = Waiting for me (tall); columns 2–3 = Orders counters across the top, then Curing and Made this week side by side, then the Rejects tile full width. |
| Primary | None page-level (this is a reading page). Each Waiting-for-me row has its own button. **New order** in the header (secondary). | Same |
| Hidden / More | Full board (S1 Board), the Rejects report, production plan (advanced), KPI definitions. | Same |
| Empty | Waiting for me: "Nothing is waiting for you." with a check icon. Curing: "No batches come out of curing this week." Made: "Nothing made this week yet." | Same |
| Loading / error | Per-tile error with retry. The page keeps the other tiles. Each tile shows "Updated 09:41". | Same |
| Offline | Read-only with the data time, "You're offline. Showing data from 09:41." | Same |

"Late orders" and "Today's output" from §5.2 are folded in (late = the chip on Orders; today = the first bar of "Made this week") to keep 5 tiles, not 7.

---

## 4. Operator word list

### 4.1 Use these words (simple English)

| Area | Words on screen |
|---|---|
| Things | Production order, Order, Batch, Batch number, Product, Ingredient, Materials, Materials list, Lot, Lot number, Label, Wrapper, Container, Cap, Scale, Mould, Hold area, Sample |
| Statuses | Draft, Approved, In progress, Quality check, Done, Failed, Cancelled; subtitles: Curing until …, In the mould until …, Resting until …, Materials ready, Waiting for approval |
| Actions (buttons) | New order, Approve, Get materials, Taken, All taken, Start, All OK, Weigh, Save, Weigh again, Step done, Curing finished, Go to Finish, Finish batch, Check quality, Pass, Not yet, Fail, Redo, Throw away, Report a problem, Ask for approval, Use another lot, Change, More details, Try again, Back |
| Numbers | How many, Needed by, Target, OK from … to …, Weight, Bars cut, Good bars / Good pieces, Rejects, Reject type, Damaged, Left over, Taken, Used, Expected, Made, % made, Samples kept, Expires |
| People | Checked by, Second check, Done by, Approved by |
| Time | Today, Ready on, … days left, Started, Finished |

### 4.2 Banned on operator screens (allowed in More details only if marked advanced, and in code/docs)

Dispense, dispensing · stage, staging, staged, materials staged · quarantine, quarantined (use **Hold area**) ·
disposition · release, released (use **Pass**, **Ready to sell**) · routing · line clearance · work order ·
reserve, reservation, allocate · tolerance (use **OK range**) · variance · yield (use **made vs expected**) ·
reconcile, reconciliation · deviation, CAPA, nonconformance (use **problem**) · exception · override ·
submit · post, posted, posting · void · theoretical · BOM · INCI (More details only) · SoD, co-sign ·
rework (use **Redo**) · scrap (use **Rejects / Throw away**) · snapshot · FEFO (use **use first**) ·
genealogy · traveler · transaction · entity · parameter · reading · awaiting QC · in_process or any
snake_case value · hold timer · substitution · tare/gross (use **container weight**) · spoiled (use
**damaged**) · returned (use **left over**) · pick list, picked (use **materials list**, **taken**) ·
"Got it" · "Defect"/"Defect rate" on operator screens (use **Reject**) · "Hold" as a QA decision (use
**Not yet**) · "Done" as a step button (use **Step done**).

Style rules: one idea per line, verbs first, numbers always with units, dates as "Fri 28 Nov" (no
relative-only dates), no idioms, no abbreviations except kg, g, °C, pH, QA.

---

## 5. Navigation

### 5.1 Production menu (left nav / drawer)

Today the Production group has 18 entries, including maintenance and master data (`nav.ts`). Decided:

| Role | Production menu items (in order) |
|---|---|
| `production_operator`, `warehouse_operator` | **My work** (S1 operator filter) · **Today** (plant daily log) |
| `production_planner`, `site_manager` | **Orders** (list/board) · **Today** · **Rejects and yield** · **New order** |
| `owner_director` | Same as planner + **Setup** sub-group: Products and formulas · Steps for each product (was Routings) · Work instructions · Equipment |
| Anyone with the permission, collapsed by default | **Advanced**: Production plan · Work orders (detailed) · Board (detailed) · Batches (full record) · Materials by scan (was Stage materials) · New batch without an order |

Move **Maintenance, PM plans, Maintenance work orders, Spare parts** out of Production into their own
**Maintenance** group, or under Setup → Equipment. Remove "Stage materials", "Batches" and "New batch"
from the main list.

### 5.2 Bottom tab bar (phone and iPad portrait, below 1024 px)

| Role | Tabs |
|---|---|
| Operator | **Home** · **Today** · **Scan** · **Help** |
| Owner / manager | **Home** · **Production** · **Sales** · **To approve** (badge) · **Menu** |
| QA | **Home** · **Quality check** (badge) · **Production** · **Scan** · **Menu** |

Never "Batches"; never a bare "Orders".

### 5.3 Home screen

**Operator Home** (replaces the generic tile grid of ux-system §3.5 for production operators):
1. Greeting and site chip.
2. **Ready today**: batches whose curing ends today or earlier, each with **Curing finished**.
3. **In progress**: batches with a started step, sorted by last touched. Each card shows product, batch number, current step, and one verb button (Weigh, Step done, Go to Finish). The most urgent card is the single dark `--cta` card.
4. **Next up**: Approved batches, with **Get materials** / **Start**.
5. A **Write today's count** tile, then "Continue where you left off".
6. Other task tiles only when the role has them (Receive materials, Count stock), smaller, below.

Empty state: "Nothing to make right now. The owner approves new orders. [Write today's count]".

**Owner Home**: the owner dashboard in §3. The full owner overview (finance, sales and so on) stays
one tap away as **Overview**. On first sign-in after V2 the owner lands on the production dashboard,
because that is what was tested.

---

## 6. Answers to the doc's open questions (UX view, decided)

| # | Decision | UX consequence |
|---|---|---|
| 1 | **Owner passes, using the audited override, until a QA person is named** (agree; GMP consultant to confirm). | No alarm styling every time. One info line on Check quality: "You made this batch and are passing it. This is recorded." The reason defaults to the setting text "No separate QA person yet" (editable). The board shows a small "Owner passed" tag in the batch history only. |
| 2 | **Only marked lines** (agree): lye solution, colour, extract, fragrance, preservative. | The marked line shows a "Second check" chip *before* weighing, so the operator calls the checker in time. Flow per S9: 2 taps. Owner-alone path: Ask for approval. |
| 3 | **Lye solution made ahead as its own short order** (agree; whether QA passes it first stays **[GMP: confirm]**). | It shows in the soap's materials list like any ingredient ("Lye solution 33.33 %, lot LS-0031, made 28 Oct, use by 4 Nov"). Its order uses the same 6 screens. The safety gear item is first in its Start check, with a warning icon. Home shows "Lye solution runs out in 2 batches" under Next up for the owner. |
| 4 | **Owner enters mould time, cure time and cut weight; the system assumes none.** Placeholders 1 day / 28 days are shown as greyed examples, never saved as values. | Approve is blocked until the cut weight is set (S13). The Cut screen shows "Cut each bar at **___ g**" in hero type. |
| 5 | **Just bring them** (agree): materials list ticks, no stock move. | S3 as designed; "Move stock to production" appears only when the setting is on. |
| 6 | **One log per day** (agree). | No shift picker on screen unless shifts are set. Date fixed to today. Changing it is under More details (supervisor). |
| 7 | **2 samples** prefilled at Finish (agree). How long to keep them is a QA setting, not an operator question. | Operators see only "Samples kept 2" with Change. |
| 8 | **Neither as proposed: one list of 5 statuses** (Draft, Approved, In progress, Quality check, Done) plus Failed and Cancelled. Quality check is its own status. Curing is not a status; it is the hourglass subtitle of In progress, with its own sub-group on the board and its own dashboard tile. | Chip, strip, filters and board columns use the same 5 words (B1). Amend ADR-074's strip from 4 to 5 positions in ADR-080. |

### Additional items to put into the design doc / ADR-080

- New setting `production.weighing.lot_confirm` (`last4` default, `scan`, `none`; restricted, **[GMP: confirm]**), assumption **A-PF2-11**.
- Status model change (5 statuses, Curing as subtitle, Failed as its own end chip), assumption **A-PF2-01** revised.
- The rule that each count is typed once (B3) as acceptance criteria in V2-6 and V2-8.
- Tab-bar and menu changes moved to V2-1.
- Glossary updates in `docs/PRD.md`: Materials list, Taken, Step done, Not yet, Damaged, Left over, Reject type.
- Revise ux-system §3.4, §3.5, §7 and §9.3 when ADR-080 is accepted (UX designer owns this; not done in this review).
