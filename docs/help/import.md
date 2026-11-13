---
key: platform.import
title: Import a spreadsheet
version: 3
updated_at: 2026-11-13
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

Load master data, opening stock or scanned records in five steps: upload, map, validate, review and approve, save for good. Nothing is created until the last step.

## 1 Upload

1. Open **Set-up → IT and system → Load data from a spreadsheet**. Choose **What are you importing?** and the **Site** if it asks.
2. Choose the **File (CSV UTF-8 or .xlsx, up to 20 MB)**. If you load the same file from the same source again, choose it under **Use saved column matching (optional)**.
3. Press **Upload and map columns**.

## 2 Map

1. For each field, choose the column of your file. Required fields are marked.
2. Under **Dates, numbers and saving this matching (you can skip this)**, set **How dates are written in the file** and the separators.
3. Optional: type a name under **Save this matching for next time: name (optional)** so the next file from the same source matches itself. Press **Save mapping**.

## 3 Validate

1. Press **Validate the file**. Large files run in the background, and you get a notification when they finish.
2. Rows are counted as **Accepted**, **On hold**, **Already there**, **To decide**, **Refused** or **Warnings**. Open each group and fix the file, or choose a **Decision** per row and press **Save decision**.
3. **Customers**: a row with the same phone or email as a customer you already have is **To decide** ("Possible duplicate: the same phone as existing customer CUS-003 …"). Choose **Same as existing**, **New record** (a different customer) or **Reject**. Two rows of your file with the same phone or email get a warning; the second one is not loaded and the results file says why.

## 4 Review and approve

1. Press **Submit for approval**. A different person reviews the counts and presses **Approve import**.

## 5 Save for good

1. Press **Save N rows for good** and confirm. Saved records are only corrected by reversal, never by editing.
2. If saving stops, press **Carry on saving**. It continues with the rows not yet saved.
