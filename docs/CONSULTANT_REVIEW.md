# External consultant review (2026-10-30): flows, first-time users, floor screen

| | |
|---|---|
| Asked by | Owner: "Recheck if there are processes and flows we can further streamline… terms are technical and a first timer may be frozen… look-up needs an exact code… plan a real-time dashboard for the production area… the UI/UX in the document was not implemented… make it spoon-feeding." |
| Method | Two independent reviews on the running demo (iPad, phone, desktop): a UX review against the brief's Part II–IV and mockup board, and a process review that walked every flow end to end with real records and counted screens, taps, typed fields, people and hand-offs |
| Read with | `docs/USABILITY_TEST.md`, `docs/FLOOR_DISPLAY.md`, ADR-081..085 |

## 1. Verdict

The shell is now right (five destinations, plain Home, fits every screen). What is missing is **guidance**:
screens still show *records and filters* ("Production orders", Draft/Approved/…, lots) where a first-timer
needs *the next task with one button*. Several hand-offs between people are silent, so work waits until
someone happens to look.

## 2. Flows measured (today → target)

| Flow | Today | Target | Biggest wins |
|---|---|---|---|
| A. Receive → QA → put away | 9 screens, ~13 taps, 5–8 typed, 2 silent hand-offs, 3 "where now?" moments | 6 screens, ~7 taps, 3–4 typed, every hand-off notified | "Post and print labels" in one; QA told when a delivery is posted, queue oldest first; after QA release a **"To put away"** list with the lot and a suggested shelf preselected |
| B. Production order → finished goods | ~110 taps + 16 typed, ~14 operator screens, 2 detours to the full batch record, 2 silent hand-offs | ~45 taps + 12 typed, ~9 screens, no detours | Production orders appear in **To approve**; equipment chosen on the step (only one usable mixer → preselected); packaging issued on step 6; Finish reads the step-6 counts; QA tests saved in one form; checker gets a task; (GMP decision) weighing step finishes itself after the last checked line |
| C. Customer order → payment | ~12 screens, ~27 taps, 9 typed, 6 hand-offs (2 silent); **17 shipments never invoiced, oldest 7 Oct** | ~8 screens, ~15 taps, 5 typed | "Create and confirm"; default delivery date; auto-reserve stock when fully available; warehouse "To pick" tile; **invoice draft created at dispatch** and "Not invoiced" on owner Home; payment prefilled from its invoice |
| D. Finding things | Exact codes only; "coconut", supplier names, last digits, WO/PO/INV numbers not found | One search for everything | Plain-word search (built for lots, ADR-085); extend to items, batches, orders, customers, suppliers, codes without prefix, last digits, typo tolerance |
| E. Owner's day | Home misses production orders to approve, unbilled shipments, overdue invoices, lots not put away, batches waiting for a checker | Home: **Decide · Late · Stuck** | Each line opens a pre-filtered list; expiry alerts grouped per day |

## 3. First-time-user freeze points (top 10 of 25)

1. Operator Home says "1 batch being made", My work says "No orders here" — batches without an order are unreachable.
2. Search refused words ("coconut", "Coconut Oil"). **Fixed (ADR-085).**
3. "Older screens" — meaningless. **Fixed: Management → Planning tools.**
4. Batch step: five equal green "Weigh …" buttons and "Complete step" active from the start.
5. "Resolve the items above first; the server re-checks when you submit."
6. Four equal buttons above the task (help, print, "Close the batch and paper pages").
7. My work shows drafts the operator cannot act on, with e-mail addresses.
8. Approved order: "Nothing to do on this order right now." with no reason or contact.
9. Stock list: expired lots at the top under "the lot to use next is at the top".
10. Counts that disagree (things waiting for QA: 6 / 9 / 11 on three screens; Home 2 vs 1 on hold).

## 4. Mockup gaps (brief Part III/IV)

| Mockup panel | Status | Closing change |
|---|---|---|
| Operator workspace ("Your tasks today", task cards with Start, "Production Step" with numbered sub-tasks and one Complete Step) | Partly | Task list on Home and My work; one highlighted next action on the step screen |
| Owner dashboard (Sales today · Production progress · Inventory alerts · Pending approvals; sales chart; top alerts; recent activity) | Partly | Four cards in that order, one sales chart, recent activity; one query per count |
| Inventory (Raw / WIP / Finished, one row per item with status chip, chips, Scan box "or enter code manually") | Partly | One row per item, instant chips, "Do not use" group, search box |
| Sales & customers (split view list + customer detail) | Partly | Split view, search, "+ New customer order" |
| Operations center (flow strip, current step + due) | Partly | Current step and due columns, recent activity |
| Top bar (5 destinations with icon + one-line description) | Partly → **done** for wide screens and the menu drawer |
| Reports (one chart, top products, three tiles) | Partly | Business overview as the Reports landing; no codes |

## 5. Plain words (rule)

Names first, codes small and grey after the name, never the first column, never needed for search. Keep
only six industry words and explain each once with "What is this?": **lot, batch, quality check, batch
record (BMR), INCI, version**. Everything else gets a plain label (e.g. allocation → "stock set aside",
disposition → "quality decision", posting → "saved to stock", reversal → "undo (kept on record)",
deviation → "problem report", routing → "steps for this product", quarantine → "waiting for check").
Renaming GMP step names, quality statuses or printed batch-record wording is configuration and needs the
owner's and QA's sign-off.

## 6. The spoon-feeding pattern (applied everywhere, in this order)

1. **Next step banner** under every title: one sentence + one green button; or "Waiting for Dino (manager)…" and no button.
2. **Task lists, not record lists**, on floor Homes: "verb + thing + where + [Start]".
3. **One search** that accepts any words.
4. **Numbered wizards** for multi-step tasks (new customer order, receive, plan a batch, count stock, finish batch).
5. **One line "This screen is for…"** under each title.
6. **"What is this?"** for the six kept words.
7. **Empty states that say what to do and who to ask.**
8. **One status vocabulary** and one query per count.
9. **"⋯ More"** for secondary actions (print, cancel, close, export, help).
10. **Who can help** with names and roles, never e-mail addresses, on floor screens.

## 7. Production floor screen

Planned in `docs/FLOOR_DISPLAY.md`: a TV page `/floor` (Making now · Next up · Waiting · Today), 30-second
refresh, read-only display account, no prices or customer names.

## 8. Decisions only the owner can make

| # | Decision | Recommendation |
|---|---|---|
| D1 | Who issues invoices? The owner role cannot today; the brief's staff list has no bookkeeper | Give the owner the finance rights, or appoint a bookkeeper user |
| D2 | Second-person weighing check at NFD: every line (`all`, today) or only critical lines (`marked`), and how the checker signs (name pick vs PIN) | `marked` + PIN for marked lines (saves ~4 taps per line and closes the name-pick gap) — needs QA/GMP sign-off |
| D3 | After every weighing line is checked, may the weighing step close itself without a second step-level check? | Yes, if the same checker confirmed every line — GMP sign-off |
| D4 | Pack verification by a second person for sealed full boxes | Keep for loose units and large orders; sealed full boxes verified by the loading scan |
| D5 | May QA release a material without an inspection record? | Per-material setting; default "inspection required" for critical materials |
| D6 | Approve-and-issue invoices in one step below an amount | Yes below an owner-set amount; password re-entry stays |

## 9. Delivery

| Wave | Content | Status |
|---|---|---|
| 0 | Plain-word lot search; "Older screens" retired; header in words; destination descriptions; floor-screen plan | Done (ADR-085) |
| 1 | Operator task list + one next action on the step screen; inventory by item + universal search; owner Home in mockup order with consistent counts; sales split view + search; floor screen MVP | In progress |
| 2 | Silent hand-offs fixed: production orders in To approve, QA told about deliveries, "To put away" after release, invoice draft at dispatch + "Not invoiced", payment prefill; on-page confirmations; count once at Finish; one-form QA tests | Next |
| 3 | Equipment and packaging on the step cards; wizards; "This screen is for…" + "What is this?" everywhere; help rewritten as five role guides | After owner decisions D2–D3 |

## 10. Possible defects to verify (from the process review)

1. Boxing may be blocked: "121 units still to box" while stock is 119 after 2 retained samples. **Confirmed and fixed**: the pack expected the batch output; it now expects the output minus samples (A-CR-02, `tests/integration/sales/boxing-after-samples.test.ts`).
2. A dispatched box still scans "At FG-01 · Released" (box location/status not updated at dispatch).
3. The lot-confirm keypad offers only A–F and "-" (fine for today's lot formats; breaks for other codes).
