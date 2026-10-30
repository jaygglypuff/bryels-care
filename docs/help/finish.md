---
key: production.finish
title: Finish a batch
version: 1
updated_at: 2026-10-30
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

When every step of the batch is done, you finish it. Finishing counts what was made and puts the batch in the hold area. Then QA checks it. You can only finish once, so count carefully.

## Open Finish

1. Open the production order. The big button says **Finish**.
2. The screen shows **Finish** and the batch number.
3. Finishing needs a connection. It does not work offline.

## Check what was made

1. If people wrote the good pieces and rejects in the daily log, you see them here. For example: "Good bars 118 (from 2 days in the log)" and "Rejects 3 (Soda ash 2, Cracked 1)".
2. If a number is wrong, press **Change** and type the right number.
3. If nothing was written in the daily log, type the **Good bars** and the **Rejects by type** now.
4. **Samples kept** is filled in for you (usually 2). These come out of the good bars. They are kept for QA and are not sold.
5. You see "Expected 123, made 118 (96 %)". If it says the number is outside the OK range, write **What happened?**. A problem report goes to QA.

## Count the wrappers

1. "Taken" is how many wrappers or labels were given out for this batch. You do not type it.
2. Count and type **Damaged** (spoiled, torn, wrong print) and **Left over** (clean ones you give back).
3. Wrappers used are the good bars plus the samples plus any reject that was already wrapped. Type rejects that were already wrapped under **More details**.
4. The line under the fields must show a tick, for example "125 taken = 120 used + 2 damaged + 3 left over ✓".
5. If it says "missing" or "too many", count again. Finish stays off until the numbers add up.

## Finish the batch

1. Check **Goes to**: the hold area. To choose another hold area, open **More details**.
2. If the screen asks **Checked by**, the second person picks their name.
3. Press **Finish batch** and confirm.
4. You go back to the order. It says the batch is finished and waiting for the quality check. The order status is now **Quality check**.

## Something is wrong

- **Finish one step first**: a step of the batch is not done yet. Go back to the order and do it.
- **The wrappers do not add up**: count again. If they still do not add up, report a problem on the batch page.
- **Pressed twice**: nothing happens twice. The batch is finished only once.
