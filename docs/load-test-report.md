# Load test at A-PRD-12 volumes (US-9-01)

Status: local run on 2026-10-25 (Wave 4 W4F). The 30-minute staging run on Railway
(`docs/testing.md` §11.2) is still to do. This document records the method, the numbers, the
fixes made and what the staging run must confirm.

**For business owners, in plain words:** we filled a practice database with three months of
made-up activity at the busiest volumes you expect: 2,000 stock movements a day, 20 orders a
day and 100 batches a month. Then we let 25 simulated people use the system at the same time
for 10 minutes. Recording a stock move, a weighing or a dispatch takes the server about 25 to
60 milliseconds, far inside the half-second target. No request failed, and the stock ledger
still balanced to zero afterwards. Some screens were slow at first: the order list, the
dashboard and the lot page. We found two missing database indexes and fixed them, which made
those screens 2 to 6 times faster. Under full load on the shared test machine, pages still take
1 to 5 seconds. That machine was also running other teams' tests. The real numbers come from
the staging run on Railway, which is the next step.

## 1. Method

| Item | Value |
|---|---|
| Harness | Node only, no k6 (`tests/load/`): `seed-volume.ts` (volume seed), `posting-timing.load.ts` (server time of postings through the real services), `run.ts` + `http.ts` (HTTP virtual users) |
| Volumes (A-PRD-12, 3 months) | 500 materials, 300 SKUs, 669 lots (600 generated), 180,159 stock movements, 180,141 audit events, 1,835 sales orders with 2,569 lines, 1,210 shipments, 329 batches, 20,008 notifications; database 152 MB |
| Ledger consistency | each generated lot is received once, then moved back and forth one unit at a time; balances are computed from the generated ledger; reconciliation before and after every run: 0 differences |
| Build | `pnpm build` (Next.js production build), `next start` on port 3406, one Node process, database pool 10 |
| Machine | 4 vCPU, 15 GB RAM, PostgreSQL 16.15 on the same host. **Shared with four other agents' test suites**: load average 6 to 12 during the runs, so HTTP numbers are pessimistic and noisy |
| Virtual users | 25 (A-PRD-12 concurrency): 10 warehouse (scan look-up as the browser calls it, lot page, stock move through `/api/v1`, movement list), 5 production (board, batch workspace, staging), 4 sales (order list, order page, order board), 4 managers (dashboard, analytics, report runs), 2 QA (queue, batch release); 2–5 s think time; sign-ins staggered 3.2 s apart (the per-address limit is 20 per minute); one burst of 10 parallel moves per warehouse user at mid-run |
| Duration | 10 minutes per run (staging: 30 minutes) |
| Posting harness | 100 receipts, 200 transfers, 50 weighings (10 batches × 5 ingredients, checker co-signed), 20 dispatches (each on its own allocated, picked and verified order), 20 availability queries, 1 full reconciliation |

Commands (`docs/testing.md` §11.3):

```
createdb bryels_load_<you>
DATABASE_URL=…/bryels_load_<you> pnpm db:migrate && ALLOW_DEMO_SEED=true pnpm db:seed
DATABASE_URL=…/bryels_load_<you> pnpm load:seed --months 3
LOAD_DATABASE_URL=…/bryels_load_<you> pnpm load:postings
pnpm build && DATABASE_URL=…/bryels_load_<you> APP_ORIGIN=http://localhost:3406 pnpm next start -p 3406
DATABASE_URL=…/bryels_load_<you> pnpm load:run --vus 25 --duration 600 --out run.json
```

## 2. Posting server time (target p95 ≤ 500 ms, p99 ≤ 1 s; `docs/testing.md` §11.1)

| Command | n | p50 ms | p95 ms | p99 ms | max ms | Result |
|---|---|---|---|---|---|---|
| Receipt (lot + receipt movement + projection + audit) | 100 | 22 | 43 | 57 | 90 | pass |
| Transfer (scan-to-move: lock, ledger, projection, audit) | 200 | 25 | 48 | 73 | 115 | pass |
| Weighing (`recordDispense` with tolerance, lot checks, checker) | 50 | 21 | 50 | 76 | 76 | pass |
| Dispatch (stock issue, DR number, order transition) | 20 | 62 | 113 | 122 | 122 | pass |
| Availability query (NFD, all lots) | 20 | 26 | 61 | 65 | 65 | pass |
| Full ledger reconciliation (180k movements) | 1 | 221 | | | | pass (≤ 60 s), 0 differences |

## 3. HTTP under 25 users: before the fixes (run 1)

5.6 requests/s, 3,447 requests, **0 errors**, 0 reconciliation differences, job queue empty.

| Flow | n | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|
| Sign-in | 25 | 811 | 7,132 | 8,849 |
| Scan look-up (server action) | 520 | 1,058 | 5,250 | 6,955 |
| Stock move (`/api/v1` transfer) | 520 | 1,087 | 4,175 | 7,256 |
| Stock move burst (10 parallel) | 100 | 2,318 | 3,315 | 3,577 |
| Lot page | 520 | 3,843 | 10,416 | 12,096 |
| Movement list | 100 | 1,702 | 9,575 | 12,720 |
| Batch workspace (weighing screen) | 289 | 2,596 | 9,318 | 11,982 |
| Order list | 80 | 18,579 | 35,633 | 41,794 |
| Order board | 24 | 10,522 | 13,798 | 13,850 |
| Dashboard | 156 | 4,548 | 13,040 | 15,302 |
| Report run | 156 | 2,754 | 13,643 | 17,071 |

## 4. HTTP under 25 users: after the fixes (run 2)

9.2 requests/s (+64 %), 5,546 requests, **0 errors**, 0 reconciliation differences, job
queue empty. API rate limit: of 620 rapid calls by one user, 20 were refused with **429** and
`Retry-After: 56` (limit 600 per minute), as designed.

| Flow | n | p50 ms | p95 ms | p99 ms | p95 change |
|---|---|---|---|---|---|
| Sign-in | 25 | 316 | 3,055 | 3,932 | −57 % |
| Scan look-up | 797 | 516 | 1,257 | 1,536 | −76 % |
| Stock move | 797 | 693 | 2,046 | 2,787 | −51 % |
| Stock move burst | 100 | 2,065 | 2,788 | 3,122 | −16 % |
| Lot page | 797 | 2,091 | 4,169 | 4,677 | −60 % |
| Movement list | 154 | 1,121 | 4,114 | 4,953 | −57 % |
| Batch workspace | 455 | 1,186 | 3,456 | 3,910 | −63 % |
| Production board | 455 | 766 | 2,003 | 2,788 | −75 % |
| Staging list | 455 | 283 | 1,006 | 1,558 | −61 % |
| Order list | 237 | 4,787 | 6,707 | 7,101 | −81 % |
| Order page | 237 | 216 | 946 | 2,441 | −26 % |
| Order board | 78 | 1,799 | 6,134 | 8,964 | −56 % |
| Dashboard | 247 | 2,549 | 4,313 | 4,924 | −67 % |
| Analytics | 123 | 407 | 1,248 | 1,595 | −48 % |
| Report run | 247 | 2,086 | 6,318 | 7,117 | −54 % |
| QA queue | 171 | 1,262 | 3,004 | 3,511 | −69 % |
| QA batch release | 171 | 945 | 3,032 | 3,677 | −67 % |

The same pages for one user on the idle server after the fixes: order list 0.4–1.0 s (was
2.2–3.7 s), dashboard 0.65 s (was 3.7–4.8 s), lot page 0.2 s, movement list 0.2–0.4 s, report
run 0.3 s.

## 5. Hotspots found and fixed (small, reported)

| # | Finding | Fix | Effect |
|---|---|---|---|
| 1 | Shipped-value KPI (dashboard, KPI-FIN-02) looks up stock movements by `source_document_type/id` for each shipment; no index, so every look-up read the whole 180k-row ledger | index `movements_source_doc_idx (source_document_type, source_document_id)` on `stock_movements` (`src/db/schema/inventory.ts`, migration 0012) | dashboard for one user 3.9 s → 0.65 s. The same index serves document trails and reversal look-ups |
| 2 | `sales_order_lines` had no index on `sales_order_id`; every order page, list, allocation and KPI scanned the table | index `sales_order_lines_order_idx (sales_order_id, line_no)` (`src/db/schema/sales.ts`, migration 0012) | order page p95 1.3 s → 0.9 s under load |
| 3 | The order list rendered every order of the site (1,800 rows after three months) and matched lines with a nested loop | `listOrders(ctx, status, limit)` groups lines in a map; the list screen shows the newest 200, with a note pointing to the status filter and the order report (A-W4F-16); export unchanged | order list for one user 3.7 s → 0.4–1.0 s; p95 under load 35.6 s → 6.7 s |

## 6. Verdict against `docs/testing.md` §11.2

| Criterion | Local result | Verdict |
|---|---|---|
| p95 posting ≤ 500 ms (server time) | receipts 43, transfers 48, weighings 50, dispatches 113 ms | **pass** |
| Error rate < 0.1 % excluding expected 409/429 | 0 errors in 5,546 requests | **pass** |
| Zero reconciliation differences afterwards | 0 | **pass** |
| Worker queue drained within 5 minutes | 0 queued, 0 failed (no worker was running; the HTTP flows enqueue no jobs) | not shown locally; staging run must include the worker, BMR renders and an import |
| Rate limits engage with 429 and `Retry-After` | 20 of 620 refused, `Retry-After: 56` | **pass** (API); sign-in and scan limits have integration tests |
| Page latency (PRD §7: dashboards ≤ 3 s) | under 25 users on the shared 4-core host: dashboard p95 4.3 s, order list p95 6.7 s, lot page p95 4.2 s; one user: all ≤ 1 s | **open**: decide on the staging run. The HTTP latency comes from the server being CPU-bound (one Node process; the machine also ran other suites). Server time per posting is 25–60 ms |
| No connection-pool exhaustion | pool 10, no timeouts or 5xx | pass locally; check against Railway `max_connections` (V-08) |

What the staging run must add: 30 minutes; the worker running (BMR generation 2/min, a 20,000-row
import in parallel, scheduled reports); `Server-Timing` read on the posting routes; Railway CPU
and memory per service. If dashboards stay above 3 s at p95, the next steps are a second `web`
replica (sessions and rate limits are in Postgres, so replicas are stateless) and the KPI
materialised views of `docs/analytics-kpis.md` §4.2 (A-W3A-02).

## 7. Restore drill on the same database

Recorded in runbook §13.6. Dump 3 s (26 MB encrypted); drill 5 s from the offsite copy with
every check passing; a wrong key fails the drill at decryption and is recorded. A drill run
after this release's migration changed reported `migrations_current = false`, as intended: the
dump came from the previous release, so the drill flags the upgrade step (§10 step 5).

## 8. RLS measurement for the ADR-022 decision (evidence only)

On a restored copy of this database, with a non-owner role and policies
`site_id = any(string_to_array(current_setting('app.allowed_site_ids', true), ',')::uuid[])` on
`stock_movements`, `inventory_balances` and `inventory_lots`:

| Query | No RLS (ms) | RLS, NFD only (ms) |
|---|---|---|
| Movement list, site, 30 days, 100 rows | 0.29–0.39 | 0.10 |
| Balances per lot for a site | 1.1 | 1.2–2.4 |
| Stock card of one lot (300 movements) | 1.5–3.1 | 0.65–12.8 (the planner sometimes combines the lot and site indexes) |
| Count of all movements | 10.7–21.4 | 10.7–56.4 |

Behaviour: without `app.allowed_site_ids` the policies return 0 rows (fail closed); with NFD
only, RVS rows are invisible (0); after `COMMIT` a `SET LOCAL` value is gone, so pooled
connections are safe only when every query runs inside a transaction that sets it. The
recommendation is in the W4F final report for the integrator's ADR.
