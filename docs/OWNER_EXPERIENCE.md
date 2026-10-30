# Owner and management experience

| | |
|---|---|
| Status | R1 built: "Right now" pipeline on Home, Operations Center, Management landing |
| Read with | `docs/analytics-kpis.md`, ADR-081, `docs/WORKFLOW_ARCHITECTURE.md` |

## 1. The five questions (brief Part II §8) and where they are answered

| Question | Answer on screen |
|---|---|
| What is happening? | Home → "Right now": the nine pipeline stages with live counts (same scope as the page) |
| What needs attention? | Amber line under a stage (late, on hold, expiring); To approve badge; QA badge; overview exceptions |
| What is delayed? | "past the expected date" (POs), "late to start" (batches), "past the requested date" (orders) |
| How is the business doing? | The existing KPI overview below (sales, output, inventory, QA, OTIF; each number opens its records; estimates labelled) |
| What decision is needed? | To approve (top bar, count) |

## 2. Rules

- Every number is a live query over posted records or a labelled KPI snapshot; nothing illustrative.
- Site filter: current site or "All my sites" only for users with more than one site; enforced in the
  read model (`resolveScope` → `requireSite`), not by hiding UI.
- A stage or tile appears only if the user holds that module's view permission.
- Advanced analytics (dashboards, trends, report library, KPI definitions) live in Management → Reports &
  analytics, away from daily operations.

## 3. Operations Center (`/operations`)

Pipeline cards (tap = the list behind the number; the amber line opens the exceptions), the active
batches table (phone: one card per batch) with step progress, and quick links (scan, receive, new
production order, quality check, new customer order, traceability) filtered by permission. The page
has its own error state (`operations/error.tsx`; loading feedback is the navigation progress bar, ADR-043); an empty state explains
when a role has no stage.

## 4. Next (R2)

- Owner overview batch cards should open the production order hub instead of the full batch record
  (UX-09).
- Trim the overview below "Right now" to the KPIs the owner uses; move the rest to Reports & analytics
  (UX-07, UX-14) — decide with the owner after a week of use.
