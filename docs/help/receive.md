---
key: inventory.receive
title: Receive a delivery
version: 2
updated_at: 2026-10-30
sop: SOP to be mapped by the warehouse lead (US-9-08)
---

Use this screen when a supplier delivery arrives. New lots wait for the QA check before anyone uses them.

## Which delivery is it?

1. If the supplier sent goods for a purchase order, tap that order (supplier name and PO number).
2. If nobody made a purchase order (an urgent buy), tap **No purchase order (urgent buy)**. Purchasing makes the PO later from the receipt.

## Delivery

1. Type the **Delivery receipt or invoice no.** exactly as printed on the supplier's paper.
2. No purchase order? Type or pick the **Supplier** and choose **Why no purchase order?**.

## Each item

1. Check the **Quantity received**. For an order it is filled in with what is still to come: change it if less came.
2. Copy the **Supplier lot no.** and the **Expiry date** from the label on the sack, drum or box. Do not guess dates.
3. If the item has storage rules, tick **I checked the storage**.
4. An ordered item did not come? Tick **Not in this delivery**.
5. Two supplier lots of the same item are two items: tap **Add another item**.

## More details (only when needed)

- **Made on**, **Retest date** and **Containers** (one label per container).
- **Put it in**: the place is chosen for you. New lots go to the QA area; the line under each item says which section they are stored in after the QA check (for example Raw materials or Packaging).
- **Problem with the delivery?**: less than ordered, more than ordered, damaged, wrong item or papers missing. More than ordered and wrong items are saved as a draft; purchasing approves them first.

## After posting

- The receipt gets a GR number and each item becomes a lot waiting for QA.
- Print the lot labels and stick them on every container.
- Use **Put away** to store the goods. Put away shows the section the item belongs in.
- Urgent buy with no purchase order: purchasing opens the receipt and taps **Create PO from this receipt**. Nothing is received twice.
