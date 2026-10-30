---
key: production.production_order
title: Make a product with a production order
version: 1
updated_at: 2026-10-30
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

A production order says what to make, how much and when. You follow it from start to finish on one page. Its status is always one of: **Draft**, **Approved**, **In progress**, **Done** or **Cancelled**.

## Create the order

1. Open **Production orders** and press **New production order**.
2. Choose **What to make**. Check **How much (kg per batch)** and the **Start date**.
3. Only if you need them, open **More details**: number of batches (usually 1), finish date, production line, notes.
4. Press **Create production order**. It is now a **Draft**.

## Approve

1. A manager opens the order and presses **Approve**.
2. Approving sets the materials aside and creates the batch. You do not create batches yourself.
3. If materials are missing, nothing changes and the message says which material and how much is missing. Receive the stock, then press **Approve** again.
4. The person who created the order cannot approve it. Another person who can approve must do it.

## Start and finish

1. The big button on the order always shows the next step.
2. **Start** opens the screen to bring the materials to the line, then the line check.
3. **Finish** opens the batch to record the last steps and the output. After the quality check, **Finish** closes the batch record.
4. When every batch is finished the order is **Done**.

## Daily log: what happened today

1. Open the order. On the **Today** tab fill in **What happened?**, **Good pieces made** and the **Defects** by type.
2. Press **Save to daily log**. You can add more entries during the day.
3. Made a mistake? Open **Daily log**, press **Correct this entry**, fix the numbers and say why. The old entry stays visible and no longer counts.
4. The defect types come from the setting **Defect types for the daily log**. The owner can change the list.

## Defects summary

1. Open **Production → Defects** to see good pieces and defects per product and day, and the defect rate by type.
2. The **Daily log** and **Output** tabs of an order show the same numbers for that order.
