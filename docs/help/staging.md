---
key: production.staging
title: Stage materials for a batch
version: 2
updated_at: 2026-10-30
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

Bring the reserved lots of a batch to the staging area by scanning them. Only released lots that were reserved for the batch can be staged.

## Choose the batch

1. Usually you come here from the order's **Get materials** button. You can also open **Management → Planning tools → Get materials by scanning**. It lists the batches of approved orders.
2. Open the batch. The screen lists each ingredient, the lot reserved for it and how much is still needed.
3. **Nothing to stage**: no released work order has batches waiting. Ask the planner.

## Scan the lot

1. Under **1. Scan the lot (container label)**, scan the container.
2. A lot that is not reserved for this batch, is on hold or is expired is refused. Do not take it to the line.
3. To use a different lot, a supervisor approves it under **Approve substitution** with a reason.

## Scan the staging location

1. Under **2. Scan the staging location**, scan the staging area label. The allowed areas are listed under the field.
2. Leave **Quantity** empty to stage what the ingredient still needs, or enter a part.
3. Press **Confirm staging**. When every ingredient is staged you see **Batch fully staged**.

## Paperwork

1. Use **Print dispensing sheet** or **Print traveler** if your site works with paper copies at the line.
2. Then open the batch with **Open batch workspace**.
