# QA / GMP review of docs/production-flow-v2.md

Reviewer: QA and regulatory specialist, acting as a cosmetics GMP consultant (ISO 22716, ASEAN Cosmetic GMP,
FDA Philippines context). Date 2026-10-30. Read: the doc, ADR-073..079, and the current quality code
(`src/modules/quality/dispositions.ts`, `rules.ts`, `inspections.ts`, `src/lib/settings.ts`). No files edited.

I state GMP points below as practitioner judgement. They are not legal advice. Anything marked **[confirm]**
has to be checked by Bryel's own qualified GMP or regulatory person (see section 5).

---

## 1. Verdict

**Approve with changes.** The design keeps the controls that matter: a batch record built from the taps,
lot status checked at weighing and wrapping, tolerances, calibration, line checks at start and at packaging,
in-process checks, QA release before sale, deviations, and printed-packaging reconciliation. It also fixes
a real problem: today "Done" is shown before QA has decided. Simplifying staging, the line clearances, the
Finish forms and the close step is defensible for a one-room plant.

Before it is built, two things must change, and both are cheap:
- **B1.** Production and release must be independent. As the doc stands, the person who made a batch can release it.
- **B2.** The one-page "Check quality" screen clashes with an existing code rule that a tester may not release.

Five more points are required **before real production**, but they do not block the build: B3 and S1 to S4 below.

---

## 2. Findings

### Blockers

| # | Section | Problem | Why it matters | Fix (keeps it simple) |
|---|---|---|---|---|
| B1 | §1.2 G8, §2.1 step 10, §8 Q1 | The default is "owner passes with the audited override". The current release rule (`receiverIds`) only stops the person who **received / created** the lot and the person who **entered test results**. Whoever weighed, made or checked the batch can still release it. With the override on, the owner can make a batch and release it alone, and the only trace is an audit row. | ASEAN Cosmetic GMP and ISO 22716 expect production and quality responsibilities to be independent: the person who releases is not the person who made the batch. This is the one control an inspector will ask about. An audit row shows a self-release happened. It does not make the self-release acceptable. | (a) Add one release rule: **the releaser must not appear as executor or checker on any step, weighing or Finish of that batch** (`batch_executors` set; same blocker code `separation_of_duties`). (b) The owner may be the named QA releaser if the operators did the making. (c) The override may bypass (a) **only with a typed reason**. That release is then printed on the BMR as "Released by the person who made it: reason …" and counted on the owner dashboard. (d) For real production, `governance.owner_override` stays off, or the reason path stays rare (the A-GOV-OWNER decision). |
| B2 | §2.1 step 10, §6.2, Appendix A row 10 | "Check quality" asks one person to enter the tests and press Pass. The code refuses this: `lotDecisionBlocker` with `isTester`, and the inspection review in `inspections.ts:824-851` ("another QA user must review it"). With one QA person, the page cannot work without the override, so every release becomes an override. | An everyday override hides the exceptional ones. The audit trail loses its meaning. | GMP requires production ≠ release. It does not require tester ≠ releaser. Add the restricted setting `quality.release.tester_may_release`, scope org/site, needs approval. Default **true for new organizations, false (current behaviour) for existing ones.** B1 always applies. The BMR records "tested and released by the same person". |
| B3 (go-live) | §2.1 step 10, ADR-078 | Pass is the legal release of the batch, but the doc does not say how the releaser signs. Name-only signatures (ADR-078) are allowed on the shared tablet. | A release must be attributable to a specific person beyond doubt. A name picked on someone else's tablet is not that. | Pass, Hold and Fail always need the **releaser's own session plus password (or PIN) re-entry**, whatever `production.sign_off.require_password` says. This happens once per batch, so it costs nothing on the floor. As with all e-signatures, it must be validated by QA before the electronic record replaces the signed paper BMR. |

### Should-fix

| # | Section | Problem | Why | Fix |
|---|---|---|---|---|
| S1 | §2.1 step 5, G5, §8 Q2 | Marked (critical) weighings such as lye, preservative and fragrance are co-signed by picking a name. | For the lines that carry the safety risk, a name-only check proves nothing (A-SIGN-01). | For **marked lines only**, the checker enters their PIN/password. Other lines need no checker. The burden is small (about 3 to 5 lines per batch). Until PIN exists, use the password on marked lines. |
| S2 | §2.1 step 4, G4 | "Scale checked today" is a yes/no tick. | A daily scale check is only evidence if the reading is recorded. | The first use of a scale each day asks one field, "Check weight reads ___ g", against the check weight and limit QA has set. The result is valid for that scale for the day, and it is skipped for the rest of the day. One field, once a day. |
| S3 | §4.1 Appendix C, step 11 | The expiry example "4 Dec 2028" counts from the end of curing. The code setting `production.output.expiry_basis` defaults to `manufacture_date`, and the doc does not say what the manufacture date is for a soap cured for 4 to 6 weeks. The wrap label is printed before Finish creates the lot. | The expiry on the wrapper must equal the expiry on the lot and the BMR, and its basis is a labelling claim. | Fix **manufacture date = date of Mix and pour** (batch start), not the cure end. Settle the expiry at the step-8 label print from that same value, and have Finish reuse it, so there is a single source. The basis stays a setting needing approval, and the regulatory adviser confirms it. Correct the example. |
| S4 | §4.1, Appendix C step 7, step 9 | The wrapper arithmetic does not agree with itself. Used 120 = 118 good + 2 samples, yet 116 are "ready to sell", which takes the samples out of the 118. Rejects found **after** wrapping ("Bad wrapping", "Wrong batch code") use up wrappers but are not in the formula. | Reconciliation with tolerance 0 will fail on real data, or people will learn to fudge it. | Define once: **Used = good wrapped (including the samples) + rejected after wrapping.** Samples kept are taken **from** the good pieces (sellable = good − samples). Show "Taken = Used + Spoiled + Returned" on Finish with the live difference. Fix Appendix C (for example: taken 125 = used 120 [118 good incl. 2 samples + 2 wrapped rejects] + spoiled 2 + returned 3). |
| S5 | §4.1 Lye solution, §8 Q3 | "Usable after the maker's check, no QA pass": the maker would in effect release their own lot. G2 needs lots to be `released`. | Only authorized people move a lot to `released`, and requester ≠ approver. Lye concentration is a safety-critical attribute of the soap. | Lye solution lot: **both weighings checked (marked lines, S1)**. A **second person** who did not make it confirms label and quantity, and that confirmation sets `released` (QA permission or a designated "intermediate release" role). The lot also gets a **use-by** that QA sets. No lab test unless QA asks for one. Genealogy: soap batch → lye lot → NaOH lot (already follows from G1). |
| S6 | §2.1 step 10 "batch summary" | The summary lists "anything outside limits, open problems". It does not list overrides, approvals with shortage, voided or re-done weighings, corrections, early end of curing, or name-only signatures. | Reviewing the batch record before release has to show every departure from the normal path. | The Check quality page gets a fixed "**Exceptions in this batch**" box filled from the audit trail: overrides, CX approvals, voids, corrections, early cure end, name-only signatures, yield and reconciliation reasons. Pass needs one tick, "I reviewed the batch record", and the box must be read before Pass is enabled. |
| S7 | §3.2, §2.1 step 10 | A QA **Hold** is mapped like the normal wait. The owner cannot tell "waiting for tests" apart from "QA put it on hold". The table also has a typo: work order `in_process` should be `in_progress`. | Held stock that looks routine gets forgotten, and a review date is then missed. | Quality check, subtitle "**On hold, review by <date>**" in amber, when the lot is `on_hold`. It also goes in "Waiting for me" on the review date. Fix the typo. |
| S8 | §2.1 step 9, B1 | Finish can be done by the operator, which is right. But `lot.createdBy` becomes a "receiver", so only that operator is stopped from releasing, and the others who worked on the batch are not. | See B1. | B1's executor set covers it. Include Finish, weighing, checker and step actors. |
| S9 | §4.2 Lotion | Bulk may wait in a tank before filling, but no maximum hold time is set. | Microbial risk in water-based products. | Add a per-product field "Bulk must be filled within ___ h" (QA sets it, no default value). If filling starts later, a problem report is needed. Reuse the curing/hold step's `max` time. |
| S10 | §2.1 step 3 | A pick line may be ticked "not needed". | That must never remove the weighing line. | Say it explicitly: "not needed" only means "already in the room". The weighing card stays mandatory. |
| S11 | New, product master | No check of the FDA Philippines cosmetic product notification before sale. | Selling a product that has not been notified is a regulatory exposure. | Product field "FDA notification no. + valid until" (optional data entry). If it is blank or expired, Pass shows a **warning**, and so does the sales allocation. Whether it should **block** is for the regulatory adviser **[confirm]**. |

### Nice-to-have

| # | Section | Item |
|---|---|---|
| N1 | §2.1 step 4 | Add "Hair covered, clean work clothes, no jewellery" to the Start check. Personnel hygiene is part of GMP, and PPE alone does not cover it. |
| N2 | §4.1 Curing | Record the curing rack or shelf under More details, so bars can be found if a recall happens during curing. |
| N3 | §2.1 step 10 Fail | "Throw away": printed rejected bars are defaced or destroyed, with a quantity record. "Redo": a QA-approved rework instruction, and the reworked batch goes through Check quality again (existing `rework_approved`). |
| N4 | §2.1 step 4 | "All OK" is fine. Keep one row per item (already planned). Show the last product made on this line next to "No materials or labels from the last product". |
| N5 | §2.1 step 9 | Retained samples are taken from the final packed units (the doc implies this; say it). Store a location "Samples cabinet". |
| N6 | §4.1 soap tests | QA's soap spec should consider a free-alkali / pH check after curing as well as appearance and weight **[confirm]**. The system only makes it selectable. It does not set limits. |

---

## 3. Answers to the 8 open questions (decided)

| # | Decision | One-line reason |
|---|---|---|
| 1 | **The owner is the named QA releaser.** The owner may release only batches they did not weigh, make, check or finish (B1). Otherwise another trained person releases, or the owner records a typed override reason that is printed on the BMR. | Release must be independent of production. A small plant gets there by the owner not working on the batches they release. |
| 2 | **Marked lines only** (lye solution, NaOH and water in the lye order, preservative, fragrance, colour, extract), with **PIN/password** on those lines (S1). | The risk sits in a few lines. A real check on 3 to 5 lines is better than a name-tap on all of them. |
| 3 | **Made ahead as its own lot.** A second person confirms it, and that sets it to released (S5), with a QA-set use-by date. No lab test unless QA asks. | It matches the paper BMR, keeps genealogy clear, and still never lets the maker release their own lot. |
| 4 | **No numbers assumed.** Cut weight has no default and blocks the cut step until entered. Mould time and cure time are placeholders (1 day / 28 days) shown as "example – verify". | These are formulation and labelling claims (net weight) that the owner/QA must set. |
| 5 | **Just bring them** (ticks, no stock move). | Lot identity is checked at weighing. In one room, a transfer adds taps and no control. |
| 6 | **One per day** (shifts optional). | One shift. The official counts come from Finish anyway. |
| 7 | **Soap: 2 units. Lotion: enough for twice the full release test, at least 2 units. Keep until expiry + 1 year, in the sale pack, in a samples cabinet.** | Enough to re-test after a complaint. The period is common practice but must be confirmed **[confirm]**. |
| 8 | **Own statuses on the board, subtitles on the strip**, plus a distinct amber "On hold" (S7). | The owner wants to see where orders get stuck, and those are the two places. |

---

## 4. Controls: must stay on vs safely optional (small plant)

### Must stay on (not switchable, or switchable only in the sandbox)

| Control | Default |
|---|---|
| Batch record built automatically (G1); posted records immutable, correction = new entry with reason | Always |
| Lot status checked at weighing, packaging issue and wrapping (G2); held, rejected, expired or recalled lots blocked | Always |
| Right material/lot and tolerance at weighing; out of tolerance → approval + problem report (G3) | Always |
| Scale calibration status block; daily check-weight reading (S2) | Always |
| Start check and Before wrapping/filling check (G6) | On, operator-only (no checker) |
| Second-person check on **marked** weighing lines with PIN/password (G5, S1) | `marked` |
| Required in-process readings and limits once QA defines them (G7) | On |
| Finished lot into the hold area; **sellable only after Pass** (G8) | Always |
| Release by an authorized person not involved in making the batch (B1), with own-session password (B3) | Always; override only with a reason on the BMR |
| Exceptions box + "batch record reviewed" before Pass (S6) | Always |
| Pass blocked while a problem report is open | Always |
| Printed packaging reconciliation (wrappers, labels, printed boxes) | On, tolerance 0 |
| Batch number + expiry on every unit, single source (S3) | Always |
| Retained samples recorded at Finish | On, 2 (soap) |
| Yield range with reason when outside | On |
| Early end of curing/rest → approval + reason | Always |

### Safely optional (default off, or hidden)

| Control | Default | Condition |
|---|---|---|
| Stock move to the production area (`production.prepare.move_stock`) | Off | Turn on if the store room is in another building |
| Lot scanning at picking | Off | Weighing still checks the lot |
| Checker on the Start / Before wrapping checks | Off | On if QA wants it for allergen or colour changeovers |
| Second-person check on unmarked lines | Off (`marked`) | `all` if the consultant asks |
| Tare/gross, equipment choice per step | Hidden | |
| Separate close step | Merged into Pass | Closure checks unchanged |
| Two-person reopen | Kept, advanced | |
| Paper record scanning | Off | On while paper is still the official record |
| Tester ≠ releaser (B2) | Off for new orgs | On when there are two QA people |
| Downtime minutes, photos, shifts | Off / optional | |
| Approve with shortage, conditional release | Off | |

---

## 5. What a human GMP consultant / regulatory adviser must confirm before real production

1. Which GMP reference and edition FDA Philippines applies to Bryel's LTO (ASEAN Cosmetic GMP vs ISO 22716), and whether the owner may be the QA releaser (B1 arrangement, Q1).
2. Whether the electronic batch record and the e-signatures (B3, S1) can replace the signed paper BMR. This needs a short documented validation (user requirements, test of the flows, access control, audit trail review). Until then, the printed BMR is signed by hand.
3. Merging the weighing and production-area clearances into one Start check (A-PF2-03), given that weighing and mixing happen in one room.
4. The list of "marked" critical weighing lines per formula (Q2).
5. The lye solution intermediate: confirmation instead of QA test, the use-by period, and label content (Q3, S5).
6. Finished-product specifications and sampling: soap (appearance, weight, free alkali/pH?) and lotion (pH, viscosity, micro, preservative efficacy, before or after release). The system does not invent any of these.
7. The expiry/manufacture-date basis and label content under the ASEAN Cosmetic Directive: batch number, manufacture or expiry date, net content and how it allows for cure weight loss (S3, A-PF2-04).
8. Retained sample quantity and retention period (Q7, A-PF2-09).
9. Spoiled/returned printed packaging handling and the reconciliation tolerance (G12).
10. Bulk hold time for lotions and water quality (purified water as a raw material) (S9).
11. Whether a missing or expired product notification must block release or sale (S11).
12. Whether `governance.owner_override` may be on in real production at all (A-GOV-OWNER). Recommendation: off, or on with every use reviewed monthly by the consultant.

All times, temperatures, limits, tolerances, defect lists and sample counts in the doc and in this review are examples. They must be verified by authorized personnel before production use.
