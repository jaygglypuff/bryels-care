---
key: production.weigh
title: Weigh the ingredients (Weigh screen)
version: 2
updated_at: 2026-10-31
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

The Weigh screen shows one card per ingredient, in formula order. The card shows the target, the OK range and the lot to use.

## Weigh one ingredient

1. Check the lot number on the card. Take that container.
2. Tap **Scan the lot label** and point the camera (or the scanner) at the label on the container. The card says **Label scanned: lot …**. If the label is damaged, tap **Label damaged? Type the last 4 characters instead**.
3. Weigh. Type the weight in grams on the keypad.
4. The card shows **OK**, or "Too much by …" / "Too little by …".
5. Tap **Save** (the big ✓ key on the keypad, or the button under the weight).
6. The next ingredient opens by itself.

## Wrong lot

1. If the label does not match, the card says so and shows the right lot. Take the right container. Scanning the label of another set-aside lot of the same ingredient switches the card to that lot.
2. A lot that was not set aside for this order is refused.
3. To use another lot, ask QA.

## Too much or too little

1. Tap **Weigh again** and correct the amount.
2. If you cannot fix it, tap **Ask for approval**: the screen **Other ways to weigh** opens for this ingredient. The approver picks their name and writes the reason; a problem report is opened. Never save a weight you did not read from the scale.
3. **Other ways to weigh** (under More details on the card) is also for weighing in a container (container weight), taking part from a second lot, and undoing a wrong weighing with a reason.

## Second check

1. A card with the chip **Second check** needs a second person.
2. After **Save**, ask someone to watch. They tap their own name.
3. The next screen asks them: "You watched … of …, lot …?" They tap **Yes, I checked**.
4. The checker can also confirm on their own phone: their Home shows **Check a weighing**; on the Weigh screen they tap **Yes, I checked it** (signed with their own account).
5. You can never check your own weighing.

## When every ingredient is weighed

1. The screen shows "5 of 5 weighed" and the total.
2. Tap **Step done**. Then go to the next step.
