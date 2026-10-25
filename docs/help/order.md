---
key: sales.order
title: Enter and confirm a sales order
version: 1
updated_at: 2026-10-25
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

An order goes draft → submitted → confirmed (or pending approval) → allocated → shipped. Prices come from the customer's approved price list.

## Create the draft

1. Open **Sales orders** and press **New order**.
2. Choose the **Customer**, **Ship to** and **Bill to**. Add the **Customer PO number** and the **Requested delivery date**.
3. Add one line per product: **Product** and **Qty (pcs)**. The **Unit price** comes from the price list.
4. Press **Create draft order**. You can change it with **Edit draft** until you submit.

## Confirm

1. On the order, press **Confirm order**.
2. If the order is within limits, it is confirmed. If not, it shows **Needs approval** with the reason, for example a credit limit or a price below the list. The approver is a different person.

## Allocate

1. When the order is confirmed, press the allocate button. Released finished goods are allocated whole boxes first, by first-expiry-first-out.
2. **Partly allocated — shortfall**: not enough released stock. Allocate again when stock is released, or tell the customer.
3. **Release allocation** gives the stock back with a reason, for example when the customer postpones.

## Cancel

1. **Cancel order** needs a **Reason for cancelling**. Shipped orders cannot be cancelled; use a return.
