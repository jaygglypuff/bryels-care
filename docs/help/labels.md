---
key: inventory.labels
title: Print and scan labels
version: 1
updated_at: 2026-10-31
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

You print a label where you do the work. There is no label desk to go to.

## Which label goes where

- **Sack label**: print it on the delivery (**Print labels**). Stick one on each sack, drum or tub that came in. It is scanned at put-away and when you take the sack for a batch.
- **Product label**: print it on the batch's packaging step. Stick one on each bar or jar. It is scanned at boxing or on the Scan screen.
- **Box label**: print it on the box (**Print box label**). Stick it on the side of the box. It is scanned when you move, pick or ship the box.
- **Shelf label**: print it on the shelf (**⋯ More › Print a label**). Stick it on the front edge of the shelf. It is scanned at put-away to say where the stock goes.
- **Lot label again**: print it on the lot (**⋯ More › Print a label**) when a label is lost, or when the QA status changed.

The product label (on a bar) is not the lot label (on a sack or a big box). The product label has no QA status bar and no amount. The lot label shows the QA status at the time it was printed.

## Print labels

1. Look at the label on the screen. It is the real size, and it is exactly what will come out.
2. Read the sentence under it, for example "Stick one on each sack or drum."
3. **How many?** Type the number, or tap **−** and **+**. It starts at a good number (one per sack, one per bar).
4. Tap the green **Print N labels**.
5. The print window opens. Pick the label printer (its name is on the screen) and **Actual size** (not "Fit to page").
6. Print. Then tap **Yes, they printed**. If they came out wrong, tap **No, print again**.

To keep a copy as a file, pick **Save as PDF** in the print window. The PDF looks exactly like the screen: one label per page, each page the size of the label.

## The same label again

1. A label with the same words is printed once. If it is lost or damaged, the screen asks **Why print again?**.
2. Pick a reason, type how many, and print. The system keeps the reason, who printed it and when.
3. If the lot's QA status changed (for example from waiting to OK), print a **new** label and throw the old one away.

## Scan a label

1. Every label has a square code (some shelf labels have a striped code).
2. Point the phone's Scan screen at it, or use the handheld scanner.
3. It opens the lot, the box, the shelf or the batch. A bar's label scanned before the batch is finished opens the batch; after Finish it opens the lot.

## Labels printed

**Labels printed** lists every label of your site, newest first. Open one to see it, or to print it again with a reason.

## Something is wrong

- "Label printing is not set up": ask the administrator (**Settings › Labels and printouts**).
- "No label is approved for this yet": ask QA. QA must say OK to a label before it can print.
- The label is cut off or too small: in the print window choose **Actual size** and the label paper size.
