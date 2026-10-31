---
key: inventory.receive
title: Receive a delivery
version: 4
updated_at: 2026-10-30
sop: SOP to be mapped by the warehouse lead (US-9-08)
---

Use this screen when a supplier delivery arrives. New lots wait for the QA check before anyone uses them.

## Which delivery is it?

1. If the supplier sent goods for a purchase order, tap that order (supplier name and PO number).
2. If nobody made a purchase order (an urgent buy), tap **No purchase order (urgent buy)**. Purchasing makes the PO later from the receipt.

## Delivery

1. Type the **Number on the supplier's paper** (delivery receipt or invoice) exactly as printed.
2. No purchase order? Type or pick the **Supplier** and choose **Why no purchase order?**.

## Each item

1. Type **How much came?** and check the unit next to it. It starts at the unit the item is usually bought in (for example **kg** for oils). For an order it is filled in with what is still to come: change it if less came.
2. If the amount looks strange (for example 50 g of an oil that comes in 25 kg sacks), the page asks before saving: tap **Yes** if it is right, or **Change to 50 kg**. Then tap the save button again.
3. Copy the **Supplier's code on the sack** and the **Expiry date** from the label on the sack, drum or box. Do not guess dates.
4. If the item has storage rules, tick **I checked the storage**.
5. An ordered item did not come? Tick **Not in this delivery**.
6. Two supplier lots of the same item are two items: tap **Add another item**.
7. Check the **Brand** printed on the containers. The form suggests the usual brand; change it if a different brand arrived.

## More details (only when needed)

- **Made on**, **Retest date** and **Containers** (one label per container).
- **Put it in**: the place is chosen for you. New lots go to the QA area; the line under each item says which section they are stored in after the QA check (for example Raw materials or Packaging).
- **Problem with the delivery?**: less than ordered, more than ordered, damaged, wrong item or papers missing. More than ordered and wrong items are kept as not finished; purchasing approves them first.

## Save and print labels

1. Press **Save and print labels** once. The receipt gets a GR number and each item becomes a lot waiting for QA.
2. The print preview opens by itself, with one label for each sack or container (1 when you did not type containers). One sentence says how many labels were sent, and which items already had labels.
3. Tap **Print**, then **The labels printed OK**, and stick one label on every sack. Leave the goods in the hold area.
4. When there is more than one printer or label size, the labels page asks first: check **How many sacks/containers?**, then tap **Print labels**.
5. When QA releases a lot, you get a message such as "Coconut Oil lot L-2610-00024 is ready — put it on A-01", and the lot appears in **Put away**.
- Urgent buy with no purchase order: purchasing opens the receipt and taps **Create PO from this receipt**. Nothing is received twice.
