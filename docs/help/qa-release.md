---
key: quality.release
title: QA decision (OK to use or not OK)
version: 4
updated_at: 2026-11-06
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

Only QA decides whether a lot or batch is **OK to use**, **not OK – don't use**, or **stopped by QA**. Stock cannot be used or shipped until it is OK to use.

## Find what is waiting

1. Open **Operations → Check a batch or delivery**. The green box at the top opens the oldest batch or delivery waiting for a QA check at your site (**Check this batch** or **Check this delivery**).
2. The lists show the material or product first; the lot or batch number is small and grey.

## Check the evidence

1. The **Quality check (tests)** box shows the tests from the approved test list. A second QA person checks the results before they count.
2. To add a result by hand on a batch, open **Type a test result by hand** and write **What it should be** as written in the approved specification.
3. For a batch, **⋯ More → Batch record (print)** opens the batch record.
4. **“OK to use” is not possible yet**: the screen lists why, for example a missing result, an open problem report or an unclosed batch record. Decide only after these are fixed.

## Decide

1. Choose **OK to use** or **Not OK – don't use** (for a lot that QA stopped: **OK to use again**; to stop it: **Stop it (QA hold)**).
2. Write **Why? (required)**. It is saved with your name and the time, and decisions are never changed afterwards.
3. When it is OK, stock moves from the hold area to storage. When it is not OK, it moves to the area for things we cannot use.

## Something is wrong

1. Use **⋯ More → Report a problem** on the batch or lot.
2. On the problem report, **Stop a lot while QA looks into it** stops the lot.

## Sample first

1. On the check of a new lot, record the sample first: how much you took and from where.
2. Then type the results. Without a sample, the results cannot be saved.
3. You can add another sample while the check is open, also after all results are in.
