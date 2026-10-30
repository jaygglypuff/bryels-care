# Operator experience

| | |
|---|---|
| Status | R1 built: focused menu and tab bar. R3 built: assigned orders, "My work", "Your next task" (ADR-082) |
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
3. **"Your next task"** on the operator Home: the first of those orders with a step to do, one big button.
4. **Next: words.** Apply the ADR-080 word list to the operator tiles (no "quarantine", "disposition", "FEFO" on
   operator screens; UX-17, UX-18).
