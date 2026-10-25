---
key: quality.release
title: QA release or rejection
version: 1
updated_at: 2026-10-25
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

Only QA decides whether a lot or batch is released, rejected or held. Stock cannot be used or shipped until it is released.

## Find what is waiting

1. Open **QA queue**. It lists material lots in quarantine and batches awaiting QC at your site.
2. Open the lot (**Lot decision**) or the batch (**Batch release**).

## Check the evidence

1. Inspections and test results from the approved inspection plan are listed. A result is reviewed by a second QA user before it counts.
2. To add a result, use **Record test result** with the **Specification** as written in the approved specification.
3. For a batch, open the BMR with **Open BMR** and check the batch record.
4. **Release is blocked**: the screen lists why, for example a missing result, an open deviation or an unclosed batch record. Release only after these are resolved.

## Decide

1. Choose **Release batch** or **Reject batch** (for a lot, the matching choice).
2. Enter the **Reason (required)**. It is recorded with your name and the time, and decisions are never edited.
3. On release, stock moves from quarantine to storage. On rejection, it moves to the rejected-goods location.

## Something is wrong

1. Use **Raise deviation** from the batch or lot.
2. A lot can be put on QA hold from the deviation with **Place containment hold**.
