# Production floor display ("Floor screen") — plan

| | |
|---|---|
| Status | Planned (consultant review 2026-10-30); MVP built as `/floor` (see §9) |
| Owner request | "A dashboard that is flashed on a screen in real time in the production area: what is currently being processed, what needs to be processed, etc." |
| Brief | Part II §9 (central work board), Part IV §9 (central operations board), §8 (mobile/tablet: screens are arrangements of the same workflows) |

## 1. Purpose and audience

A TV on the wall of the making area (and optionally one in the warehouse) that everyone can read from
5 metres without touching anything. It answers four questions, in this order:

1. **What are we making right now?** (each batch, its current step, how far along, who)
2. **What is next?** (the next orders to start today, in order, with "needed by")
3. **What is waiting?** (curing until when; batches waiting for the quality check; materials missing)
4. **How is today going?** (pieces made today vs. planned; rejects today)

It is not a control screen: no buttons, no prices, no customer names, no personal data beyond first names.

## 2. Layout (1920 × 1080 landscape, also works at 1280 × 720)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Bryel's Care · North Fields Plant              Thursday 30 Oct · 10:42       │
├──────────────────────────────────────────────┬────────────────────────────────┤
│ MAKING NOW                                   │ NEXT UP                        │
│ ┌──────────────────────────────────────────┐ │ 1. Guava Bar Soap 135 g        │
│ │ Acapulco Soap 135 g        B-26-0004     │ │    247 bars · needed Fri       │
│ │ Step 4 of 7 · Mixing and cutting         │ │ 2. Aloe Lotion 250 mL          │
│ │ ███████████░░░░░░  57%     Rhea          │ │    120 bottles · needed Mon    │
│ └──────────────────────────────────────────┘ │                                │
│ ┌──────────────────────────────────────────┐ ├────────────────────────────────┤
│ │ Guava Bar Soap 135 g       BM-2610-0026  │ │ WAITING                        │
│ │ Curing until Sat 1 Nov  (2 days left)    │ │ ⏳ 2 batches curing            │
│ └──────────────────────────────────────────┘ │ 🔍 3 waiting for quality check │
│                                              │ ⚠ 1 order missing materials    │
├──────────────────────────────────────────────┴────────────────────────────────┤
│ TODAY   Made 412 pcs of 600 planned  ███████████████░░░░░   Rejects 9 (2.1%) │
└───────────────────────────────────────────────────────────────────────────────┘
```

- Very large type (product names 40–48 px, numbers 64 px), high contrast, dark text on light (or a
  dark theme option for bright rooms), never colour alone (icons + words).
- Green = on track, amber = waiting / attention, red = late or blocked (with the word "Late").
- If there is nothing to show: "Nothing is being made right now" / "No orders waiting" (never blank).

## 3. Data (all live, read-only, from existing records)

| Panel | Source | Rule |
|---|---|---|
| Making now | batches in `materials_staged` / `in_process` at the site; current step from `flow-facts` (`currentStepOf`), steps done / total, assignee of the production order, started time | Ordered by start time; max 6 cards, then "+N more" |
| Curing / resting | current step is a wait step with `earliest_completion_at` | "Curing until Sat 1 Nov (2 days left)"; turns green "Curing finished — ready for the next step" |
| Next up | production orders Approved and not started, ordered by needed-by then planned start | Max 5; red "Late" if needed-by passed |
| Waiting for quality check | batches `awaiting_qc` | count + oldest age |
| Missing materials | approved orders with release shortages | count |
| Today | daily log good units and rejects for today vs. pieces planned for orders in progress / due today | percentage bar |

Reuses `getOperationsCenter`, `batchFlowFacts`, `listSiteDailyLogs`/`defectSummary` and the production order
status; no new tables.

## 4. Refresh ("real time")

- The page re-fetches its data every 30 seconds (server-rendered, no websockets needed at this volume); a
  small "Updated 10:42:30" shows freshness, and "Connection lost — showing 10:40 data" if a fetch fails.
- Later option: server-sent events on production postings for instant updates.

## 5. Access and security

- Route `/floor` with its own full-screen layout (no menus). Needs `production.batch.view` at the site.
- **Display account**: a dedicated user (e.g. "Floor TV – NFD") with a new read-only role "Floor display"
  (production.batch.view, production.work_order.view, production.daily_log.view at one site). The TV stays
  signed in; the session is renewed by the 30-second refresh. Revoking the user turns the TV off.
- Shows no money, no customer names, no supplier names; first names of operators only.
- Optional later: a revocable signed display link per site (no password on the TV).

## 6. Variants

- `/floor?site=<code>` for multi-site; `/floor?area=warehouse` (receiving due today, put-away waiting,
  orders to pick) as a second screen for the warehouse.
- Rotation mode (optional): alternate Production ↔ Warehouse every 20 s.

## 7. Hardware note

Any smart TV or a cheap Android TV stick / Chromebox with a browser in kiosk mode, landscape, sleep
disabled. Wi-Fi to the internet (the app is on Railway).

## 8. Acceptance

- Readable from 5 m; shows the four panels with real data; refreshes within 30 s of a step being recorded.
- No interaction needed; never shows prices or customer names; works signed in as the display account only.
- Empty and error states in plain words.

## 9. Delivery

| Step | Content |
|---|---|
| MVP | `/floor` page + read model + auto-refresh + display role, production panels (§2) |
| Next | Warehouse variant, rotation, dark theme, signed display link |
