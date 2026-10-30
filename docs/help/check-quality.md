---
key: quality.check
title: Check quality of a finished batch
version: 2
updated_at: 2026-10-30
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

QA checks every finished batch before it can be sold. Everything is on one page. You choose **Pass**, **Not yet** or **Fail**.

## Find the batches

1. Open **Quality check** (tab bar) or **Quality → Waiting for check**. You can also press **Check quality** on a production order.
2. Each card shows the product, the batch number and how many were made. **On hold** means someone said "Not yet" before.
3. Tap a card to open **Check quality**.

## Read the batch

1. **This batch** shows the good pieces, the rejects, the samples kept and how many will be ready to sell.
2. **Exceptions in this batch** lists everything that did not go the normal way: a weighing or reading outside the limits, a waiting time ended early, a count corrected, an open problem report, an owner override. Read every line.
3. Open **Batch record** to read the whole record if you need to.

## Enter the tests

1. Under **Tests** you see the tests from the product's test list, with the OK range.
2. Type the results of all the tests you did, then press **Save results** once. Tests you leave empty stay open for later.
3. If one result is wrong (for example the wrong unit), nothing is saved: the screen marks that test in red. Fix it and press **Save results** again.
4. Saved tests show a green **OK** or a red **Not OK**.
5. If your company allows it, the person who entered the tests may also pass the batch. Otherwise another QA person passes it.

## Decide

1. **Pass**: tick **I reviewed the batch record and the exceptions above**, then press **Pass**. The page asks "Pass this batch?": press **Yes, pass** (or **Back**). The stock becomes ready to sell, the batch record is made and the batch closes by itself. When this was the last batch, the order becomes **Done**. The person who took the customer order is told.
2. **Not yet**: write why and choose the day to check again. The batch shows **Quality check · On hold**. Come back on that day.
3. **Fail**: write why, press **Fail**, then **Yes, fail**. The stock moves to the rejected area. If every batch of the order failed, the order shows **Failed**.

## Who may pass

- You may never pass a batch you weighed, checked, made or finished. Another QA person must do it.
- The owner may pass it only by writing why. The reason is printed on the batch record.
- You decide from your own sign-in. Nobody can pass a batch for you by picking your name.

## Something is wrong

- **Pass is not possible yet**: the page lists why, for example a missing test or an open problem report. Fix that first.
- **The batch stays open after Pass**: a closing check failed (for example a paper page not reviewed). Open the batch record page and close it there.
