---
key: production.step
title: Do a step (Start check, Mix, Curing, Cut, Wrap)
version: 3
updated_at: 2026-10-31
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

Each step has its own screen: what to do, up to 3 things to write down, and one button.

## Start check

1. Answer every check with **Yes** or **No**.
2. If everything is fine, tap **All OK**. Every check is recorded as OK.
3. A **No** turns the row red. Write what you found and what you did. The step stops until it is fixed and answered again.

## Normal step (for example Mix and pour)

1. Read the instruction. Tap **See how** for the work instruction.
2. Fill in each field: tap the field, type on the keypad. Yes / No fields are two big buttons.
3. Tap **Step done**.
4. A value outside its OK range is kept and shown in red. The step stays open. Ask for approval with a reason, or do the step again and correct the value.
5. Changing a value you already saved asks why. The first value stays on record.

## Curing, resting, in the mould

1. When the step before is done, the wait starts by itself.
2. The screen shows "Curing until Fri 28 Nov" and the days left.
3. On the ready date the team gets a reminder. Open the batch and tap **Curing finished**.
4. Before the ready date the button is off. To end early, tap **Ask to end early**. QA or the site manager picks their name and writes the reason.

## Wrap and label

1. The screen shows the wrappers (and labels or boxes) you took at **Get materials**: their lot, shelf and how many. You do not scan them.
2. Look at the label on the screen: this is the **product label**, the one that goes on each bar (product name, lot number, made date, expiry, storage, and a square code). It has no QA status bar. Tap **Print N labels**, pick the label printer and **Actual size** in the print window, then tap **Yes, they printed**. Stick one label on each bar. Need more later? Print them again and say why. See [Labels](labels.md).
3. Wrap the bars. Type **How many did you use?** and **How many were spoiled?** on the keypad.
4. Tap **Step done**. The system records the wrapper lot for this batch. Left-over wrappers are counted at Finish.
5. If nothing was on the list, the screen asks you to scan or type the wrapper lot you used.

## After the last step

1. Tap **Go to Finish** to count the bars and send the batch for the quality check.
