---
key: production.work_order
title: Plan and release a work order
version: 2
updated_at: 2026-10-30
sop: Not yet mapped. The QA document controller enters the SOP number in the SOP register (docs/training-plan.md §4)
---

A work order says what to make, how much and when. Releasing it reserves the materials, and then you create the batches.

Most people use **Production orders** instead: the same order on one simple page, where one **Approve** does plan, release and batch creation together (see "Make a product with a production order"). This page is the detailed view.

## Create

1. Open **Work orders** and press **New work order**.
2. Choose the **Product**. The **Formula** shown is the approved revision in effect. You cannot choose a draft.
3. Enter the **Batch size (kg)**, the **Number of batches**, the **Planned start** and **Planned end**, and the **Production line**.
4. Optional: **Supervisor**, **Priority (1 = highest)**, **Target units**, **Notes**.
5. Press **Create work order**. It starts as a draft.

## Plan

1. Open the work order and press **Plan (resolve revisions)**.
2. The formula, routing and inspection plan in effect are fixed for this work order. A later approved revision does not change it.

## Release and reserve

1. A site manager presses **Release and reserve materials**. Lots are reserved by first-expiry-first-out.
2. **Materials short**: the reservation is partial. The work order lists what is missing. When new stock arrives, press **Reserve again (new stock)**.

## Create batches

1. Press **Create batch 1 of N** for each batch. Each batch gets its own number and takes over its share of the reservation.
2. Then stage the materials (see "Stage materials").

## Cancel

1. **Cancel work order** needs a **Reason**. The reservations end and batches that have not started are abandoned.
