---
key: start.getting_started
title: Getting started: from an empty company to a shipped order
version: 4
updated_at: 2026-10-30
sop: Training guide for the sandbox; not an SOP
---

This guide takes you through the whole system once, in order, in the empty sandbox company. Nothing is there yet except one site (**SBX Sandbox Plant**), its warehouse and basic locations, the units of measure, the reason codes and the print templates. You create everything else. Each step says where to click in the left menu.

Sign in on the sign-in page with **Start from scratch** and pick **Sandbox Owner**. As the owner you can do every step yourself, including approvals that normally need a second person; those are recorded in the audit log as an owner override. If you want to see how the hand-offs work for your staff, sign in with the role accounts instead (for example **Sandbox QA** to release lots). All sandbox passwords are demo1234.

One rule for every record: many new records start as a **Draft**. Open the record and use the buttons at the top (for example **Submit**, **Approve** or **Activate**) until its status reads **Active** or **Approved**. Only active or approved records can be used in the next steps.

Shortcut: on **Management → Production setup → Products and formulas** press **Use the Acapulco soap example**. It adds the soap materials (coconut oil, palm oil, lye solution, extract, colour, wrapper), the product **Acapulco Soap 135 g**, a draft formula and a draft soap routing in one tap. Then skip steps 2, 4 and 5 except for checking, sending and approving the drafts (open the recipe from the recipe list and press **Edit recipe**). The quantities are examples from the fictional demo company: check them before you rely on them.

Tip: when a button is missing or a step says it needs someone else, the message names the role and the people who can do it.

## 1. Check your site and warehouse

1. Open **Management → Master data → Sites**. You should see **SBX Sandbox Plant**. Fill in the address if you like.
2. Open **Management → Master data → Locations**. The warehouse already has a receiving dock, quarantine, QA hold, rejected, recall, staging, production, storage, finished goods and dispatch locations. Add more racks with **+ Add location** when you need them (leave the code empty and the system gives LOC-0001, LOC-0002 ...). Tap **Edit** next to a location to change it.
3. Optional: **Management → Master data → Production lines** to add your soap or lotion line.

## 2. Create what you buy (materials)

1. Open **Management → Master data → Materials** and press **New material**. You may leave the code empty: the system gives the next number (MAT-0001, MAT-0002 ...).
2. Create at least two raw materials (for example a base oil and a fragrance) and one packaging item (a wrapper or a bottle). Choose the stock unit (g, kg, mL or pcs) and set **lot tracked** and the shelf life.
3. Activate or approve each material (see the rule at the top) so it can be bought and used.

## 3. Create a supplier and approve it

1. Open **Management → Master data → Suppliers** and press **New supplier**. Use a made-up name.
2. Open **Management → Purchasing → Approved suppliers** and add the supplier for each material it may deliver. Approve the entry. Receiving refuses a material from a supplier that is not approved for it.

## 4. Create what you sell (product)

1. Open **Management → Master data → Products** and press **New product** (for example a 135 g soap bar). Set the selling unit, units per box and shelf life.
2. Activate the product.

## 5. Write the recipe: what goes in and the steps

A recipe tells the workers what to put in one batch and what to do, step by step. Open **Management → Production setup → New recipe (step by step)**. It asks five short questions. Use **Next** and **Back** at the bottom.

1. **Which product?** Tap the product. No product yet? Tap **Make a new product**: type the name (for example *Calamansi Soap 135 g*), the size in grams (135), what kind of product it is (Soap is sold as bars), how many go in one box and how many months it stays good. The product and the item you sell are made and made ready in one go. (If you are not allowed to, the screen says who must finish it.) You can skip step 4 of this guide.
2. **How big is one batch?** Choose how you count it:
   - **By pieces** (new recipes start here): type how many pieces one batch makes, for example 70 bars. The system works out the kilograms from the weight of one piece (the product's size, for example 135 g) and the **Expected amount made**, and shows both: "One batch makes 70 bars of 135 g (about 9.9 kg of soap)". The recipe is saved in kilograms (9.948 kg here: 70 × 135 g, plus a little extra for what is lost, rounded up to a whole gram so you always get at least 70). When you open the recipe again it shows 70 bars. If the product has no weight per piece yet, the screen asks **How heavy is one piece? (g)** once and saves it to the product; if you are not allowed to change products it says so, and you choose **By weight** or ask someone who may.
   - **By weight (kg)**: type how many kilograms you mix in one go, for example 10. The screen tells you about how many bars that makes.

   The **Expected amount made**: out of everything you mix, how much ends up as product you can sell (95 means 5 out of every 100 kg is lost in the pot). Want to start from a recipe you already have? Choose it under **Start from another product's recipe** and press **Copy**: you get its ingredients, packaging and steps to change.
3. **Ingredients.** Tap **Add an ingredient**, type a few letters of its name and tap it. Not in the list? Tap **Add a new ingredient**. Type the amount. Choose **grams** or **percent** at the top: the other number is worked out for you. In percent the total must be exactly 100%; the bar at the bottom says, for example, "Total 97.5% — add 2.5% more". For each ingredient check the **Allowed difference** (how far the scale may be off and still be OK) and tick **Needs a second person to check the weighing** for things like lye, colour, extract and scent. Use the arrows to change the order.

   **Packaging for each piece** (below the ingredients): tap **Add packaging (wrapper, label, bottle, box)**, pick the wrapper (or tap **Add a new packaging item**: it is counted in pieces) and type **How many per bar** (usually 1). The screen shows how many one batch needs ("= 70 for one batch"). Packaging is not an ingredient: it is not weighed and not part of the 100%. When a batch of this recipe is planned, the wrappers are set aside with the ingredients and listed on **Get materials**. The recipe page shows them as, for example, "Packaging: 1 Soap wrapper 135 g per bar".
4. **Steps.** Tap the blocks in the order the work is done: Check the area is clean, Weigh the ingredients, Heat, Mix, Pour into moulds, Wait / cure, Cut, Wrap / label, and so on. Tap a step to change its name, write what to do, add things to write down (for example *Temperature*, unit °C, lowest OK 60, highest OK 70) or set how long to wait (for example 4 weeks). Each step shows a line like the worker will see it: "Step 3 of 9 · Heat · Temperature 60–70 °C". Use the arrows to move a step, the copy button to repeat it and the bin to remove it.
5. **Check and save.** Read the summary: the batch in pieces and kilograms, every ingredient in grams and percent, the packaging per piece, every step in order. Press **Save as draft** to finish later, or **Send for approval**. A recipe can be used for production only after someone approves it. After approval it can't be changed; to change it later you open the recipe and press **Make a new version**.
6. **Approve.** Someone else approves it: by default a QA person checks it, then a manager or the owner approves. You can't approve your own recipe. They open it from **To approve** (or the recipe page → **Ingredients in detail** / **Steps in detail**) and press **Approve**.

The detailed pages (**Products and formulas** and **Steps for each product**, "advanced editing") still work for everything else, such as linking a written work instruction or equipment to a step.

## 6. Say what QA checks (inspection plan)

1. Open **Management → Production setup → Inspection plans** and create a plan for the incoming materials (for example appearance and certificate of analysis) and one for the finished product (for example weight and pH).
2. Submit and approve each plan.

## 7. Buy and receive the materials

1. Optional but realistic: **Management → Purchasing → Purchase orders**, create a purchase order to your supplier, submit and approve it.
2. Open **Operations → Receiving → Receive materials**. Choose the supplier and the material, type the supplier lot, the quantity and the expiry date, and post the receipt. Print the labels when asked.
3. The received lot sits in quarantine. It cannot be used until QA releases it.

## 8. QA releases the materials

1. Open **Operations → Quality check**. Each new lot waits there.
2. Open the lot, record the inspection results and choose **Release**. The lot becomes available.
3. Open **Operations → Receiving → Put away** and move the released lot from the receiving dock to a storage rack (scan the labels or choose the locations).

## 9. Plan production (production order)

1. Open **Operations → Production orders → New production order**. Choose the product, type **How many (pieces)** and, if you have one, the **Needed by** date. It uses the approved formula and steps.
2. Open the order and press **Approve**. Approving checks that enough released material exists, sets it aside and creates the batch. If something is short, the screen says what is missing.
3. Made for a customer? On the customer order press **Make for this order** instead: the product and the missing pieces are filled in.

## 10. Make the batch

1. On the order, press the big button. It always shows the next step.
2. **Get materials**: take the materials on the list to the making area (for now by scanning each lot).
3. **Start**: do the start check (the room and line are clean and empty of the previous product).
4. **Weigh**: weigh each material against the formula. A second person checks the weighings that need it.
5. Do each step and type the values asked for (for example a temperature).
6. **Finish**: record how many good pieces were made. The finished goods go to the hold area and the order shows **Quality check**.

## 11. QA checks the batch

1. Open **Operations → Quality check**. Review the batch record and the finished-product inspection.
2. Choose **Release** (pass). The finished goods can now be sold and the order shows **Done**.
3. On the batch (open the production order, then tap the batch number; or **Management → Planning tools → All batches and their records**), open **Close the batch and paper pages** and close the batch. The final batch record (BMR) can be printed.

## 12. Sell and ship

1. Open **Sales & Customers → Customers** and create a customer (made-up name), then approve it.
2. Open **Sales & Customers → Selling → Price lists** and give the product a price. Approve the price list.
3. Open **Sales & Customers → Customer orders → New customer order**. Choose the customer, add the product and quantity, submit and confirm the order.
4. **Operations → Packing & dispatch → Picking**: pick the boxes (the system suggests the lots that expire first). Then **Boxing** and **Dispatch**: print the delivery receipt and mark the order dispatched.

## 13. Bill and get paid

1. Open **Sales & Customers → Billing & payments → Invoices**. Create the invoice from the dispatched order and issue it.
2. **Sales & Customers → Billing & payments → Payments**: record the customer's payment and match it to the invoice.

## 14. See it all together

1. **Home → Overview** and **Management → Reports & analytics → Dashboards** now show your stock, the batch and the order.
2. **Operations → Quality → Traceability**: search the batch number to see which material lots went into it and which customer received it.
3. **Reports** lists the standard reports; each one exports to a spreadsheet.

## Start over

1. When you want a clean page again, use **Start over** in the yellow sandbox banner (owner only). It reloads the sample company and empties the sandbox again. Everything you created there is removed.
