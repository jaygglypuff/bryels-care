---
key: start.getting_started
title: Getting started: from an empty company to a shipped order
version: 1
updated_at: 2026-10-25
sop: Training guide for the sandbox; not an SOP
---

This guide takes you through the whole system once, in order, in the empty sandbox company. Nothing is there yet except one site (**SBX Sandbox Plant**), its warehouse and basic locations, the units of measure, the reason codes and the print templates. You create everything else. Each step says where to click in the left menu.

Sign in on the sign-in page with **Start from scratch** and pick **Sandbox Owner**. As the owner you can do every step yourself, including approvals that normally need a second person; those are recorded in the audit log as an owner override. If you want to see how the hand-offs work for your staff, sign in with the role accounts instead (for example **Sandbox QA** to release lots). All sandbox passwords are demo1234.

One rule for every record: many new records start as a **Draft**. Open the record and use the buttons at the top (for example **Submit**, **Approve** or **Activate**) until its status reads **Active** or **Approved**. Only active or approved records can be used in the next steps.

Tip: when a button is missing or a step says it needs someone else, the message names the role and the people who can do it.

## 1. Check your site and warehouse

1. Open **Master data → Sites**. You should see **SBX Sandbox Plant**. Fill in the address if you like.
2. Open **Master data → Locations**. The warehouse already has a receiving dock, quarantine, QA hold, rejected, recall, staging, production, storage, finished goods and dispatch locations. Add more racks with **New location** when you need them.
3. Optional: **Master data → Production lines** to add your soap or lotion line.

## 2. Create what you buy (materials)

1. Open **Master data → Materials** and press **New material**.
2. Create at least two raw materials (for example a base oil and a fragrance) and one packaging item (a wrapper or a bottle). Choose the stock unit (g, kg, mL or pcs) and set **lot tracked** and the shelf life.
3. Activate or approve each material (see the rule at the top) so it can be bought and used.

## 3. Create a supplier and approve it

1. Open **Master data → Suppliers** and press **New supplier**. Use a made-up name.
2. Open **Procurement → Approved suppliers** and add the supplier for each material it may deliver. Approve the entry. Receiving refuses a material from a supplier that is not approved for it.

## 4. Create what you sell (product)

1. Open **Master data → Products** and press **New product** (for example a 135 g soap bar). Set the selling unit, units per box and shelf life.
2. Activate the product.

## 5. Write the recipe (formula) and the steps (routing)

1. Open **Production → Formulas** and create a formula for the product: each material with its quantity for one standard batch.
2. Submit it, then approve it. Only an approved formula can be used for production.
3. Open **Production → Routings** and create the steps (for example weighing, mixing, curing, cutting, wrapping). Submit and approve.
4. Optional: **Production → Work instructions** for operator text per step, and **Production → Equipment** for scales and mixers.

## 6. Say what QA checks (inspection plan)

1. Open **Quality → Inspection plans** and create a plan for the incoming materials (for example appearance and certificate of analysis) and one for the finished product (for example weight and pH).
2. Submit and approve each plan.

## 7. Buy and receive the materials

1. Optional but realistic: **Procurement → Purchase orders**, create a purchase order to your supplier, submit and approve it.
2. Open **Inventory → Receive materials**. Choose the supplier and the material, type the supplier lot, the quantity and the expiry date, and post the receipt. Print the labels when asked.
3. The received lot sits in quarantine. It cannot be used until QA releases it.

## 8. QA releases the materials

1. Open **Quality → QA queue**. Each new lot waits there.
2. Open the lot, record the inspection results and choose **Release**. The lot becomes available.
3. Open **Inventory → Put away** and move the released lot from the receiving dock to a storage rack (scan the labels or choose the locations).

## 9. Plan production (work order)

1. Open **Production → Work orders** and create a work order: product, quantity and due date. It uses the approved formula and routing.
2. Press **Release and reserve materials** on the work order. Releasing checks that enough released material exists and reserves it. If something is short, the screen says what is missing.
3. Create the batch from the work order (**Production → Batches** or the work order page).

## 10. Make the batch

1. **Production → Stage materials**: move the reserved lots to the production staging location.
2. On the batch, do the **line clearance** (the room and line are clean and empty of the previous product).
3. **Weighing**: weigh each material against the formula. A second person normally checks each weighing.
4. Complete each routing step and record the readings asked for.
5. Record the output (how many good units) and the yield. The finished goods go to quarantine.

## 11. QA releases the batch

1. Open **Quality → QA queue**. Review the batch record and the finished-product inspection.
2. Choose **Release**. The finished goods can now be sold.
3. On the batch, open **Closure & paper pages** and close the batch. The final batch record (BMR) can be printed.

## 12. Sell and ship

1. Open **Sales → Customers** and create a customer (made-up name), then approve it.
2. Open **Sales → Price lists** and give the product a price. Approve the price list.
3. Open **Sales → New order**. Choose the customer, add the product and quantity, submit and confirm the order.
4. **Sales → Picking**: pick the boxes (the system suggests the lots that expire first). Then **Boxing** and **Dispatch**: print the delivery receipt and mark the order dispatched.

## 13. Bill and get paid

1. Open **Finance → Invoices**. Create the invoice from the dispatched order and issue it.
2. **Finance → Payments**: record the customer's payment and match it to the invoice.

## 14. See it all together

1. **Home → Overview** and **Home → Dashboards** now show your stock, the batch and the order.
2. **Quality → Traceability**: search the batch number to see which material lots went into it and which customer received it.
3. **Reports** lists the standard reports; each one exports to a spreadsheet.

## Start over

1. When you want a clean page again, use **Start over** in the yellow sandbox banner (owner only). It reloads the sample company and empties the sandbox again. Everything you created there is removed.
