# Production floor display ("Floor screen") — plan

| | |
|---|---|
| Status | MVP built as `/floor` (ADR-084, 2026-10-30); redesigned with rotation and a dark option (ADR-135, 2026-11-13); warehouse variant and signed display link not built (see §9) |
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

| Step | Content | Status |
|---|---|---|
| MVP | `/floor` page + read model + auto-refresh + display role, production panels (§2) | **Built** (ADR-084) |
| Redesign | Calm cards, problems strip, page rotation, connection pill, `?theme=dark` (§9.2) | **Built** (ADR-135) |
| Next | Warehouse variant (`?area=warehouse`), signed display link | Not built |

### 9.1 As built (MVP)

| Part | Where | Notes |
|---|---|---|
| Read model | `src/modules/production/floor-display.ts` → `getFloorDisplay(ctx, { siteId? })` | `production.batch.view` at the site (404 other sites, 403 without it); Today needs `production.daily_log.view` |
| Page | `src/app/floor/page.tsx` (+ `live.tsx`, `error.tsx`; no `loading.tsx`, ADR-043) | Outside the `(app)` group: no menus; `requireContext()`; `?site=<code>` |
| Refresh | `FloorRefresher` in `live.tsx` | `router.refresh()` every 30 s; "Updated hh:mm:ss"; "Connection lost — showing hh:mm data" after 75 s without fresh data or when offline; the error screen retries every 30 s |
| Role | `floor_display` "Floor display" in `src/lib/permissions.ts` | Site-scoped; `production.batch.view`, `production.work_order.view`, `production.daily_log.view`; synced by seed and `pnpm admin:bootstrap --sync-roles` |
| Demo account | `floor.nfd@bryels-care.test` / `demo1234`, "Floor TV NFD", NFD | A display-only account lands on `/floor` after sign-in (`homeHref` in `nav.ts`) |
| Menu | Operations → "Floor screen (TV)" | Roles with `production.batch.view`; not in the operator and warehouse menus (ADR-083) |
| Tests | `tests/integration/production/floor-display.test.ts`, `tests/unit/nav-per-role.test.ts` | Making now, Next up, Waiting, Today, no prices/customers, cross-site and role negatives, seed |

Rules as built (§3 refined):

- **Making now**: batches `materials_staged` ("Materials ready · not started yet") and `in_process`
  ("Step 4 of 7 · Mix and pour"), oldest start first; percent = steps done ÷ steps. A started wait step shows
  "Curing until Sat 1 Nov · 2 days left" (amber, hourglass) or "Curing finished — ready for the next step"
  (green, tick). First name of the order's assignee, else "Anyone".
- **Next up**: orders whose status is Approved and whose batches have not reached `materials_staged` (those are
  already on a card), by needed-by (empty last), then planned start. "Late" (red, warning icon) when needed-by has
  passed; "Missing materials" (amber) when the approval recorded shortages.
- **Waiting**: batches curing/resting (and how many have finished their wait); batches `awaiting_qc` or
  `quarantined` with the oldest age ("oldest waiting 3 days"); approved orders missing materials.
- **Today**: good pieces and rejects (with %) from today's daily log entries that count; "of N planned" and the bar
  only when the orders In progress have expected pieces (assumption: planned = expected pieces of the orders being
  made; confirm with the owner after use).
- **Session**: the TV account keeps a normal session; it must sign in again after `session.absolute_hours`
  (default 7 days). The signed display link (Next) removes this.

### 9.2 Redesign (ADR-135, owner 2026-11-13: "fix the TV display. It is very ugly.")

The data and its rules (§9.1) are unchanged: same read model, same permission checks, same caps (6 batches + "N more",
5 orders + "N more"). Only the picture changed. Full rules: `docs/ux-system.md` §9.15a.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ [leaf] North Fields Plant                          (● Live · updated 10:42)     10:42  │
│        This screen is for everyone on the floor: what we make now…     Saturday 14 Nov │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ⚠ NEEDS ATTENTION  ⏱ Late: Guava Bar Soap 135 g (needed by Wed 11 Nov)     (only if any)│
├──────────────────────────────────────────────────────┬─────────────────────────────────┤
│ MAKING NOW                     + 2 more being made   │ NEXT UP                         │
│ ┃ Acapulco Soap 135 g          [day 2] BM-2611-0001  │ (1) Aloe Hand Lotion   [⏱ Late] │
│ ┃ Step 4 of 8 · Pour into moulds   👤 Rhea · 08:10    │     96 pieces · Needed by Fri   │
│ ┃ [▶ Being made] ████████░░░░░░░░░░░░░░░░    37%     │ (2) …                           │
│ ┃ … up to 3 cards; more turn every 12 s  Page 1 of 2 ├─────────────────────────────────┤
│                                                      │ WAITING  ✓ 0 curing · 🔍 2 QA … │
├──────────────────────────────────────────────────────┴─────────────────────────────────┤
│ TODAY  Made 412 of 600 planned  ███████████████░░░░░ 68%                   Rejects 9    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Sizes** follow one unit (1 % of the width on a 16:9 screen), so 1280 × 720, 1920 × 1080 and 3840 × 2160 show the
  same picture and nothing scrolls. At 1920 × 1080: clock 65 px, names 44 px, the smallest words 25 px.
- **Connection**: "Live · updated 10:42", or "No internet — showing 10:42 data" (red, with an icon) after 75 s without
  fresh data or when the TV is offline.
- **Dark background**: open `/floor?theme=dark` (bookmark it on the TV). Light is the default.
- **Cheap Android TV browsers**: plain CSS (flex, grid, `min()`, `calc()`), no new libraries, no web fonts beyond the
  app's own; the only motion is the soft fade between pages and the pulsing Live dot (both off with reduced motion).
