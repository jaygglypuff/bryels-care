# Who acts next: every hand-off names the next person

Owner, 2026-11-01: *"After weighing, who will need to approve? Next approver is not indicated. Every approval must
indicate who approves next."*

**Goal.** Wherever a record waits for another person, the screen of the person who just acted and the record page say
who is next, by name and role, and what they must do. The next people get a message with a link to the right screen.

> Saved. Next: Jun (operator) or Dino (site manager) checks this weighing — they will see it on their Home.

## How it works (engineers)

| Piece | File | What it does |
|---|---|---|
| Rules per hand-off | `src/modules/governance/next-actors.ts` (`HANDOFFS`) | One entry per kind with the permission the service checks, the words (`does` / `doBase`), where the next person sees it, and the same-person rule (`independent` or `operational`). |
| `nextActors(ctx, kind, record)` | same file | Lists active people in the organization who have a current assignment at the record's site (or organization-wide). Their role must hold the permission, and when the record has approval steps they must also hold one of the open step's roles (`approvalStepRecord` applies escalation). People in `excludeUserIds` and earlier-step approvers are left out. For **independent** kinds (floor checks, QA) they are always left out, the owner included. For **operational** kinds (ADR-091) they stay in the list only if they hold a top role at the site and `approvals.top_roles_self_approve` is on. The function also works out the viewer's own position and returns `NextActors`. It only gives a hint; the deciding service checks everything again. |
| `notifyNextActors(tx, ctx, kind, record, msg)` | same file | Sends one in-app message per person and dedupe key, inside the caller's transaction. The actor is never told about their own hand-off. Message kind is `handoff.<kind>`. |
| Words | `src/lib/next-actors-words.ts` | Client-safe. `nextActorsSentence`, `peopleWords` (first names and a role word, at most 3 names then "or 2 others", full names only when two first names are the same), `waitingForNames`. |
| UI | `src/ui/next-approver.tsx` `<NextApprover next inline?>` | Used in success messages (`ActionState.next`, shown by `FormMessage`), in the record's "What to do next"/"Waiting for" line (inline), and in the floor weigh and step cards. |
| Record helpers | `procurementNextActors` (procurement), `adjustmentNextActors` (inventory), `floorCheckNext`, `productionOrderNext`, `batchQaNext` (production) | Read the record, then call `nextActors` with the same steps and excluded people as the module's "To approve" verdict. |

Sentences:

| Situation | Sentence |
|---|---|
| Others can act | "Next: Dino (site manager) approves it (step 1 of 2) — they will see it in To approve." |
| ADR-091 own record, top role | "You can approve this yourself because you are the owner." (+ "Dino (site manager) can do it too.") |
| Viewer can act | "You can check this weighing now. So can Jun (operator)." |
| Nobody yet | "Next: a site manager approves it. Nobody can do it yet: an administrator gives the role under Management › People & access › People who use the app." |

Role words: owner, site manager, operator, warehouse, QA, sales, finance, purchasing, planner, IT. A custom role uses its own name in lower case.

## Inventory of hand-offs

✓ = yes, ✗ = no, ~ = partly. "before → after" means the state before and after this change.

| # | Hand-off | Who can act (rule) | Where they see it | Notified? before → after | Actor's success message names next? before → after | Record names next? before → after |
|---|---|---|---|---|---|---|
| 1 | Weighing check (second person) | `production.dispense_record.approve` at the batch site; never the weigher (owner included) | Home "Check a weighing" (now also on orders assigned to someone else), Weigh screen | ✗ → ✓ once per batch weighing step | ✗ ("Second check needed") → ✓ | ~ (name buttons only) → ✓ in the Second check panel |
| 2 | Step check / step sign-off | `production.process_step_record.approve` at the site; never the person who did the step | Home "Check <step>", step screen | ✗ → ✓ each time the step waits | ✗ ("Waiting for the second check") → ✓ | ✗ → ✓ on the step card |
| 3 | Start check (line clearance) | `production.line_clearance.approve`; never the person who answered | Home, first step screen | ✗ → ✓ | ✗ → ✓ | ✗ → ✓ on the step card |
| 4 | Out-of-range weighing approval | `production.over_tolerance_dispense.approve`, picks their name on the same tablet | Same tablet (co-sign) | n/a (same device, no waiting) | ~ (approver picker lists names) | ~ unchanged. Kind registered, not wired |
| 5 | Other material at weighing (QA) | `production.material_substitution.approve` at the site | To approve | ✓ (existing) | ✗ → ✓ | ✗ unchanged on the weigh card |
| 6 | Production order approval | `production.work_order.approve` at the site; the maker excluded when `approvals.sod.work_order_release` is on; ADR-091 top roles may approve their own | To approve, order page | ✓ (existing) | n/a (redirect to the order page) | ~ (WhoCanHelp by permission, no same-person rule) → ✓ on "Next step" with "You can approve this yourself…" |
| 7 | Batch QA decision | `quality.disposition.approve` at the site (QA) | Check quality | ✗ → ✓ once per batch, at Finish | ~ ("waiting for the quality check") → ✓ names on the "Batch finished" banner | ✗ unchanged on the batch record |
| 8 | QA result correction | `quality.disposition.approve`, another QA person | Check quality | ✓ (existing) | ✗ unchanged | ✗ unchanged. Kind registered |
| 9 | Lot QA release (receipt) | `quality.disposition.approve` | Check quality | ✓ (existing, receiving) | ✗ unchanged | ✗ unchanged. Kind registered |
| 10 | Stock adjustment (step 1 site manager, step 2 owner) | `inventory.adjustment.approve` and step roles; never the maker or the step-1 approver (ADR-091 top roles excepted) | To approve | ✗ → ✓ at send (step 1) | ✗ unchanged | ~ (fixed role words) → ✓ names |
| 11 | Count differences | `inventory.stock_count.approve` and step roles | To approve | ✗ unchanged | ✗ unchanged | ~ unchanged. Kind registered |
| 12 | Purchase request | `procurement.purchase_request.approve` and step roles; never the requester, creator, submitter or an earlier approver (ADR-091) | To approve | ✓ (existing, by role) | ✗ → ✓ (send and step approve) | ~ (everyone holding the permission, any step) → ✓ step roles |
| 13 | Purchase order (step 1 site manager, step 2 owner); then sending | `procurement.purchase_order.approve` and step roles; then `procurement.purchase_order.post` | To approve, order page | ✓ (existing, by role, both steps) | ✗ ("the next approver is notified") → ✓ names and step | ~ (permission only, owner shown at step 1) → ✓ step roles, also in "Saved and sent for approval" |
| 14 | Supplier return | `procurement.supplier_return.approve` and step roles | To approve | ✓ (existing) | ✗ → ✓ | ~ → ✓ |
| 15 | Quotation (price offer) | `sales.quote.approve` and step roles | To approve | ✓ (existing) | ✗ unchanged | ~ unchanged (sales `DoNext`). Kind registered |
| 16 | Customer order credit/approval | `sales.sales_order.approve` and step roles | To approve | ✓ (existing) | ✗ unchanged | ~ unchanged. Kind registered |
| 17 | Price list | `sales.price_list.approve` (owner) | To approve | ✓ (existing) | ✗ unchanged | ~ unchanged. Kind registered |
| 18 | Customer requirement | `masterdata.customer_requirement.approve` | To approve | ✗ unchanged | ✗ unchanged | ~ unchanged. Kind registered |
| 19 | Expense claim | `finance.expense_claim.approve` and step roles | To approve | ✓ (existing `notifyNextStep`) | ✗ unchanged | ✓ (existing `approvalWaiting`, names by step role, no same-person filter) |
| 20 | Invoice / bill / payment / credit approvals | `finance.*.approve` and step roles; poster ≠ approver | To approve | ✓ (existing) | ✗ unchanged | ✓ (existing `approvalWaiting` / `waitingFor`) |
| 21 | Recipe / steps / how-to sheet / check plan revisions (QA, then manager) | `masterdata.formula.approve`, `masterdata.routing.approve`, `masterdata.work_instruction.approve`, `quality.inspection_plan.approve` and step roles | To approve | ✗ unchanged | ✗ unchanged | ✓ (existing `waitingForApprover`, names by step role) |
| 22 | Settings change requests | `platform.settings.approve` (owner for restricted keys) | To approve | ✗ unchanged | ✗ unchanged | ✗ unchanged. Kind registered |
| 23 | Reopen requests (month unlock) | second approver role | Finance › Periods | ✓ (existing) | ✗ unchanged | ✗ unchanged |
| 24 | Label reprint | no approval step in the code today (reprints are audited, not approved) | — | n/a | n/a | n/a |
| 25 | Second check of a box (packing) | `inventory.pack.approve`, not the packer | Packing | ✗ unchanged | ✗ unchanged | ~ unchanged. Kind registered |
| 26 | Delivery proof | sales/warehouse, after delivery | Order page | ✓ (existing) | n/a | ~ unchanged |

### Still to do (next slice)

Wire `nextActors` into rows 4, 5 (record), 7 (batch record), 8, 9, 11, 15 to 18, 22, 25, and the finance and master-data
success messages. The older helpers (`waitingFor`, `approvalWaiting`, `waitingForApprover`) list names by permission and
role but do not apply the same-person rule. Move them onto `nextActors` so a requester is never named as their own
approver (except under ADR-091). Notify on rows 11, 18, 21, 22 and 25.

## Tests

- `tests/unit/next-actors-words.test.ts`: names, role words, the 3-name limit and "or N others", the step suffix, ADR-091 wording, viewer wording and the "nobody yet" wording.
- `tests/integration/governance/next-actors.test.ts`:
  - Weighing check: the weigher and people at the other site are never named. The checker is notified once across two weighings and sees "Check" on Home.
  - Start check: the checkers are notified, the person who answered is not.
  - Purchase order: step 1 names the site manager only, step 2 names the owner only, and the step-1 approver cannot decide step 2.
  - QA decision: only QA people are named.
  - ADR-091: the site manager's own production order reads "You can approve this yourself because you are the site manager.", and a planner's order names the approvers but not the planner.
