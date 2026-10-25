---
key: sales.fulfilment
title: Pick, pack and dispatch
version: 1
updated_at: 2026-10-25
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

Pick by scanning each allocated box. A different person verifies the packing. Stock is issued only when the shipment is dispatched.

## Pick

1. Open **Picking** and press **Start pick** on an allocated order. You can also use **Start pick list** from the order.
2. At the shelf, under **Scan the box label (or the lot label for loose units)**, scan each box. A box that is not on the list is refused. A duplicate scan counts once.
3. If you scanned the wrong box, use **Take back** with a reason.
4. Press **Complete pick**. A line you could not pick fully needs a **Short-pick reason**.

## Verify the packing (a different person)

1. Open the shipment and scan each box again under **Scan each box**.
2. The person who picked cannot verify the same shipment.
3. A box beyond the order is refused as an over-shipment. Only an approver can allow it, with a customer reference and their password.
4. Enter the **Carrier**, **Packages** and **Gross weight (kg)**, then press **Complete packing**.

## Dispatch

1. On the shipment, you may **Print draft delivery receipt** for loading. It does not issue stock.
2. Press **Dispatch shipment** and confirm. This issues the stock and numbers the delivery receipt. It cannot be undone without a return.
3. Use **Print delivery receipt** for the driver's copies.

## Delivery acknowledgment

1. When the signed copy comes back, record **Received by (name)**, **Position** and **Received at**, add the **Photo of the signed copy** and any **Remarks**, then press **Save acknowledgment**.
2. **Dispatch** lists delivery receipts that have not been acknowledged yet.
