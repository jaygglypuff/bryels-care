# Redesign implementation plan (brief Part II §17)

| | |
|---|---|
| Status | R1 delivered on branch `claude/optimistic-dijkstra-py0bf2`; R2–R5 proposed |
| Rules | Existing app, no rewrite; URLs kept; no destructive migration; tests first; docs in the same change |

## Phases

| Phase | Content | Status |
|---|---|---|
| Audit (brief phase 1) | `docs/UX_AUDIT.md`: 31 findings with evidence | Done |
| Information architecture (2) | `docs/NEW_NAVIGATION.md`, `docs/WORKFLOW_ARCHITECTURE.md` | Done |
| **R1 — navigation, Operations Center, stock by type** (3–4) | Five destinations; section menus; role tab bars; rail removed; `/operations`; Home "Right now"; Inventory tabs Raw/WIP/Finished; `/inventory/wip`; `/management`; app-wide error page; help and messages renamed | **Done** (ADR-081) |
| R2 — owner polish | Overview links to order hub (UX-09) ✓; "To approve" only for approvers (UX-06, UX-29) ✓; trim overview and labels = page titles (UX-19) next | Partly done (ADR-082) |
| R3 — operator and record layout | Assignee on production orders ✓ (migration 0029, additive); "Your next task" on Home ✓; shared record header on PO, receipt, sales order, shipment ✓ (UX-21); words (UX-17/18) next | Done except words (ADR-082) |
| R4 — connected workflows | "Journey" panel per record (UX-22); receiving flow opens inspection then put-away in sequence (UX-03); fulfilment under one URL area with redirects (UX-04) | Proposed |
| R5 — layout, usability test and deployment | Usability test with a non-technical owner, operator and warehouse helper (`docs/USABILITY_TEST.md`); automatic layout check of 167 screens × 4 sizes × 3 roles (no sideways scroll, no errors); fixes in ADR-083; deploy to the Railway branch | Done except the "still open" items in the usability test and the e2e run on the deployed demo |

## R1 affected files

- Navigation: `src/app/(app)/nav.ts`, `src/app/(app)/shell.tsx`, `src/app/(app)/layout.tsx`
- New pages: `src/app/(app)/operations/{page,error}.tsx`, `src/app/(app)/management/page.tsx`,
  `src/app/(app)/inventory/wip/page.tsx`, `src/app/(app)/error.tsx`
- Read model: `src/modules/analytics/operations-center.ts` (exported from `src/modules/analytics/index.ts`)
- UI: `src/ui/pipeline.tsx`, `src/ui/inventory/stock-tabs.tsx`; `/inventory` header and tabs; Home pipeline
- Words: help guides in `docs/help/`, setup messages naming menu paths
- Tests: `tests/unit/nav-per-role.test.ts`, `tests/integration/analytics/operations-center.test.ts`,
  `tests/e2e/demo-rehearsal.cjs` (shell section)

## Deployment notes (R1)

- **No migration, no new environment variable, no new permission.** Railway redeploys on push as before.
- Rollback: redeploy the previous commit; no data changed.
- After deploy, sign in as owner, operator and warehouse demo users and check: five pills (or the tab bar
  on a phone), `/operations` counts, `/inventory?kind=material`, `/inventory/wip`, `/management`.

## Risks

| Risk | Mitigation |
|---|---|
| Users used to the old menu cannot find a screen | URLs unchanged; "Where things moved" table in `NEW_NAVIGATION.md`; help guides updated |
| Pipeline queries slow at volume | Each stage is one grouped query on indexed `(site_id, status)` columns; checked against the load-test volumes in R5 |
| Operators lose a reference page they used | Access unchanged; page still opens by link; add back to their menu on request |
| "My work" still not assigned | Documented (A-UX-05); R3 |
