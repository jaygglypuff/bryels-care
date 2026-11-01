---
key: production.finish
title: Finish a batch
version: 3
updated_at: 2026-11-01
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
5. You see "Expected 123, made 118 (96 %)". If it says the number is outside the OK range, or the rejects are more than allowed, the box **What happened?** appears right away. Write what happened (at least 10 characters). A problem report goes to QA.

## Count the wrappers

1. The card **Wrappers** says, for example: "We took 123 wrappers. You wrapped 120 bars." You do not type these.
2. Count the wrappers you did not use. Type **How many wrappers are left over?**
3. Type **How many were damaged?** (torn, spoiled, wrong print). If the wrapping step already wrote it, you see "Written at step 6: 2 damaged". Press **Change** only if it is wrong.
4. The line under the fields shows the sum, for example "123 taken = 120 wrapped + 2 damaged + 1 left over ✓".
5. "3 wrappers are missing": count the left-over ones again. If they are really gone, write what happened in **What happened?**. A problem report goes to QA.
6. "2 wrappers too many": count the left-over and damaged ones again. Finish stays off until it is right.
7. Rejects that were already wrapped used a wrapper too. Type them under **More details**.
8. Labels are not counted here. Box labels and piece labels are printed in their own card.
9. After Finish, a card says where the left-over wrappers go, for example "12 Soap wrapper 135 g go back to shelf PKG-01". Press **Put them back on the shelf**. It is done once.

## Boxes

1. If you printed box labels on the wrap step, Finish makes one box for each label, in the hold area, with its pieces.
2. The good bars minus the samples must be at least the bars in the boxes. If not, Finish says so: count again, or print the box labels again with the right number.
3. Bars not in a box stay loose in the hold area.
4. You can also print the box labels here, on the **Box labels** card.

## Finish the batch

1. Check **Goes to**: the hold area. To choose another hold area, open **More details**.
2. If the screen asks **Checked by**, the second person picks their name.
3. Press **Finish batch**. If something is missing, the screen lists it in red. Otherwise it asks: "You can't change the counts after this." Press **Yes, finish**, or **Back** to look again.
4. If the server refuses (for example the checker's password), the message shows and your choices stay filled in.
5. You go back to the order. It says the batch is finished and waiting for the quality check. The order status is now **Quality check**.

## Something is wrong

- **Finish one step first**: a step of the batch is not done yet. Go back to the order and do it.
- **The wrappers do not add up**: count again. Missing wrappers: write what happened. Too many: count again.
- **Pressed twice**: nothing happens twice. The batch is finished only once.
