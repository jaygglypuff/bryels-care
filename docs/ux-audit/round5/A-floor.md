# Round 5 usability audit A: floor staff, seen as people who are new to computers (2026-11-08)

| | |
|---|---|
| Asked by | Owner: "Imagine you are an operator, owner, manager that is not very literate with computers, hence initial using is very difficult, including navigation." |
| Persona | A factory worker in the Philippines. Uses Facebook and GCash on a cheap Android phone. Reads short English slowly. Has never used business software. Wears gloves, stands, and is in a hurry. |
| Accounts | `operator.nfd@` (Rhea Mendoza, operator), `checker.nfd@` (Jun Dela Cruz, second operator), `warehouse.nfd@` (Lito Pascual), `manager.nfd@` (Dino Reyes, only for the box check). Note: the brief calls the operator "Jun", but in the demo Jun is the checker and Rhea is the operator. |
| Build | Production build at `http://localhost:3581`, small demo (lite seed), fresh database |
| Method | Playwright, phone 390×844 (`isMobile`, `hasTouch`); tablet 820×1180 for Home, a step and the batch record. Every task starts at sign-in. Real commands were run against the database. Screenshot files are named below; they are in the auditor's scratchpad (`…/scratchpad/novice/A/`) and are not committed. |
| Scope | Sign-in and Home; Get materials, Weigh with second check, steps, box labels, Finish; put away, receive, get from shelf, second check, send out, proof of delivery; navigation, search, help; typical mistakes and losing signal |

---

## 1. Summary

| Task | Can a novice do it alone? |
|---|---|
| 1. First sign-in and finding my work | **With help.** Typing a 29-character email with gloves is the hardest part. After that, Home's top card is clear. |
| 2. Operator: get materials → weigh → steps → labels → Finish | **With help.** Get materials and the plain steps work alone. Weighing (grams, three lot boxes, five separate checks), the Label and pack step (three green buttons, two print flows) and Finish (six count boxes, a different layout) need someone beside them the first few times. |
| 3. Warehouse: put away, receive, pick, check, send out, proof | **Put away and pick: yes. Receive and send out: with help.** Receive is a long form with codes, required dates for wrappers and browser pop-up errors. Send out prints the receipt only *after* the truck "left". The box check is not on the manager's Home. |
| 4. Navigation alone (back to my work, find a batch, find help) | **With help.** Home is always one tap away. But there are 3 Scan doors, 2 Menus, 2 "?" buttons and 2 "My work" doors. Search jumps to the wrong record when you press Enter on "0003". |
| 5. Mistakes (wrong lot or count, empty field, going back, no signal) | **Mixed.** A wrong lot or box is refused with a clear sentence. Out-of-range readings show raw codes and say "Saved." in a red box. Losing signal while weighing shows "tell your system administrator" and the typed weight is lost. **An empty wrapper count lets Finish go through** (bug B2). |

**Biggest single risk (bug B1):** the operator can record "checked by Jun Dela Cruz" on her own phone by tapping Jun's name and "Yes, I checked". No password is asked, although ADR-030 requires one.

---

## 2. The walks

Tap counts include taps on the keypad and on fields. "Type n" means n characters on the phone keyboard.

### Task 1: first sign-in on a phone

| # | Screen (URL) | Action | Taps | What the novice experiences | Shot |
|---|---|---|---|---|---|
| 1 | `/sign-in` | Tap Email, type `operator.nfd@bryels-care.test` | 1 + type 29 | Hesitates. "Welcome back" on a first visit. With gloves on, the 29-character email is the hardest moment of the whole day. Without "@", the browser shows its own pop-up instead of a sentence from the app. | `01-signin.png`, `104-signin-noat.png` |
| 2 | `/sign-in` | Password, Sign in | 2 + type 8 | "Email or password is incorrect." is clear. "This is a shared device" checkbox: does not know what to choose. | `105-signin-wrongpw.png` |
| 3 | `/dashboard` | Reads Home | 0 | Greeting is good. The intro sentence is cut off with "more". The 3 number tiles ("2 Batches for you · 0 Weighing · 0 Waiting") don't say what to do. The top card **Pour into moulds · Continue** is obvious: **pass**. Scan shows twice (top bar and bottom bar), plus "Scan or search" under QUICK ACTIONS. Menu shows twice (☰ top left and Menu bottom right). | `02-operator-home.png` |
| 4 | bell | Opens messages (badge 1, later 2) | 1 | 15 messages "Coconut Oil lot is ready — put it on L-2611-00017 · RM-01". This is warehouse work, already done, still marked NEW. Each one has a green **Open** button. The operator thinks she must do these. | `103-op-messages.png` |

**Taps to reach the first job: 4 plus 37 typed characters.** Once signed in it is 1 tap (Continue).

### Task 2: operator, lotion batch B-26-0004 (4 ingredients, 7 steps) and soap batch B-26-0003

| # | Screen | Action | Taps | Hesitation or failure | Shot |
|---|---|---|---|---|---|
| 1 | Home → `/production/orders/…/step/4` | Continue on "Pour into moulds" (soap) | 1 | Clear. "Nothing to fill in. Do the step, then tap Step done." Good. | `03-op-step4.png` |
| 2 | step 4 | Step done | 1 | No "Saved" message. The card shows "Step done by Rhea Mendoza" and **one big green button that says "Cure"**. *"Do I press Cure to say the curing is done?"* The button is named after the next step, not after the action ("Next step: Cure ›"). | `05-after-step4-done.png` |
| 3 | step 5 Cure | reads | 0 | **Pass.** Hourglass, "Curing until Tue 10 Nov · 2 days left", greyed "Curing finished". This is the best screen in the app. | `07-step5-cure.png` |
| 4 | Home → `/materials` (lotion) | Start on "Get the materials" | 1 | Card titles mix "Get the materials" (Home) and "Get materials" (page). | `02-operator-home.png` |
| 5 | Get materials | Reads first line | 0 | One long sentence per line: *"1. Bring lot L-2611-00010 (82.081 kg in it, Extracts and liquids shelf, expires 6 Feb 2027). Weigh out 17.919 kg. 64.162 kg stays for the next batch."* The header says **17.92 kg**, the sentence says **17.919 kg**. The lot code comes first and the shelf is buried in brackets. "Weigh out" here, then again on the Weigh screen: *"Do I weigh it now or later?"* | `08-getmaterials.png` |
| 6 | Get materials | "More details" on a line | 1 | Only "Not needed because … Not needed" is in there. **There is no way here to say "this container is almost empty, I take a second lot".** That lives on Weigh → More details → "Container weight, split over two lots…" (`/weigh/more`). | `09-getmat-moredetails.png` |
| 7 | Get materials | Taps "All taken" first (mistake) | 1 | Good guard: "Mark all 7 materials as taken? Cancel / Yes, all taken". | `10-alltaken-early.png` |
| 8 | Get materials | Taken ×7 | 7 | Clear tick and "Taken by Rhea Mendoza". When scrolling, the sticky "My work / Today" chip row covers the page title. After all 7, the first line still shows the stale badge **"1 of 7 taken."** | `11-after-first-taken.png`, `13-top.png` |
| 9 | Get materials | Start (green box "Materials ready … Next: Start.") | 1 | *"Start what?"* The button should say what comes next ("Next: Check the area is clean"). | `13-top.png` |
| 10 | step 1 clean check | Yes, Yes | 2 | "No instruction for this step." is an empty box that adds nothing. **Two buttons that do the same thing: "All OK" and "Save answers".** After 2 × Yes the novice does not know which one to press. | `14-after-start.png`, `16-step1-yesyes.png` |
| 11 | step 1 | Taps "No" (mistake) | 1 | Good: "What did you find, and what did you do?" and "Save and report a problem". | `15-step1-no.png` |
| 12 | step 1 | Save answers → "Weigh" | 2 | Same as step 2 above: the green button just says "Weigh". | `17-step1-saved.png` |
| 13 | `/weigh` | Reads the card | 0 | **The lot is shown three times:** "As taken at Get materials: weigh from L-2611-00010", the grey lot box, and "Taken at Get materials … taken". Target is **"17,919.0 g"** while Get materials said **"17.92 kg"**, and a 30 kg platform scale shows kilograms. "Second check" badge, but nobody explained it. | `18-weigh.png` |
| 14 | `/weigh` | Types the example lot `L-2611-00016` (mistake) | 3 | The lot box's grey example text **is a real lot number of another material**. Message: "That is not a lot of Purified Water you may use here. Check the label and type it again." It does not say *what* L-2611-00016 is or *which* lot to take. | `19-weigh-wronglot.png` |
| 15 | `/weigh` | Types `0010`, OK | 6 | "Lot number typed: lot L-2611-00010 ✓". Good: last 4 digits work. | `20-weigh-lotok.png` |
| 16 | `/weigh` | Keypad `1000` (wrong weight) | 4 | Live message "Too little by 16,739.8 g", plus "Weigh again / Ask for approval". Clear, but it shows on the *first* digit too ("Too little by 17,9xx g" while still typing). | `21-weigh-outofrange.png` |
| 17 | `/weigh` | C, `17919`, Save | 7 | Save sits **between** the field and the keypad, so a gloved thumb can hit Save in mid-entry. Typing 17919 g instead of reading "17.92" from the scale invites a factor-of-1000 slip. | `22-weigh-ready.png` |
| 18 | `/weigh` | After Save | 0 | The card turns into "Second check needed · Ask someone to watch you weigh … They pick their name" and a list of 5 names (Ana, Dino, Jun, Nina, Teresa). Then: "Next: Jun (operator), Dino (site manager), Nina (QA) or 2 others checks this weighing — they will see it on their Home". **Two different instructions on one card.** "Ask someone to watch you weigh" comes *after* the weighing was saved. | `23-weigh-saved.png` |
| 19 | `/weigh` (Rhea's phone) | Taps "Jun Dela Cruz" → "Yes, I checked" | 2 | **BUG B1:** no password. The record now says "checked by Jun Dela Cruz". | `24-pick-jun.png`, `25-yes-on-operator-phone.png`, `26-batch-record.png` |
| 20 | Jun's phone, Home | "Check a weighing · Check" | 3 (sign-in excluded) | Clear question: "Jun Dela Cruz, did you watch Rhea Mendoza weigh 3,790.0 g of Aloe Vera Juice, lot L-2611-00009? Yes, I checked it / No, send it back". Good. But the page intro under it says "Weigh out each ingredient…", which is meant for the operator, and Home's tile says "**0 Weighing**" while a weighing waits for him. | `27-checker-home.png`, `28-checker-check.png` |
| 21 | Jun's phone | After "Yes" | 0 | Jun lands on **Rhea's weigh card for the next ingredient** (Glycerin, lot box, keypad). There is no "Thank you, checked. Back to Home". A checker may start weighing. | `29-checker-after.png` |
| 22 | `/weigh` | Ingredients 3 and 4 (same as 15–20) | 2 × (10 + Jun 2) | — | `35-weigh-all-done.png` |
| 23 | `/weigh` | Step done | 1 | **A fifth check:** "Waiting for the second check of the weighing step … — you can do it now. Open the check". "You can do it now" is addressed to the *checker*, but shown to the operator. Jun must open the step again and confirm "did you check Weigh done by Rhea Mendoza?" (Home card: "Check weigh"). | `36-weigh-stepdone.png`, `38-checker-stepcheck.png` |
| 24 | Jun | Yes | 2 | Jun again lands on a screen with the green "Heat and mix" button. | `39-checker-after-stepcheck.png` |
| 25 | Rhea Home → step 3 | Continue | 1 | Rhea is not told the check happened. She must go back to Home. | `40-op-home-after-weigh.png` |
| 26 | step 3 Heat and mix | Step done with the reading empty (mistake) | 1 | **"Saved. Record Mix temperature (°C)."** Nothing was saved. | `42-step3-empty.png` |
| 27 | step 3 | Keypad `90` → Step done (mistake) | 3 | No live warning (Weigh has one), only after Step done: red box **"Saved. Mix temperature 90.000000 °C is outside 65–75 °C: needs a controlled exception with a deviation (CX-TOL)."** plus yellow "needs a approval". | `44-step3-90-done.png` |
| 28 | step 3 | C, `70`, Step done | 4 | "Mix temperature already has a reading. Give a correction reason (at least 5 characters) to replace it." The box for the reason is a plain text box: she has to type with gloves. The yellow "90.000000 … needs a approval" stays on screen after the 70 is typed. | `45-step3-70-done.png`, `46-step3-reason.png` |
| 29 | step 3 | Types a reason, Step done → "Cool" | 2 + type 16 | — | `47-step3-done.png` |
| 30 | steps 4, 5 | 2 digits + Step done + Next; Step done + Next | 6 | Fine. Locked steps say "Not yet · Finish "Cool" first." with a button to it. Good. | `48-step5-view.png`, `49-step5.png` |
| 31 | step 6 Label and pack | Reads | 0 | **3 green buttons** (Print 4 box labels, Print 96 labels, Step done). Box labels come *above* bottle labels, although bottles are labelled first. The label previews are full of codes (BX-00000006, LBL-BOX v1, NEW, L-2611-00019). "Printer: Label printer, **Warehouse 1**" is on a production screen. Piece labels change from 96 to 94 after the box labels are planned: *"Do the 2 QA samples get a label?"* | `50-step6.png` |
| 32 | step 6 | Print 4 box labels → "Open the box labels and print" → `/print/labels/batch-boxes/…` → Print → browser print window → "Yes, they printed" → back | ≈7 | Two taps before anything prints, then the browser's print window, then "Did all 4 labels come out right?" | `51b-after-print-click.png`, `52-boxlabels-print.png` |
| 33 | step 6 | Print 94 labels (same flow) | ≈5 | — | — |
| 34 | step 6 | Step done → "Go to Finish" | 2 | **Step 7 "Move to the hold area" is skipped.** The button jumps to `/production/<batch>/finish`, a different-looking page: small "‹ Back to the order" link 32 px, no "Step 7 of 7", no round back button. | `53-step6-done.png`, `54-step7.png` |
| 35 | Finish | Reads | 0 | 9 number boxes (good pieces, samples, then for each of bottles, caps and boxes: "left over" + "damaged"), 6 of them empty. "Wrappers" is used for bottles, caps and shipping boxes. "You packed 96 pieces: that uses 4 boxes" (94 are in boxes). "Goes to: QA waiting area (QUA-01)". The **Finish batch** button is half-width in the middle of the page, and the **box labels and piece labels repeat below it** with 2 more green buttons. | `54-step7.png` |
| 36 | Finish | Types 5 left-over bottles (mistake) | 6 fields | Good sentence: "96 taken = 96 used + 0 damaged + 5 left over. 5 bottles too many — count the left-over and damaged ones again." Finish is disabled. | `56-finish-wrongcount.png` |
| 37 | Finish | **All count boxes empty → Finish batch → "Yes, finish"** | 2 | **BUG B2:** accepted. "Batch B-26-0004 finished". The batch record has no wrapper count. | `57-finish-confirm-empty.png`, `58-finish-empty-submit.png` |
| 38 | `/production/orders/…?finished=B-26-0004` | — | 0 | The page opens **scrolled to the bottom**, on the daily log form "What happened today? · Good pieces made 0 · Save to daily log". The success message is off screen. *"Do I have to type 96 again?"* | `58-finish-empty-submit.png` |
| 39 | Home | — | 1 | Lotion card gone, "1 Waiting". No "Done! Next: QA (Nina or Teresa) checks it" on Home. | `59-op-home-after-finish.png` |

**Taps for one lotion batch:** about 95 for the operator (Get materials 10, clean check 3–4, weigh 4 × 10, steps 3–5 ≈ 16, labels ≈ 14, Finish ≈ 14), plus 12 for the checker on his own phone, and 1–2 sign-ins. On paper this is 7 signatures.

### Task 3: warehouse (Lito), then the site manager (Dino) for the second check

| # | Screen | Action | Taps | Hesitation or failure | Shot |
|---|---|---|---|---|---|
| 1 | `/dashboard` | Reads | 0 | "What to do next: put away Coconut Oil lot L-2611-00017 on **RM-01 (Oils rack)**. It waits at QA waiting area." Shelf code before the shelf name. **Two green buttons** (Put it away, Get from shelf), then 4 counters and 6 tiles. "Proof of delivery missing" is a jargon word. | `60-wh-home.png` |
| 2 | Put away | Put it away → tap Coconut Oil → "Put away to Oils rack" | 3 | **Pass**, the best warehouse flow. Hesitations: "Belongs in: Oils rack RM-01, Extracts and liquids shelf RM-02" (two places?), "How much? (optional)" with a kg/g selector. The shelf is never scanned to confirm. "‹ Back to the list" is 17 px high. | `62-putaway.png`, `63-putaway-lot.png` |
| 3 | after | — | 0 | "Done: lot L-2611-00017 is now on **RM-01**. It can be used now." The shelf code, not "Oils rack". | `64-putaway-done.png` |
| 4 | Receive (bottom bar) | Tap Manila Print & Pack | 2 | Two unlabelled icon buttons at the top (receipts, put away). Otherwise clear: "Which delivery is it? Tap the supplier". | `65-receive.png` |
| 5 | Receive form | Save and print labels with nothing filled (mistake) | 1 | Browser pop-up "Please fill out this field." on "Number on the supplier's paper", not an app sentence. | `67-receive-empty-save.png` |
| 6 | Receive form | Supplier paper number, qty × 2, expiry × 2 | ≈12 + typing | **Expiry date is required for wrappers and bottles** ("Cartons and wrappers often have none" is said for the lot, but the date is still required), so people invent dates (the demo's packaging "expires 2031"). Codes MAT-0010 / MAT-0011 after names. Date box is mm/dd/yyyy. | `66-receive-po.png` |
| 7 | Labels | Print, print window, "Yes, they printed" | ≈4 | Labels say **RAW MATERIAL** and **QUARANTINE** for wrappers and bottles. "Stick one on each sack or drum": these are cartons. "Did all 2 labels come out right?" | `69-receive-saved.png` |
| 8 | Home → Get from shelf | list → Get from shelf | 2 | Fine. | `70-picking.png` |
| 9 | `/sales/picking/<id>` | Reads | 0 | The page title is **"PK-26-000001"**, not the customer. The two boxes are listed twice ("Still to take" and "To take"). The box box's grey example text is **BX-00000005, a real box of another order**. "Something you cannot find? Use ⋯ More → Finish with items missing": the needed action is hidden in a menu. | `71-pick.png` |
| 10 | pick | Types `BX-00000005` (mistake) | 2 | **Good:** "Box BX-00000005 is not for this order. Put it back and scan a box on the pick list." | `72-pick-wrongbox.png` |
| 11 | pick | Types `1` (mistake), then `0001` | 4 | "That number is not on this order." Then "**Picked** box BX-00000001: 24 pcs of lot L-2611-00015." ("Picked" is jargon; the screen title says "Get from shelf".) | `73-pick-0001.png` |
| 12 | pick | Taps box 2 in the list **without** writing why | 1 | Accepted, logged as "typed by hand" (bug B9). | `74-pick-tap-noreason.png` |
| 13 | pick | Finish getting from shelf | 1 | Lands on the delivery page `SH-26-00001` "Step 2 of 5: Second check of the box". Good: "Next: … checks the box". | `75-pick-finished.png` |
| 14 | Lito tries the check himself | Check the box | 1 | Good: "You took these off the shelf, so someone else does the second check." But it says "they will see it on **Packing**": no screen is called Packing for Dino. | `77-wh-selfcheck.png` |
| 15 | Dino, Home | Looks for it | 0 | **Not on Dino's Home.** "What to do next" says "1 lot expires within 30 days". He finds it only through the bell ("Check the boxes of delivery SH-26-00001"). | `76-manager-home.png`, `79-mgr-messages.png` |
| 16 | Dino, `/sales/packing/<id>` | Types 0001, 0002, Finish the check | 5 | Clear. "Boxes on the truck" and "Who delivers" can stay empty. "Manager: allow sending more or less than ordered" is shown to everyone. | `78-mgr-check.png`, `80-mgr-checked.png` |
| 17 | Lito, delivery | Send out now with nothing typed (mistake) | 1 | Browser pop-up on Driver. | `83-sendout-empty.png` |
| 18 | delivery | Driver, plate, Send out now, Yes | 4 + type 18 | The driver is typed every time (no list of the company's drivers). **"Print delivery receipt" appears only after "Sent out".** The driver needs that paper *before* he leaves, and nothing says so. | `84-sendout-confirm.png`, `85-sentout.png` |
| 19 | proof of delivery | Save with no signature (mistake), sign, Save | 3 + type 10 | "Draw the signature first." After signing, the box says "**Signature saved.**" (it is not saved yet) and the old red line stays. On the first try the next Save did not submit (bug B11); on a fresh page it worked: "Delivered. Next: finance bills it". | `86-pod-nosig.png`, `87-pod-signed.png`, `88-pod-saved2.png` |

**Taps:** put away 3 · receive ≈ 20 plus typing · pick 6 · second check 6 (plus finding it) · send out 5 plus typing · proof 3 plus typing.

### Task 4: navigation alone

| # | Goal | Path | Taps | Result | Shot |
|---|---|---|---|---|---|
| 1 | Back to my work | Bottom bar Home | 1 | **Pass** from every screen. But "Home" and "My work" are different places. Step pages add a second row "My work / Today" under the top bar, the same as the bottom bar, and it covers the page title when you scroll. | `03-op-step4.png`, `11-after-first-taken.png` |
| 2 | Find batch B-26-0003 | Scan (bottom) → "Search anything" → type `B-26-0003` → Enter | 3 + type 9 | **Pass**: opens the batch record. | `91-search-B260003.png` |
| 3 | Same, typing the last digits `0003` + Enter | — | 3 + type 4 | **Fail**: opens the QA check **INS-26-00003**. The list (without Enter) shows 10 hits, starting with "Quality test", then the batch, the production order, "Box or sack", "Document · label", "**Set aside** · RSV-26-000003", "**Stock change** · MOV-26-000003". | `91-search-0003.png`, `92-search-list-0003.png` |
| 4 | Same, typing "acapulco" + Enter | — | — | Opens the *ingredient* "Acapulco Leaf Extract" (setup page). | `91-search-acapulco.png` |
| 5 | Side effect | On the QA check page the operator can tap "Save sample" → "Yes, continue". | 3 | Allowed by the permission matrix (operators hold `quality.inspection.create`), but it takes 1 bottle out of stock from a QA screen the operator reached by accident. | `94-op-save-sample.png` |
| 6 | Find help | "?" in the top bar, or "?" next to the title | 1 | Both open the *same* panel "Do a step (Start check, Mix, Curing, Cut, Wrap) · Version 5 · updated 2026-11-06". It is long, mentions a "See how" button not on the step, and says a checker can "pick their name on your tablet". `/help` "your day in 5 steps" is good, but says "For packaging, type how many were used and thrown away", which is no longer what the step asks. | `95-help-panel.png`, `96-inpage-help.png`, `97-help-page.png` |
| 7 | Menu | ☰ or Menu | 1 + 2 | Operator menu: Home › Overview / Messages / Help & my account · Operations › My work / Today · Inventory › Stock / Scan or search. "Overview" is Home under another name. It is the same as the bottom bar. | `98-op-menu.png`, `100-menu-expanded-operator.png` |
| 8 | Today (bottom bar) | — | 1 | "Nothing written today yet … open the production order and fill in 'What happened today?'". An empty tab for the operator, and the same as the "Today's count" quick action. | `102-today.png` |
| 9 | Tablet | Home | — | Same layout, much empty space. An unlabelled cloud icon (sync). The 3 number tiles stretch across the screen. | `110-tablet-op-home.png` |

### Task 5: mistakes, rated

| Mistake | Message | Rating |
|---|---|---|
| Wrong lot typed at Weigh | "That is not a lot of Purified Water you may use here. Check the label and type it again." | ◐ Clear, but it does not say which lot to take or what the typed one is. |
| Wrong box at pick or check | "Box BX-00000005 is not for this order. Put it back and scan a box on the pick list." | ● Good |
| Weight out of range | "Too little by 16,739.8 g · Weigh again / Ask for approval" | ● Good (shows while still typing) |
| Step reading out of range | "Saved. Mix temperature 90.000000 °C is outside 65–75 °C: needs a controlled exception with a deviation (CX-TOL)." | ✗ "Saved." in red, 6 decimals, jargon, a code |
| Correcting a reading | "Give a correction reason (at least 5 characters)" | ◐ Correct rule; must type with gloves |
| Empty reading | "Saved. Record Mix temperature (°C)." | ✗ Nothing was saved |
| Wrong wrapper count | "5 bottles too many — count the left-over and damaged ones again." | ● Good |
| Empty wrapper count | none: Finish goes through | ✗ Bug B2 |
| Empty required field (receive, send out, proof name) | Browser pop-up "Please fill out this field." | ◐ Generic, English only, disappears |
| Losing signal while weighing | The whole page becomes "The production orders page could not be loaded. Nothing was changed. If this keeps happening, tell your system administrator." The typed lot and weight are gone. It stays like this when the signal returns. | ✗ |
| Going back mid-task | Get materials and steps save per tap: nothing lost. Weigh loses a typed lot or weight if you leave before Save. | ◐ |
| Operator approves her own check by tapping the checker's name | accepted | ✗ Bug B1 |

---

## 3. Top 15 problems (ranked by how badly they stop a novice)

### 1. Five separate second checks per batch, and two ways to do them
- **Where:** `/weigh` after each Save, then `/step/2`; the checker's Home.
- **What the person experiences:** After every ingredient the card blocks with "Ask someone to watch you weigh … They pick their name" and 5 names. It also says "they will see it on their Home". Then after the last ingredient there is one more "second check of the weighing step". The checker walks back and forth 5 times. After each "Yes" he lands on the operator's next weigh card.
- **Why:** per-line checks (ADR-030) and the step check (ADR-080) were both kept. The name list on the operator's phone skips the password (bug B1).
- **Fix:**
  - (a) One checker moment per ingredient, on the operator's phone. The checker taps his name **and types his 4-digit PIN** (ADR-030 says password; a PIN is shorter for gloves). The card says: **"Jun, look at the scale: 3,790 g of Aloe Vera Juice, lot …0009. Correct? [Yes, correct] [No]"**.
  - (b) Remove the separate "second check of the weighing step": four checked lines *are* the checked step. If QA needs one, ask it once, on the last line ("Jun, all 4 weighed and checked? [Yes]").
  - (c) Remove "they will see it on their Home" from the operator's card. Keep "check from your own phone" only as a link "Jun is not here? Send it to his phone".
  - (d) After the checker confirms on his own phone: **"✓ Checked. Thank you, Jun. [Back to Home]"**. Never the operator's next card.

### 2. Finish is a different, long page; empty counts pass
- **Where:** `/production/<batch>/finish`.
- **What the person experiences:** A new layout (no "Step 7 of 7", small back link, half-width button in the middle). 9 number boxes. The word "wrappers" covers bottles, caps and boxes. The box and piece label printers appear again *below* the Finish button. Empty boxes are accepted (B2).
- **Why:** Finish is still a separate screen from the step template (ADR-119 "one record template" did not reach it).
- **Fix:**
  - Make Finish **step 7 of 7** in the same step template.
  - Show one question per packing material, already answered with the expected values: **"Bottles: took 96, used 96. All used, none broken? [Yes ✓] [No, some are left or broken]"**. The two number boxes open only on "No".
  - Good pieces: "**96 bottles made?** [Yes] [No, write the number]".
  - Delete the label section from Finish (it belongs to step 6). One full-width button at the bottom: **"Finish and send to QA"**.
  - The server refuses an empty answer.

### 3. Label and pack: three green buttons and two print trips
- **Where:** `/step/6`.
- **What the person experiences:** Box labels sit above bottle labels. Each needs 2 taps, then the browser print window, then "Did all 4 labels come out right?". Bottle labels change from 96 to 94. Label previews show LBL-BOX v1, NEW, BX codes. "Printer: … Warehouse 1".
- **Fix:**
  - One numbered list in work order: **"1. Print 94 bottle labels [Print]  2. Stick them  3. Pack 24 in a box  4. Print 4 box labels [Print]  5. Stick one on each box"**. Only the current line has the green button; the done line shows "✓ Printed".
  - Print straight from the button (skip the in-between page).
  - Remove the template code, version and "NEW" from previews (keep them in the printed footer only).
  - Show the printer of *this* room.
  - Say "2 bottles for QA samples: no label needed" (or the company's rule, flagged for QA).

### 4. Weighing in grams on a kilogram scale; the lot shown three times
- **Where:** `/weigh`.
- **What the person experiences:** Get materials said "17.92 kg"; Weigh asks for "17,919.0 g" and a 5-digit entry. The lot appears in three boxes. The grey example "L-2611-00016" in the lot box is a real lot number. Save sits between the field and the keypad.
- **Fix:**
  - Ask in the unit the scale shows (setting on the scale record: kg or g). **"Weigh 17.92 kg (OK 17.74–18.10)"**, keypad `17.92`.
  - One lot block: **"Take: Purified Water · lot …0010 · Extracts shelf [Scan label] or type the last 4: [____]"**.
  - Remove "As taken at Get materials" and the second "Taken at Get materials" card.
  - Grey example text: "last 4 digits, e.g. 0010" using *this* line's lot.
  - Put the keypad right under the field and **Save under the keypad**.
  - Move "Container weight, split over two lots" out of "More details" as a visible link: **"Container almost empty? Use two lots"**.

### 5. Too many doors: 3 Scans, 2 Menus, 2 "?", 2 "My work", and a second tab row
- **Where:** app frame on phones.
- **What the person experiences:** The top bar (☰, Scan, bell, ?, RM), then the "My work / Today" chip row on step pages, then the bottom bar (Home, My work, Today, Scan, Menu), plus "QUICK ACTIONS Scan or search / Today's count" on Home. The chip row covers the title when scrolling.
- **Fix:** see section 4. For floor roles:
  - Top bar = logo, bell, avatar only.
  - Bottom bar = 4 items.
  - Remove the chip row, the Home quick actions, the in-page "?" (keep one "?" in the top bar), and the "Today" tab.

### 6. Messages flood the operator with warehouse work that is already done
- **Where:** bell, `/notifications`.
- **What the person experiences:** 15 "… lot is ready — put it on …" messages, each with a green **Open**. One is still NEW after the lot was put away. "Check the boxes of delivery" also reaches the operator.
- **Fix:**
  - Send put-away messages only to people who hold `inventory.putaway`.
  - Clear a message automatically when its job is done ("✓ Done by Lito").
  - Show at most 5 messages, grouped: **"12 lots are ready for a shelf (warehouse)"**.
  - Remove "Mark read / I'm on it" for floor roles (tap = read).

### 7. Losing signal mid-weighing loses the work and blames the system administrator
- **Where:** `/weigh`, Save with no network.
- **What the person experiences:** The whole page is replaced by "The production orders page could not be loaded … tell your system administrator". The typed weight is lost. Nothing changes when the signal returns. The offline workspace exists (`/sync`) but needs device registration and "Download offline data", which no operator will find.
- **Fix:**
  - Keep the card on screen with a yellow line: **"No signal. Your weight is kept on this phone. Tap Save again when the signal is back."**
  - Auto-retry when back online, with the same idempotency key.
  - Never say "system administrator" to floor staff. Say "If it keeps happening, call your supervisor (Dino)".
  - Pre-register shared floor tablets in setup so the offline workspace is ready without the operator's action.

### 8. Readings: "Saved." in red, raw decimals, codes, typed reasons
- **Where:** step cards with readings (`/step/3`).
- **Fix:**
  - Live check while typing, like Weigh: **"90 °C is too hot (OK 65–75 °C)"**.
  - On Step done: **"Not saved. 90 °C is too hot. Let it cool and measure again, or [Ask Dino to accept 90 °C]"**.
  - Never print "90.000000" or "CX-TOL" on the floor. Never start a refusal with "Saved.".
  - Correction reason as 3 big buttons: **"I typed it wrong" · "I measured again" · "Other (write)"**.
  - Clear the old warning when the new value is OK.

### 9. Get materials reads like a paragraph; the partial-container case is not here
- **Where:** `/materials`.
- **Fix:** Three short lines per item:

  ```
  Purified Water            17.92 kg
  📍 Extracts and liquids shelf
  Lot …0010 (82 kg in it)   [✓ Taken]
  ```

  - Remove "Weigh out …" and "… stays for the next batch".
  - Same number format everywhere (kg with 2 decimals).
  - In "More details": **"Not enough in this container? Take a second lot"**, which offers the next lot by use-first.
  - After all are ticked, the green button says **"Next: Check the area is clean ›"**.

### 10. The "next" button is named after the next step; no "Saved" message
- **Where:** every step after Step done ("Cure", "Weigh", "Heat and mix", "Cool"); Get materials "Start".
- **What the person experiences:** *"Do I press Cure to say curing is done?"*
- **Fix:** After every action a green line **"✓ Saved."** and the button **"Next step: Cure ›"**. On the clean check, remove "All OK" or "Save answers": keep one button, **"Save"**, enabled when every row has an answer. Delete "No instruction for this step." boxes.

### 11. The site manager's Home does not show the check waiting for him
- **Where:** Dino `/dashboard` while SH-26-00001 waits for its box check.
- **What the person experiences:** "What to do next: 1 lot expires within 30 days." The box check is only in the bell. The warehouse page says "they will see it on Packing", a screen name Dino does not have.
- **Fix:** Every "needs a different person" item goes to the top of that person's "What to do next": **"Check 2 boxes for Luntian Wellness Stores (Lito got them from the shelf) [Check boxes]"**. Replace "on Packing" with "on their Home".

### 12. Receiving a delivery is a long form with required dates for wrappers
- **Where:** `/inventory/receive?po=…`.
- **Fix:**
  - One item at a time ("Item 1 of 2"). Show the amount ordered, prefilled: **"2,000 wrappers came? [Yes] [No, fewer]"**.
  - Expiry and supplier lot are *asked only when the material needs them* (a setting on the material, flagged for QA review). Never require an invented date.
  - App messages under the field instead of browser pop-ups.
  - Delivery labels for packaging say "PACKAGING", not "RAW MATERIAL", and "stick one on each carton".

### 13. Get from shelf: a code as the title, boxes listed twice, misleading examples
- **Where:** `/sales/picking/<id>`.
- **Fix:**
  - Title **"Luntian Wellness Stores · 2 boxes"** with PK-… small.
  - One list. Each box row shows **shelf name (big) → box last 4 digits (big) → [✓]**.
  - Grey example text "last 4 digits on the box label".
  - Replace "Picked" by "Got box …0001 ✓ (1 of 2)".
  - A tap without a scan must open "Why can't you scan it? [Label torn] [Scanner broken] [Other]". Today the reason is skipped (bug B9).
  - "Something you cannot find?" becomes a visible button **"A box is missing"**.

### 14. Send out and proof of delivery: the paper comes too late, everything is typed
- **Where:** `/sales/shipments/<id>`.
- **Fix:**
  - Order the step as **"1. Print the delivery receipt [Print] → 2. Driver: [pick from list] Plate: [prefilled] → 3. [Truck is leaving]"**.
  - A list of the company's drivers and plates (a setting); type only for a new one.
  - "Proof of delivery" becomes **"Customer signed?"**.
  - The signature box says "Signed ✓ (not saved yet — tap Save)".
  - Clear the old error when a signature is drawn.

### 15. Search and sign-in are built for office users
- **Where:** `/inventory/scan` search; `/sign-in`.
- **What the person experiences:** Typing "0003" and Enter opens a QA check, not the batch. Results use "Set aside", "Stock change", "Document · label" with RSV/MOV codes. Sign-in needs a 29-character email.
- **Fix:**
  - For floor roles, search shows only **batches, lots, boxes, shelves, orders**, batches first. Enter opens a record only when exactly one matches.
  - On shared floor tablets, sign-in shows **photo/name tiles of the site's floor people + a 4-digit PIN** (setting per device; the password stays for personal phones).
  - Remove "Welcome back" on first use.
  - The page intros "This screen is for …" are cut off with "more" on every page. Delete them on floor screens: the title and the one green button are enough.

---

## 4. Navigation proposal for floor roles

**Principle:** Home *is* my work. One bar, four doors, the same on phone and tablet. Nothing else on the frame except the bell and the avatar.

### Top bar (all floor roles)
`[BC logo → Home]` ……… `[🔔 Messages (n)]` `[avatar → My account, Help, Sign out]`

Remove from the top bar on phones and tablets for floor roles: ☰, Scan, "?", the cloud icon. The "My work / Today" chip row goes away on every page.

### Bottom bar

| Role | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| Production operator / checker | 🏠 **My jobs** (Home) | 📷 **Scan** (camera opens straight away; search box below) | 🧪 **Batches** (list of this site's batches: in progress first, big batch number) | ❓ **Help** (the 5-step guide for my job, pictures, "Call Dino" button) |
| Warehouse | 🏠 **My jobs** | 📷 **Scan** | 📦 **Receive** | ❓ **Help** |
| Site manager on the floor | 🏠 **My jobs** | 📷 **Scan** | ✅ **To check/approve** (badge) | ❓ **Help** |

"Today", "Menu", "Inventory", "Overview" and the Home quick actions go. Office screens stay reachable from the avatar → "All screens" for the few who need them.

### Home ("My jobs") for floor roles
1. **One big card at the top: the next job**, with a picture/icon of the action (scale, box, truck), the product name in large text, "Step 3 of 7" and one full-width green button with a verb ("Weigh", "Get from shelf", "Check Rhea's weighing").
2. **"Waiting for you to check"** (for checkers), above everything else when not empty.
3. **"Later today"**: a short list of the other cards, each a full-width row.
4. **"Waiting (nothing to do)"**: grey cards like "Curing until Tue 10 Nov".
5. No number tiles ("0 Weighing", "1 Waiting") and no intro sentence.

After finishing any job, the app returns to Home with a green line at the top: **"✓ Batch B-26-0004 finished. Next: QA (Nina) checks it. Nothing more for you."**

---

## 5. Bugs found

| # | Severity | Bug | Steps to reproduce | Shot |
|---|---|---|---|---|
| B1 | **High (integrity)** | The operator records a second-person weighing check as another person without that person's password. ADR-030 requires the checker to type their own password (`src/lib/auth/co-sign.ts`). The help text also teaches "they tap their name on your tablet". | Sign in as `operator.nfd@`. Production order 4 → Get materials (tick all) → Start → clean check → Weigh. Type lot `0010`, weight `17919`, Save. Tap "Jun Dela Cruz" → "Yes, I checked". The batch record shows "checked by Jun Dela Cruz" and the timeline "Second person checked the weighing … Jun Dela Cruz". | `24-pick-jun.png`, `25-yes-on-operator-phone.png`, `26-batch-record.png` |
| B2 | **High** | Finish accepts empty packing-material counts (left over / damaged). A wrong count blocks Finish, but an empty one does not. The batch record then has no wrapper count. | Finish B-26-0004 (`/production/<batch>/finish`) without typing anything in the 6 "left over / damaged" boxes → Finish batch → Yes, finish. "Batch B-26-0004 finished". The batch record has no left-over or damaged line. | `57-finish-confirm-empty.png`, `58-finish-empty-submit.png` |
| B3 | Medium | A step reading out of range shows a red error that starts with **"Saved."**, prints `90.000000 °C`, the code `CX-TOL`, "needs **a** approval". The old warning stays after a correct value is typed. | `/step/3` (Heat and mix): keypad 90 → Step done. | `44-step3-90-done.png`, `46-step3-reason.png` |
| B4 | Medium | Step done with a required reading empty says "**Saved.** Record Mix temperature (°C)." | `/step/3`: Step done with no value. | `42-step3-empty.png` |
| B5 | Medium | After Finish, the redirect `/production/orders/<id>?finished=B-26-0004` opens scrolled to the bottom (daily log form). The success message is off screen. | Finish any batch on a phone. | `58-finish-empty-submit.png` |
| B6 | Medium | With no network, Save on Weigh replaces the page with "The production orders page could not be loaded … tell your system administrator". The typed lot and weight are lost. The page does not recover when the network returns. | Weigh card: type the lot, then switch the browser offline, type a weight, Save. Go back online. | `32-offline-save.png`, `33-back-online.png` |
| B7 | Low | Get materials: the "1 of 7 taken." badge stays under the first line after all are taken. The header amount "17.92 kg" does not match the line text "17.919 kg" (same for every line). | Tick all lines on `/materials`. | `13-top.png`, `08-getmaterials.png` |
| B8 | Medium | Grey example text in code boxes uses **real record numbers of other records**: Weigh lot box `L-2611-00016` (not the lot to use), put-away `L-2611-00016`, pick/check box `BX-00000005` (a box of another order). A novice types the example. | Open `/weigh`, `/inventory/receive/put-away`, `/sales/picking/<id>`. | `18-weigh.png`, `62-putaway.png`, `71-pick.png` |
| B9 | Medium | Get from shelf: tapping a box in "Still to take" without writing the required reason is accepted. It is logged as "typed by hand", which is wrong: it was tapped. | `/sales/picking/<id>`: leave "Label will not scan? Say why" empty, tap a box row. "Scans so far" shows "· typed by hand". | `74-pick-tap-noreason.png` |
| B10 | Medium | Put-away messages go to the production operator and stay NEW after the lot was put away (Coconut Oil L-2611-00017). | Put away Coconut Oil as `warehouse.nfd@`, then open the bell as `operator.nfd@`. | `103-op-messages.png` |
| B11 | Low (intermittent) | Proof of delivery: after a failed Save ("Draw the signature first"), drawing the signature and pressing Save did not submit. The old error stayed under "Signature saved." A fresh page worked. | Sent-out delivery: type the name, Save (no signature) → draw → Save. | `86-pod-nosig.png`, `88-pod-saved.png`, `88-pod-saved2.png` |
| B12 | Low | Broken sentences: activity "Lito Pascual **manual entry the pick list**"; Home card and message "**Check weigh** (of batch …)"; "did you check **Weigh** done by Rhea Mendoza?"; "After you save, Jun, Dino, Nina or 2 others **checks** it"; "Did **all 2** labels come out right?"; "Finish batch? … 96 good pieces" while 94 are boxed; Finish "You packed 96 pieces: that uses 4 boxes". | Seen in the walks above. | `76-manager-home.png`, `27-checker-home.png`, `69-receive-saved.png`, `54-step7.png` |
| B13 | Low | The checker's Home tile says "0 Weighing" while a weighing waits for his check. | Save a weighing as the operator, then open Home as `checker.nfd@`. | `27-checker-home.png` |
| B14 | Medium | Search + Enter opens the first hit of any kind. "0003" opens QA check INS-26-00003, not batch B-26-0003. "acapulco" opens the ingredient Acapulco Leaf Extract. | `/inventory/scan` → "Search anything" → `0003` → Enter. | `91-search-0003.png`, `91-search-acapulco.png` |
| B15 | Low | Help is out of date: it says packaging asks "how many were used and thrown away" (step 6 asks nothing), mentions a "See how" button that is not on the step, and teaches name-tap checks (B1). | `/help` (Machine operator) and "?" on a step. | `95-help-panel.png`, `97-help-page.png` |
| B16 | Medium | Receiving packaging requires an expiry date, so people invent one (the demo's bottles and boxes "expire 2031"). | `/inventory/receive?po=<Manila Print & Pack>` → Save: the date boxes are required. | `66-receive-po.png` |
| B17 | Low | Tap targets under 44 px: Finish "‹ Back to the order" (140×32), put-away "Back to the list" (98×17), pick "‹ To get from shelf" (140×32), delivery "Deliveries" (95×32), signature "Clear" (63×34). | Measured with `getBoundingClientRect`. | `54-step7.png`, `63-putaway-lot.png`, `71-pick.png` |
| B18 | Low | After confirming a check on his own phone, the checker lands on the operator's next weigh card (or on the step with the green "Heat and mix" button) and can carry on with the operator's work. | Check a weighing as `checker.nfd@`. | `29-checker-after.png`, `39-checker-after-stepcheck.png` |
| B19 | Low | Step 7 "Move to the hold area" is never shown as a step. "Go to Finish" jumps from step 6 to the Finish page, and the record marks step 7 Done. "Hold area", "QA waiting area" and "QUA-01" name the same place. | Step done on step 6. | `53-step6-done.png`, `54-step7.png` |

No page scrolled sideways at 390 px. No server errors, apart from the offline case.

---

## 6. Assumptions and open points for the owner

- PIN sign-in on shared floor tablets and a PIN for co-signing (problems 1 and 15) need an owner decision and a superseding ADR to ADR-030. QA must accept a PIN as the record of who checked.
- Whether a separate "weighing step" check is required on top of per-ingredient checks (problem 1) is a quality rule for the company's QA to decide; the audit does not decide it.
- Whether QA samples get product labels, and whether packaging needs an expiry date, are QA settings, not code rules.
- Every number in this report comes from the small demo after a fresh start; tap counts are for the lotion batch (4 ingredients, 7 steps).
