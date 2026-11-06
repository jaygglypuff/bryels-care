# Archive: superseded planning documents

These documents planned the UX redesign of October 2026. The plan was built, and the decisions that
came out of it are recorded in `docs/decision-log.md`. They were moved here on 2026-11-06 by ADR-115 §5
(repository clean-up) so the top of `docs/` shows only documents that describe the app as it is.

Do not use them as the description of the current app. Read the ADRs named below instead.

| Document | What it was | Built as / replaced by |
|---|---|---|
| `UX_AUDIT.md` | The first UX audit of the app against Part II §2 of the brief (31 findings) | ADR-081 to ADR-083; later audits in `docs/ux-audit/` (ADR-098 and later) |
| `WORKFLOW_ARCHITECTURE.md` | The connected pipeline and the Operations Center proposal | ADR-081, ADR-082; the chain from purchase to invoice is now ADR-106 and ADR-110 (`docs/END_TO_END_FLOW.md`) |
| `OPERATOR_EXPERIENCE.md` | The operator's menu, My work and the step screens | ADR-081, ADR-082, ADR-083; the production flow v2 (ADR-080, ADR-100, ADR-104 to ADR-106) |
| `OWNER_EXPERIENCE.md` | The owner's Home, Operations Center and Management landing | ADR-081, ADR-083; role Homes changed by ADR-114 |
| `REDESIGN_IMPLEMENTATION_PLAN.md` | The phased plan R1 to R5 of the redesign | ADR-081 (R1), ADR-082 (R2–R3), ADR-083 (R5); later rounds ADR-088 to ADR-114 |

Still current (not archived): `docs/NEW_NAVIGATION.md` (the five destinations, ADR-081) and
`docs/production-flow-v2.md` (ADR-080, built).

Also removed by ADR-115 §5 (not archived): the 12 screenshots of the full demo in `docs/demo/` (23 Oct
2026). They showed screens that no longer exist. `docs/demo-script.md` describes the current demo.
