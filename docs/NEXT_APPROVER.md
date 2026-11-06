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
| Record helpers | `procurementNextActors` (procurement), `adjustmentNextActors`, `countNextActors` (inventory), `floorCheckNext`, `productionOrderNext`, `batchQaNext` (production), `salesNextActors`, `packCheckNext` (sales), `settingChangeNext` (governance), `notifyRevisionApprovers` (master data), `notifyReviewNeeded` / `notifyReviewDone` (quality) | Read the record, then call `nextActors` with the same steps and excluded people as the module's "To approve" verdict or the deciding service. `nextActors` also takes an ad-hoc rule (`AdHocHandoff`), and `roleStandIn: false` keeps the step roles as configured. |

Sentences:

| Situation | Sentence |
|---|---|
| Others can act | "Next: Dino (site manager) approves it (step 1 of 2) — they will see it in To approve." |
| ADR-091 own record, top role | "You can approve this yourself because you are the owner." (+ "Dino (site manager) can do it too.") |
| Viewer can act | "You can check this weighing now. So can Jun (operator)." |
| Nobody yet | "Next: a site manager approves it. Nobody can do it yet: an administrator gives the role under Management › People & access › People who use the app." |

Role words: owner, site manager, operator, warehouse, QA, sales, finance, purchasing, planner, IT. A custom role uses its own name in lower case.

## Inventory of hand-offs

✓ = yes, ✗ = no, ~ = partly, n/a = there is no hand-off. "first → now" shows the state before ADR-109 and the state
after the second slice (2026-11-06). Every message is in-app, links to the exact record and is sent once per hand-off
(dedupe key).

| # | Hand-off | Who can act (rule) | Where they see it | Notified? first → now | Actor's success message names next? | Record names next? |
|---|---|---|---|---|---|---|
| 1 | Weighing check (second person) | `production.dispense_record.approve` at the batch site; never the weigher (owner included) | Home "Check a weighing" (also on orders assigned to someone else), Weigh screen | ✗ → ✓ once per batch weighing step | ✗ → ✓ Second check panel | ~ → ✓ |
| 2 | Step check / step sign-off | `production.process_step_record.approve`; never the person who did the step | Home "Check <step>", step screen | ✗ → ✓ | ✗ → ✓ | ✗ → ✓ step card |
| 3 | Start check (line clearance) | `production.line_clearance.approve`; never the person who answered | Home, first step screen | ✗ → ✓ | ✗ → ✓ | ✗ → ✓ step card |
| 4 | Weight outside the range | `production.over_tolerance_dispense.approve`; never the person weighing; they sign on the same tablet | Same tablet (co-sign) | n/a (same device, no waiting) | ~ → ✓ the approver picker plus a "Next:" line on "Other ways to weigh" | ~ → ✓ "If the weight is outside the range: Next: …" |
| 5 | Other material at weighing (QA) | `production.material_substitution.approve` at the site (QA) | To approve | ✓ | ✗ → ✓ | ✓ the weigh card names the QA people ("Waiting for QA (Nina) to say yes") |
| 6 | Production order approval | `production.work_order.approve`; the maker is excluded when `approvals.sod.work_order_release` is on; ADR-091 | To approve, order page | ✓; **new**: the assigned operator is told when the order is approved (C9 h) | n/a (opens the order page) | ~ → ✓ "Next step", with "You can approve this yourself…" |
| 7 | Batch QA decision | `quality.disposition.approve` at the site (QA) | Check quality | ✗ → ✓ once per batch, at Finish (C9 d) | ~ → ✓ "Batch finished" banner | ✗ → ✓ Check quality "Decision" card. On a QA pass, warehouse and sales get "<order> can now be set aside" (C9 e) |
| 8 | QA result correction (second QA) | `quality.disposition.approve`, never the QA person who asked | Check quality | ✓ | ✗ → ✓ | ✗ → ✓ on the waiting correction |
| 8b | Test results → second QA review → back to the tester | `quality.inspection.approve`, never anyone who entered a result | Check quality (batch or lot) | ✗ → ✓ when the results are complete; the tester is told the review outcome (C9 c) | n/a | ✓ (inspection "Review" panel) |
| 9 | Lot QA release (delivery) | `quality.disposition.approve` at the site (QA) | Check quality, the lot itself | ~ (one message, whole queue) → ✓ one message per lot, opening that lot (C9 b) | n/a (receiving) | ✓ QA lot page lists QA people by name (`WhoCanHelp`, QA-only permission). Its "Next" line belongs to C14 (other engineer) |
| 10 | Stock fix (step 1 any approver, step 2 owner); then posting | `inventory.adjustment.approve` and step roles as configured (no owner stand-in, as the service); never the maker or the step-1 approver; then `inventory.adjustment.post` | To approve, the fix | ✗ → ✓ at send and after step 1 (step 2 or posting) | ✗ → ✓ send and approve | ~ → ✓ waiting and approved |
| 11 | Count differences (step 1, owner step 2); then posting | `inventory.stock_count.approve` and step roles; never a counter; then `inventory.stock_count.post` | To approve, the count | ✗ → ✓ at submit and after step 1 | ✗ → ✓ submit and approve | ~ → ✓ |
| 12 | Purchase request | `procurement.purchase_request.approve` and step roles; never requester/creator/submitter or an earlier approver (ADR-091) | To approve | ✓ | ✗ → ✓ | ~ → ✓ |
| 13 | Purchase order (step 1 site manager, step 2 owner); sending; delivery coming | approve and step roles; then `procurement.purchase_order.post`; then the warehouse (`procurement.goods_receipt.create`) | To approve, order page, Receiving | ✓; **new**: "Delivery coming on 8 Nov: <supplier>" to the warehouse when sent (C9 a) | ✗ → ✓ | ~ → ✓ |
| 14 | Supplier return | `procurement.supplier_return.approve` and step roles | To approve | ✓ | ✗ → ✓ | ~ → ✓ |
| 15 | Quotation (price offer) | `sales.quote.approve` and step roles; creator/submitter excluded when `approvals.sod.quote` is on (ADR-091) | To approve | ✓ | ✗ → ✓ send and approve | ~ → ✓ |
| 16 | Customer order credit/approval | `sales.sales_order.approve` and step roles; same rule | To approve | ✓ | ✗ → ✓ step approve (send opens the order page, which names them) | ~ → ✓ |
| 17 | Price list | `sales.price_list.approve` and step roles; never its maker, sender or last editor (ADR-091: the owner may) | To approve | ✓ | ✗ → ✓ | ~ → ✓ |
| 18 | Customer requirement | `masterdata.customer_requirement.approve`; never the maker or sender (ADR-091 owner excepted) | To approve, customer page | ✗ → ✓ | ✗ → ✓ | ~ → ✓ on each waiting requirement |
| 19 | Expense claim | `finance.expense_claim.approve` and step roles; never the claimant (ADR-091) | To approve | ✓ | ✗ → ✓ send and approve; then who posts | ✓ → ✓ now with the same-person rule (`approvalNext`) |
| 20 | Invoice / bill / payment / credit approvals, then posting | `finance.*.approve` and step roles as configured; never creator/submitter or an earlier approver; posting `finance.*.post`, never an approver when the rules forbid it | To approve | ✓ | ✗ → ✓ send, approve, accept difference | ✓ → ✓ now with the same-person rule |
| 21 | Recipe / steps / how-to sheet / check plan revisions (QA, then manager) | step permission and roles; a QA step is independent; other steps follow ADR-091; never the maker, sender or an earlier approver | To approve, the version | ✗ → ✓ at send and after each step | ~ (page shows the next line after the reload) | ✓ → ✓ now with the same-person rule (`waitingForApprover`) |
| 22 | Settings change request | `platform.settings.approve` with the rule's roles (owner or a second administrator); owner-only settings: the owner; never the submitter | Management › Settings, "Waiting for OK" | ✗ → ✓ | ✗ → ✓ | ✗ → ✓ on each waiting change |
| 23 | Month reopen (period unlock) | second approver role (finance rules) | Finance › Periods | ✓ (existing) | ~ unchanged | ~ unchanged: not named in this slice |
| 24 | Label reprint | no approval step exists (reprints are audited, not approved) | — | n/a | n/a | n/a |
| 25 | Second check of the boxes (delivery or warehouse pack) | `inventory.pack.approve`; never the picker, a scanner or the packer (independent) | Packing, Home | ✗ → ✓ when the pick is complete (C9 f) or a pack is sent for checking; then the dispatcher is told when checked (C9 g) | n/a | ~ → ✓ packing page, pack page, order page |
| 26 | Delivery proof | dispatch, after delivery | Order page | ✓ (existing) | n/a | ~ unchanged |

### The older "Waiting for" helpers now use `nextActors`

| Helper | Used on | Same-person rule now |
|---|---|---|
| `waitingFor(ctx, permission, siteId, verb, fallback, { exclude, roleCodes, operational })` (`src/app/(app)/waiting-for.ts`) | drafts, posting steps and setup pages across the app | The viewer is never named. `exclude` leaves out the requester or approver, with ADR-091 when `operational`. Pages that pass no `exclude` (setup and maintenance waits) have no same-person rule. |
| `approvalNext` / `approvalWaiting` / `financeNext` (`src/app/(app)/finance/approval-waiting.ts`) | finance documents | creator and submitter (claimant on claims), earlier approvers, step roles as configured |
| `waitingForApprover(..., { exclude, prior })` (`src/app/(app)/masterdata/_eng/waiting.ts`) | recipe, steps, how-to sheet, check plan versions | maker and sender, earlier approvers; a QA step is independent |

### Live check 2026-11-06

- **QA lot page:** while a lot waits for QA, every viewer reads the QA people who decide ("Next: Nina (QA) or Teresa
  (QA) checks this lot and says OK or not OK — they will see it on Check quality"); a QA person who may decide reads
  "So can Teresa (QA)." under the "Decide now" step (`getLotDisposition().deciders`, `othersSentence`). The person who
  received the lot or entered its results is never listed (C14 unchanged).
- **Sent purchase order:** "Next: Lito (warehouse) or Dino (site manager) receives it when it arrives on 11 Nov — they
  will see it on Receive a delivery" (`procurementNextActors`, kind `delivery_coming`); the warehouse viewer reads
  "So can …" under "Receive the delivery".
- **Refusals** ("You don't have access") name the people who can DO the work: a `.view` permission is read as the
  entity's create, post, approve, edit or submit permission (`doingPermission`), so a sales person refused a QA check
  is pointed to QA, not to the owner, the planner and the manager who may only look.

### Open

- Row 23 (month reopen) and row 26 (delivery proof) still use their own words.
- The step "end early" approval form names approvers only in its picker.

## Tests

- `tests/unit/next-actors-words.test.ts`: names, role words, the 3-name limit, the step suffix, the ADR-091, viewer and "nobody yet" wording.
- `tests/integration/governance/next-actors.test.ts`:
  - Weighing check, with the notification sent once and the checker's Home task.
  - Start check.
  - Purchase order: step 1 the site manager, step 2 the owner, then who sends it and "Delivery coming" to the warehouse.
  - QA decision names QA only.
  - ADR-091 self-approval.
- `tests/integration/governance/next-actors-families.test.ts`:
  - Stock fix: neither the maker nor the other site is named, step 2 is the owner, the step-1 approver is not asked again, each message is sent once, then who saves it.
  - Count: the counter is never named and is never told.
  - Expense claim: the claimant is never named; `waitingFor` honours `exclude`.
  - Customer requirement: the sender is not named and the approvers are told once.
  - Owner-only setting: only the owner is named and told.
  - Recipe: QA is told first, never the maker; the QA approver and the maker are not asked at step 2; `waitingForApprover` leaves out the maker.
- `tests/integration/quality/w2-wiring.test.ts`: complete results tell the second QA person (not the tester); the review tells the tester.
- `tests/integration/inventory/receipt-qa-notify.test.ts`: one message per lot, opening the lot.
- `tests/integration/governance/live-check-names.test.ts`: the QA lot names its deciders for every viewer (never another
  site's QA; that person cannot open the lot), the sent order names who receives it and the date, refusals name doers.
