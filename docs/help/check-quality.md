---
key: quality.check
title: Check quality of a finished batch
version: 3
updated_at: 2026-10-31
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

QA checks every finished batch before it can be sold. Everything is on one page. You choose **OK to use**, **Not yet** or **Not OK – don't use**.

## Find the batches

1. Open **Quality check** (tab bar) or **Quality → Batches waiting for QA check**. You can also press **Check quality** on a production order.
2. Each card shows the product first, then the batch number in grey and how many were made. **Not yet** means someone said "Not yet" before.
3. The green box **What to do next** opens the oldest batch. Or tap a card.

## Read the batch

1. **This batch** shows the good pieces, the rejects, the samples kept and how many will be ready to sell.
2. **Things that did not go as planned** lists a weighing or reading outside the limits, a waiting time ended early, a count corrected, an open problem report, an owner override. Read every line.
3. **⋯ More → Batch record (print)** opens the whole batch record if you need it.

## Enter the tests

1. Under **Tests (quality check)** you see the tests from the product's test list, with what counts as OK.
2. Type the results of all the tests you did, then press **Save results** once. Tests you leave empty stay open for later.
3. If one result is wrong (for example the wrong unit), nothing is saved: the screen marks that test in red. Fix it and press **Save results** again.
4. Saved tests show a green **OK** or a red **Not OK**.
5. If your company allows it, the person who entered the tests may also say OK. Otherwise another QA person does.

## Decide

1. **OK to use**: tick **I looked at the batch record and the things that did not go as planned**, then press **OK to use**. The page asks: press **Yes, OK to use** (or **Back**). The stock becomes ready to sell, the batch record is made and the batch closes by itself. When this was the last batch, the order becomes **Done**. The person who took the customer order is told.
2. **Not yet (check again later)**: write why and choose the day to check again. The batch shows **Not yet**. Come back on that day.
3. **Not OK – don't use**: write why, press **Not OK – don't use**, then **Yes, not OK**. The stock moves to the area for things we cannot use. If every batch of the order is not OK, the order shows **Failed**.

## Who may say OK

- You may never say OK to a batch you weighed, checked, made or finished. Another QA person must do it.
- The owner may do it only by writing why. The reason is printed on the batch record.
- You decide from your own sign-in. Nobody can decide for you by picking your name.

## Something is wrong

- **“OK to use” is not possible yet**: the page lists why, for example a missing test or an open problem report. Fix that first.
- **The batch stays open after OK**: a closing check failed (for example a paper page not reviewed). Open the batch record page and close it there.
