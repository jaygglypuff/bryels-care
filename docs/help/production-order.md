---
key: production.production_order
title: Make a product with a production order
version: 2
updated_at: 2026-10-30
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

A production order says what to make, how many and by when. You follow it on one page. Its status is always one of: **Draft**, **Approved**, **In progress**, **Quality check**, **Done**. An order can also end as **Failed** or **Cancelled**.

## What the statuses mean

- **Draft**: written down, not approved yet.
- **Approved**: the materials are set aside. Under it you may see **Getting materials** or **Materials ready**.
- **In progress**: someone is making it. Under it you see the step, for example **Weigh**, **Mix and pour**, or **Curing until Fri 28 Nov**.
- **Quality check**: made and in the hold area. QA checks it. **On hold** means QA said "not yet".
- **Done**: QA passed it. It is ready to sell.
- **Failed**: QA failed every batch. **Cancelled**: stopped before it was made.

## Find your work

1. Operators: open **Operations → My work**. Owners and planners: open **Operations → Production orders**.
2. Each card shows the product, how many pieces (for example "247 bars · 2 batches"), the status and one big button.
3. A red **Late** tag means the needed-by date has passed and the order is not done.
4. Owners and planners can press **Board** to see the orders in five columns, one per status.
5. **Who makes it:** on an order, the planner or site manager chooses a person under **Who makes it**, or leaves **Anyone at the site**. The person gets a notification.
6. **My work** shows your own orders first, then the ones nobody has taken. Press **Everyone's** to see the rest. Your **Home** shows **Your next task** with one big button.

## Create the order

1. Press **New order**.
2. Choose **What to make**. Type **How many (pieces)**. The order gets enough whole batches for that number.
3. Choose **Needed by** if the products are needed by a date, and the **Start date**.
4. Only if you need them, open **More details**: batch size, number of batches, finish date, production line, notes.
5. Press **Create order**. It is now a **Draft**.

## Make for a customer order

1. Open the customer order (**Sales**). If a line is short, the card **Production for this order** shows how many pieces are missing.
2. Press **Make for this order**. The product, the missing pieces and the delivery date are filled in for you.
3. Check the numbers and press **Create order**. The production order is linked to the customer order.
4. People who can only look at customer orders do not see this button.

## Approve

1. A manager opens the order and presses **Approve**.
2. Approving sets the materials aside and creates the batch. You do not create batches yourself.
3. If materials are missing, nothing changes and the message says which material and how much is missing. Receive the stock, then press **Approve** again.
4. The person who created the order cannot approve it. Another person who can approve must do it.

## Make it: always press the big button

1. The big button on the order always shows the next step: **Get materials**, **Start**, **Weigh**, the name of the next step, **Curing finished**, **Finish** or **Check quality**.
2. While a batch cures, there is no button. The order says until which day it cures.
3. If you may not do the next step, the order tells you who can.
4. An order with more than one batch shows one row per batch, each with its own button.

## Daily log: what happened today

1. Open the order. On the **Today** tab fill in **What happened?**, **Good pieces made** and the **Rejects** by type.
2. Press **Save to daily log**. You can add more entries during the day.
3. Made a mistake? Open **Daily log**, press **Correct this entry**, fix the numbers and say why. The old entry stays visible and no longer counts.
4. The reject types come from the setting **Reject types for the daily log**. The owner can change the list.
5. **Operations → Today** shows everything written today for all orders of your site.

## Rejects summary

1. Open **Operations → Rejects** to see good pieces and rejects per product and day, and the reject rate by type.
2. The **Daily log** and **Batches** tabs of an order show the same numbers for that order.

## Older screens

The detailed screens (production plan, detailed work orders and board, the full batch record, materials by scan) are under **Operations → Advanced**. You do not need them for daily work.
