---
key: sales.order
title: Enter and confirm a customer order
version: 4
updated_at: 2026-11-08
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

An order goes: draft → confirmed (or waits for an OK) → stock set aside → got from the shelf → sent out. Prices come from the customer's approved prices.

## Enter the order (3 steps)

1. Open **Sell → Customer orders** and press **New customer order** (or **New customer order** on a customer).
2. Step 1: type part of the customer's name and tap the customer. Choose **Deliver by**. **Deliver to**, **Bill to** and **Customer's order no.** are under **More details** (the usual addresses are used).
3. Step 2: tap each product and type **How many (pcs)**. The usual price is used; **Price each (₱)** is only for a special price.
4. Step 3: **Check the order**, then press **Save the order** (or **Save the draft** to finish later). A draft can be changed until it is confirmed.

## Confirm

1. On the order, press **Confirm the order**. Nothing is sent to the customer: to give them a confirmation, use **⋯ More → Print the order confirmation** or **Email the confirmation** (it says **Can ship from**).
2. If the order is within limits, it is confirmed. If not, it shows **Needs approval** with the reason, for example unpaid bills or a price below the usual one. It appears in **To approve** for the person who decides.

## Set the stock aside

1. When the order is confirmed, press **Set aside the stock**. Finished goods that QA said OK to are set aside, whole boxes first, the ones that expire first.
2. **Not enough stock**: only part is set aside. Press **Set aside the rest** when more stock is ready, or tell the customer.
3. **Let the stock go** (under **⋯ More**) gives the stock back with a reason, for example when the customer postpones.

## Cancel

1. **Cancel order** (under **⋯ More**) needs a **Reason for cancelling**. Orders already sent out cannot be cancelled; use a customer return.

## Not enough stock

1. When the order is short, the order page shows **Not enough stock: it needs making** with how many are missing.
2. Press **Ask the planner to make 378** (your number). The planner gets a message and sees the order on their Home. After asking, the order says **Asked the planner on …** instead of the button. A planner or manager sees **Make the missing 378 for this order**: it opens a production order linked to this order.
3. Only the planner or the manager makes the production order. It shows on your order as **Where is it now**: how many, the step, who makes it and when it should be ready. The order header says **Can ship from**: today when it is on the shelf; else the day the batch should be ready and checked by QA; "not known yet" while it still needs making.
4. Stock in the sending-out bay or in the QA cage is not free stock. Only stock on a shelf that QA said OK counts.

## The customer changed the order

1. On a confirmed order, under each product, press **Change how many** or **Cancel this line**, and type what the customer said.
2. Lowering lets go of the set-aside stock that is no longer needed. It never goes below what was already sent or is being taken off the shelf.
3. Adding more works only before stock of that product is set aside, and only within the customer's credit; otherwise make a new order for the extra.
4. The change is in **What happened** with your name, the time and the reason. The order keeps its number.

## Stock goes to the order due first

If an order due earlier also needs the same stock, **Set aside the stock** says so ("Order SO-… is due earlier and also needs this stock") and asks before it sets aside. Set that one aside first unless you agreed otherwise.

## Customers with no credit limit

A new customer has no credit limit until finance sets one. Their orders up to the amount in Settings (₱50,000 unless the owner changed it) are confirmed at once; a bigger order waits for an OK.
