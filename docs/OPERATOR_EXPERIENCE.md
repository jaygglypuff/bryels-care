# Operator experience

| | |
|---|---|
| Status | R1 built: focused menu and tab bar. R3 built: assigned orders, "My work", "Your next task" (ADR-082). Operator UX review fixes built: "Your tasks today" task list, step screen focus (§5) |
| Read with | ADR-080 (production order flow), `docs/reviews/production-flow-v2-ux-review.md`, ADR-081 |

## 1. What an operator sees after R1

- **Destinations:** Home, Operations, Inventory only (no Management, no Sales & Customers).
- **Tab bar (phone / iPad portrait):** Home · My work · Today · Scan · Menu.
- **Operations tabs:** Operations Center (only the stages their permissions allow), My work, Today.
  The old detailed screens stay under Advanced for supervisors' habits; operators never need them.
- **Home:** the existing task tiles (receive, scan, batches being made, QA, dispatch), each with a live
  count and a large touch target.

Warehouse operators get their own persona: Home · Receive · Scan · Inventory · Menu.

## 2. Guided step workspace (already built in ADR-080, unchanged)

Production order hub → one big next-action button (Get materials, Start, Weigh, the step name, Finish,
Check quality). Weigh card: lot preselected and confirmed by its last 4 characters, scale reading,
tolerance shown, optional second-person check. Step card: at most three fields, "Step done" saves and
completes in one command and starts the next wait. When the operator lacks permission the button becomes
"Waiting for …" with who can help. This is the brief's "guided task workspace" (Part II §6; mockup
"Production Step").

## 3. Validation and feedback

Each command returns a plain message saying what is missing (e.g. "Confirm the lot: type the last 4
characters on the container"). Out-of-range values are kept and flagged, never silently accepted.
Offline-capable commands (counting, weighing) queue with an idempotency key and show the sync chip state.

## 4. Assigned work (built in R3, ADR-082)

1. **Assignment.** The planner or site manager picks "Who makes it" on the production order (only people
   who record production at that site are offered); the person gets a notification. Unassigned orders are
   open for anyone. Assignment never blocks recording: anyone allowed may still do a step.
2. **My work** shows my orders first, then unassigned ones; "Everyone's" shows the rest of the site.
3. **"Your next task"** on the operator Home: replaced by "Your tasks today" (§5), whose first card is that task.
4. **Next: words.** Apply the ADR-080 word list to the operator tiles (no "quarantine", "disposition", "FEFO" on
   operator screens; UX-17, UX-18).

## 5. Operator UX review fixes ("operators freeze")

| # | Screen | Built |
|---|---|---|
| 1 | Task list read model | `myFloorTasks(ctx)` (`src/modules/production/floor-tasks.ts`): one task per batch at the current site in materials_staged, in_process, rework_approved, or planned (approved order, or an older batch without an order). Batches of orders assigned to someone else are left out (`work_orders.assigned_operator_id`); mine first, then canDo, then the furthest along. Verb + thing, product, batch, "Step x of y · …", percent, ONE href (`batchNextAction`: order screens when the batch has an order, else the batch page) and whether the user may do it at the site; if not, "Waiting for <first names or role>", never e-mail addresses. Needs `production.batch.view`. |
| 2 | Home (operators who make: batch view + weigh or daily log) | "Your tasks today": greeting, three counts (Batches for you, Weighing, Waiting), task cards with one big green Start / Continue, quick actions (Scan or search, Daily count, other role tiles). Empty: "Nothing for you right now. Your supervisor plans the next batch." Warehouse and QA operators keep the task tiles. |
| 3 | My work | "To do now" task cards first; drafts (orders waiting for approval) hidden from operators; the filter chips behind "Show more filters". |
| 3 | Who can do this | `WhoCanHelp hideEmails` on floor screens (order screens, Finish, Check quality); names and roles only. |
| 4 | Batch step screen | Only the first ingredient still to weigh is green and numbered "1."; the others are secondary with "Next" / "Later". "Complete step N" is disabled with the plain reason ("Weigh all 5 ingredients first (3 still to weigh).") until ready; the server still validates. One "? How to do this step"; the other help, print and close links under "⋯ More". A user who cannot do the step reads "<names or roles> can do this step. You can follow progress here." Ingredient lines show names, not codes. Facts under "Details": "Recipe: <name> (version n)", "Expected output". |
| 5 | Approved order without a batch | "This order is approved but no batch is planned yet. Ask <planner, else supervisor, else approver> to plan it." (a user with `production.batch.create` gets "Plan the batch"); "What happened today?" is hidden until a batch has started. |

Tests: `tests/integration/production/floor-tasks.test.ts` (batch without an order listed; someone else's order not listed; cross-site; forbidden without `production.batch.view`; waiting words without e-mail).
