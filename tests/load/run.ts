/**
 * US-9-01 load driver (docs/testing.md §11.2, method and results in docs/load-test-report.md).
 *
 *   pnpm build && DATABASE_URL=<scratch> APP_ORIGIN=http://localhost:3406 pnpm next start -p 3406
 *   DATABASE_URL=<scratch> pnpm load:run --base http://localhost:3406 --vus 25 --duration 300 [--out file.json]
 *
 * Virtual users sign in through the real sign-in server action (staggered so 25 sign-ins stay under the
 * per-address limit of 20/min), then loop over their role's flows with 2–5 s think time:
 *   warehouse (10)  scan look-up (server action) → lot page → stock move (/api/v1 transfer) → movement list
 *   production (5)  production board → batch workspace (weighing screen) → staging list
 *   sales (4)       order list → order page → order board
 *   managers (4)    dashboard → analytics → a report run (stock, movements, orders)
 *   QA (2)          QA queue → batch release page
 * Mid-run, one burst of 10 parallel stock moves per warehouse user (bursts of 10/s, §11.2). After the
 * run: the API rate limit is checked to answer 429 with Retry-After, the ledger is reconciled against the
 * projection (must be zero rows) and the job queue is read. The database is only read for fixtures and
 * the checks; every change goes through the HTTP API like a browser.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { RECONCILIATION_SQL } from "../../scripts/backup-lib";
import { Client, type Sample, actionIds } from "./http";

const argv = process.argv;
const opt = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i > 0 ? argv[i + 1] : d;
};
const BASE = opt("base", "http://localhost:3406");
const VUS = Number(opt("vus", "25"));
const DURATION = Number(opt("duration", "300")) * 1000;
const OUT = opt("out", "");
const PASSWORD = opt("password", "demo1234");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const think = () => sleep(2000 + Math.random() * 3000);
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

type Role = "warehouse" | "production" | "sales" | "manager" | "qa";
const PLAN: { role: Role; emails: string[]; share: number }[] = [
  { role: "warehouse", emails: ["warehouse.nfd@bryels-care.test", "warehouse2.nfd@bryels-care.test"], share: 10 },
  { role: "production", emails: ["operator.nfd@bryels-care.test", "checker.nfd@bryels-care.test"], share: 5 },
  { role: "sales", emails: ["sales@bryels-care.test", "sales2@bryels-care.test"], share: 4 },
  { role: "manager", emails: ["manager.nfd@bryels-care.test", "owner@bryels-care.test", "planner.nfd@bryels-care.test"], share: 4 },
  { role: "qa", emails: ["qa.nfd@bryels-care.test", "qa.lead@bryels-care.test"], share: 2 },
];

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, i)]);
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL (the scratch database the server uses) is not set");
  const sql = postgres(dbUrl, { max: 2, onnotice: () => {} });
  const ids = actionIds();
  const signInId = ids.get("app/(auth)/sign-in/actions.ts#signIn");
  const scanId = ids.get("app/(app)/inventory/scan/actions.ts#scanCardAction");
  if (!signInId || !scanId) throw new Error("Server action ids not found: run `pnpm build` first (the driver reads .next/server/server-reference-manifest.json).");

  // Fixtures (read only).
  const [nfd] = await sql<{ id: string }[]>`select id from sites where code = 'NFD'`;
  const locs = await sql<{ id: string; code: string }[]>`select id, code from locations where site_id = ${nfd.id} and code in ('A-01','A-02')`;
  const a01 = locs.find((l) => l.code === "A-01")!.id;
  const a02 = locs.find((l) => l.code === "A-02")!.id;
  const lots = await sql<{ id: string; lot_number: string }[]>`select l.id, l.lot_number from inventory_lots l where l.site_id = ${nfd.id} and l.lot_number like 'LD-%' and exists (select 1 from inventory_balances b where b.lot_id = l.id and b.location_id = ${a01} and b.qty_base >= 100) order by l.lot_number`;
  const batches = (await sql<{ id: string }[]>`select id from batches where site_id = ${nfd.id} order by created_at desc limit 50`).map((r) => r.id);
  const orders = (await sql<{ id: string }[]>`select id from sales_orders where site_id = ${nfd.id} order by created_at desc limit 200`).map((r) => r.id);
  if (lots.length < VUS || !batches.length || !orders.length) throw new Error("Seed the scratch database first: pnpm db:seed, then pnpm load:seed.");

  const samples: Sample[] = [];
  const record = (s: Sample) => samples.push(s);
  const t0 = Date.now();
  const deadline = t0 + DURATION;

  async function vu(n: number, role: Role, email: string) {
    await sleep(n * 3200); // ≤ 20 sign-ins per minute from one address (setting platform.rate_limits)
    const c = new Client(BASE, record);
    await c.formAction("sign_in", "/sign-in", signInId!, { email, password: PASSWORD });
    if (!c.hasSession()) return;
    const myLots = lots.filter((_, i) => i % VUS === n);
    const dir = new Map<string, boolean>();
    const move = (lot: { id: string }, name = "stock_move") => {
      const forward = !(dir.get(lot.id) ?? false);
      dir.set(lot.id, forward);
      return c.command(name, "/api/v1/inventory/movements/transfer", { commandId: uuidv7(), siteId: nfd.id, payload: { lotId: lot.id, fromLocationId: forward ? a01 : a02, toLocationId: forward ? a02 : a01, qty: "1", reason: "load test (fictional)" } }, randomUUID());
    };
    let iter = 0;
    let burst = false;
    while (Date.now() < deadline) {
      iter += 1;
      if (role === "warehouse") {
        const lot = pick(myLots);
        await c.action("scan_lookup", "/inventory/scan", scanId!, JSON.stringify([`BC:LOT:${lot.lot_number}`]), "text/plain;charset=UTF-8");
        await c.page("lot_page", `/inventory/${lot.id}`);
        await move(lot);
        if (iter % 5 === 0) await c.page("movement_list", "/inventory/movements");
        if (!burst && Date.now() > t0 + DURATION / 2) {
          burst = true;
          await Promise.all(Array.from({ length: 10 }, (_, i) => move(myLots[i % myLots.length], "stock_move_burst")));
        }
      } else if (role === "production") {
        await c.page("production_board", "/production/board");
        await c.page("batch_workspace", `/production/${pick(batches)}`);
        await c.page("staging_list", "/production/staging");
      } else if (role === "sales") {
        await c.page("order_list", "/sales");
        await c.page("order_page", `/sales/${pick(orders)}`);
        if (iter % 3 === 0) await c.page("order_board", "/sales/board");
      } else if (role === "manager") {
        await c.page("dashboard", "/dashboard");
        if (iter % 2 === 0) await c.page("analytics", "/analytics");
        await c.page("report_run", `/reports/${pick(["RPT-INV-STOCK", "RPT-INV-MOVEMENTS", "RPT-SAL-ORDERS", "RPT-PRD-BATCHES"])}`);
      } else {
        await c.page("qa_queue", "/quality");
        await c.page("qa_batch_release", `/quality/batches/${pick(batches)}`);
      }
      await think();
    }
  }

  const vus: Promise<void>[] = [];
  let n = 0;
  for (const p of PLAN) {
    const count = Math.round((p.share / 25) * VUS);
    for (let i = 0; i < count && n < VUS; i++, n++) vus.push(vu(n, p.role, p.emails[i % p.emails.length]));
  }
  console.log(JSON.stringify({ msg: "load started", base: BASE, vus: n, durationSeconds: DURATION / 1000, lots: lots.length }));
  await Promise.all(vus);
  const loadSeconds = Math.round((Date.now() - t0) / 1000);

  // Rate limit check: one user, more than the per-minute API limit in a few seconds.
  const rl = new Client(BASE, () => {});
  await rl.formAction("sign_in", "/sign-in", signInId, { email: "auditor@bryels-care.test", password: PASSWORD });
  const [{ api }] = await sql<{ api: number }[]>`select coalesce((select (value->>'api_per_minute')::int from settings where key = 'platform.rate_limits' limit 1), 600) as api`;
  let limited = 0;
  let retryAfter: string | null = null;
  for (let i = 0; i < api + 20; i += 20) {
    const rs = await Promise.all(Array.from({ length: 20 }, () => fetch(`${BASE}/api/v1/inventory/availability?siteId=${nfd.id}&q=LD-000001`, { headers: { cookie: rl.cookieHeader() } })));
    for (const r of rs) {
      if (r.status === 429) {
        limited += 1;
        retryAfter ??= r.headers.get("retry-after");
      }
      await r.arrayBuffer();
    }
  }

  const [rec] = await sql.unsafe<{ n: number }[]>(RECONCILIATION_SQL);
  const [q] = await sql<{ queued: number; failed: number }[]>`select count(*) filter (where status in ('queued','running'))::int as queued, count(*) filter (where status = 'failed')::int as failed from background_jobs`;
  await sql.end();

  const byName = new Map<string, Sample[]>();
  for (const s of samples) byName.set(s.name, [...(byName.get(s.name) ?? []), s]);
  const endpoints = [...byName.entries()].map(([name, xs]) => {
    const ms = xs.map((x) => x.ms).sort((a, b) => a - b);
    const errors = xs.filter((x) => !x.ok && !x.expected).length;
    return { name, count: xs.length, p50: percentile(ms, 50), p95: percentile(ms, 95), p99: percentile(ms, 99), max: Math.round(ms[ms.length - 1] ?? 0), errors, expected409or429: xs.filter((x) => x.expected).length, statuses: [...new Set(xs.map((x) => x.status))].sort() };
  });
  const total = samples.length;
  const errors = samples.filter((s) => !s.ok && !s.expected).length;
  const summary = {
    base: BASE,
    vus: n,
    loadSeconds,
    requests: total,
    requestsPerSecond: Math.round((total / loadSeconds) * 10) / 10,
    errorRatePct: total ? Math.round((errors / total) * 10000) / 100 : 0,
    endpoints: endpoints.sort((a, b) => a.name.localeCompare(b.name)),
    rateLimit: { apiPerMinute: api, refusedWith429: limited, retryAfter },
    reconciliationDifferences: rec.n,
    jobs: q,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (OUT) writeFileSync(OUT, JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
