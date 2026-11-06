---
key: production.bmr
title: Batch record (BMR), closure and paper pages
version: 2
updated_at: 2026-11-06
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

The batch manufacturing record is built from what was entered during the batch. You close it when everything is complete. A closed record can only be changed through a controlled reopen.

## Print or view

1. From the batch, press **Print batch record** for the current record. If the batch changed since the last copy, press **Generate new BMR revision** first: only a numbered copy prints.
2. Press **Print / save as PDF**. In Chrome's print window choose **Save as PDF** or your printer, paper **A4**, margins **Default**, scale **100**; under **More settings** turn **Headers and footers off** (the record prints its own header and "Page x of y" on every page) and **Background graphics on**. The PDF file name is the batch number and product.
3. The record has seven parts: 1 batch identity and recipe version, 2 dispensing and weighing, 3 procedure (every step with who did it, who checked, start and end, readings and machines, then the checklist), 4 packaging and labels, 5 yield, 6 problems and changes, 7 QA decision and sign-offs (on its own page), then the paper pages and the audit trail.
4. A reprint is recorded. Use it only when a copy is lost or damaged. Copies made before the seven-part layout keep their old layout.

## Paper pages (hybrid steps)

1. Open **Close the batch and paper pages**. Under **Blank paper page for step**, issue the page with **Issue page**.
2. After the step, attach the completed page under **Scan or photo of the completed page** and press **Attach scan**. By attaching, you confirm you entered its values in the system.
3. An unused page is voided with a reason (**Void page**).

## Close the batch

1. The closure page lists anything that blocks closure, for example an open deviation or an unreviewed page.
2. When nothing blocks, press **Close the batch and make the final batch record**.

## Reopen and amend

1. Use **Request reopen** with **Why must the closed record be reopened?** (at least 10 characters) and **What will be amended?**. A second person decides.
2. Each correction is recorded with **Record amendment**: the value as recorded, the corrected value and the reason. The original stays in the record.
