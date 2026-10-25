---
key: platform.import
title: Import a spreadsheet
version: 1
updated_at: 2026-10-25
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

Load master data, opening stock or scanned records in five steps: upload, map, validate, review and approve, post. Nothing is created until the post step.

## 1 Upload

1. Open **Imports**. Choose **What are you importing?** and the **Site** if it asks.
2. Choose the **File (CSV UTF-8 or .xlsx, up to 20 MB)**. If you load the same file from the same source again, enter its **Saved mapping profile**.
3. Press **Upload and map columns**.

## 2 Map

1. For each field, choose the column of your file. Required fields are marked.
2. Set the **Date format in the file** and the separators.
3. Optional: **Save as profile** so the next file from the same source maps itself. Press **Save mapping**.

## 3 Validate

1. Press **Validate the file**. Large files run in the background, and you get a notification when they finish.
2. Rows are counted as **Accepted**, **Warnings**, **Duplicates**, **To decide**, **On hold** or **Rejected**. Open each group and fix the file, or record a **Decision** per row.

## 4 Review and approve

1. Press **Submit for approval**. A different person reviews the counts and presses **Approve import**.

## 5 Post

1. Press **Post N rows** and confirm. Posted records are only corrected by reversal, never by editing.
2. If posting stops, press **Resume posting**. It continues with the rows not yet posted.
