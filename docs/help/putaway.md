---
key: inventory.putaway
title: Put away a received lot
version: 1
updated_at: 2026-10-25
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

Move goods from the receiving area to the location they belong in. Use it after receiving, or when QA tells you where a released lot goes.

## Scan the lot

1. Open **Put away** and scan the lot label on the container. You can also type the lot number.
2. The card shows the lot, its QA status and where it is now.
3. **No stock to put away**: the lot has nothing on hand at this site. Check the label.

## From and quantity

1. If the lot is in more than one place, choose **From**.
2. Leave **Quantity** empty to move everything from that location, or enter a part.

## Scan the destination

1. Scan the location label where you put the goods. The screen lists the locations allowed for this QA status under **Allowed now**.
2. Quarantine stock can only go to quarantine locations. Released stock goes to storage.
3. **No allowed location**: there is no open location of the right type. Tell your site manager.

## Confirm

1. Press **Put away** once.
2. Pressing it twice does not move the goods twice.
3. If you made a mistake, use **Undo** on the move screen within the time shown. After that, ask a site manager to reverse it.
