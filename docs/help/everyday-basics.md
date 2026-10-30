---
key: start.everyday_basics
title: Everyday basics: codes, locations, deleting drafts, approvals and notifications
version: 1
updated_at: 2026-10-30
sop: Training guide; not an SOP
---

Five things people ask about most. Each one says where to tap.

## Codes are given for you

1. When you add a material, product, supplier, customer, location or equipment, you may leave **Code** empty.
2. The system then gives the next number: **MAT-0001** for materials, **PRD-0001** products, **SUP-0001** suppliers, **CUS-0001** customers, **LOC-0001** locations and **EQP-0001** equipment.
3. You can still type your own code if your labels already use one. A code that is already taken is skipped by the automatic numbering.
4. The owner can change the prefix under **Management → System → Numbering**.

## Adding or changing a location

1. Open **Management → Master data → Locations**. Tap **+ Add location** at the top, pick the warehouse and the type of place, and give it a name. Leave the code empty for an automatic one.
2. To change a location, tap **Edit** next to it. You can change the name, the type of place, the **Section or zone** it sits in, and whether it can be picked from.
3. To stop using a location, open it and use **Switch off (no longer used)**. A location that holds stock must be emptied first.
4. A **Site** is one address. If your company works from places far apart (for example a factory and a store room in another town), add one Site per address under **Management → Master data → Sites**. Each site has its own warehouses, and each warehouse has its own locations.

## Deleting a draft

1. Open the draft (for example a purchase request, sales order, quotation, price list, stock adjustment, formula, routing or inspection plan, or a new material, product, supplier or customer).
2. At the bottom you see **Delete** when the draft was never sent for approval and nothing uses it yet. Tap **Delete draft** and confirm.
3. Only the person who made the draft, or someone who may edit these records, can delete it. The audit log keeps a copy of what was deleted.
4. Once something was sent for approval, approved, posted or used, it cannot be deleted. Use **Cancel** or **Void** instead, as before.

## Everything waiting for your approval

1. Tap **To approve** at the top of the screen. The red number shows how many items wait for you.
2. Each row shows what it is, who asked and when. Tap the row or **Open** to see the full record.
3. For many items (purchase requests and orders, sales orders, quotations, price lists, stock adjustments, invoices, expense claims, change controls, imports) you can tap **Approve** right there, or **Reject** / **Send back** with a short reason.
4. Items that need a password, a measurement or a longer form open on their own page.
5. With the owner override switched on, the owner sees every approval in the company.

## Notifications open the record

1. Tap the bell. Each notification has an **Open** button that takes you to the record it is about and marks it read.
2. **Acknowledge** still means "I am dealing with it" and removes it from your open list.
