/**
 * US-9-01: grows a SCRATCH database that already holds the fictional demo seed to A-PRD-12 volumes
 * (docs/PRD.md: ≤500 materials, ≤300 SKUs, ≤200 new lots/month, ≤2,000 stock movements/day,
 * ≤100 batches/month, ≤20 shipments/day), so the load driver (tests/load/run.ts) and the posting
 * harness (tests/load/posting-timing.ts) measure realistic table sizes.
 *
 *   createdb bryels_load_<you>; DATABASE_URL=…/bryels_load_<you> pnpm db:migrate && pnpm db:seed
 *   DATABASE_URL=…/bryels_load_<you> pnpm load:seed --months 3
 *
 * Rows are generated in bulk with SQL from the seeded rows used as templates (fictional names with a
 * LD- prefix). Stock follows the ledger rule: each generated lot is received once, then moved back and
 * forth between two storage locations one unit at a time, and its balances are computed FROM the
 * generated ledger, so `inventory.reconcile` must report zero differences afterwards. Refuses to run
 * unless the database name contains "load", "perf" or "scratch", and never when APP_ENV=production.
 */
import "dotenv/config";
import postgres from "postgres";

const argv = process.argv;
const num = (name: string, d: number) => {
  const i = argv.indexOf(`--${name}`);
  return i > 0 ? Number(argv[i + 1]) : d;
};

const MONTHS = num("months", 3);
const DAYS = Math.round(MONTHS * 30);
const MATERIALS = num("materials", 500);
const SKUS = num("skus", 300);
const LOTS_PER_MONTH = num("lots-per-month", 200);
const MOVES_PER_DAY = num("moves-per-day", 2000);
const BATCHES_PER_MONTH = num("batches-per-month", 100);
const ORDERS_PER_DAY = num("orders-per-day", 20);
const NOTIFICATIONS = num("notifications", 20000);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const dbName = new URL(url).pathname.slice(1);
  if (process.env.APP_ENV === "production" || !/load|perf|scratch/i.test(dbName)) {
    throw new Error(`Refusing to seed load volumes into "${dbName}": use a scratch database whose name contains load, perf or scratch.`);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const t0 = Date.now();
  const step = (msg: string) => console.log(JSON.stringify({ step: msg, seconds: Math.round((Date.now() - t0) / 1000) }));
  try {
    const [org] = await sql<{ id: string }[]>`select id from organizations limit 1`;
    if (!org) throw new Error("Run pnpm db:seed first (the demo rows are the templates).");
    const [done] = await sql<{ n: number }[]>`select count(*)::int as n from inventory_lots where lot_number like 'LD-%'`;
    if (done.n > 0) throw new Error("This database already holds load-test volumes (LD- lots). Recreate it to seed again.");
    const site = async (code: string) => (await sql<{ id: string }[]>`select id from sites where code = ${code}`)[0].id;
    const nfd = await site("NFD");
    const rvs = await site("RVS");
    const locId = async (s: string, code: string) => (await sql<{ id: string }[]>`select id from locations where site_id = ${s} and code = ${code}`)[0].id;
    const locs = { nfdA: await locId(nfd, "A-01"), nfdB: await locId(nfd, "A-02"), rvsA: await locId(rvs, "FG-01"), rvsB: await locId(rvs, "SHP") };
    const [wh] = await sql<{ id: string }[]>`select id from users where email = 'warehouse.nfd@bryels-care.test'`;
    // One transaction: a failure leaves the scratch database as it was (the max: 1 pool keeps one session).
    await sql.unsafe("begin");

    /** Columns of a table, for INSERT … SELECT clones that override a few of them. */
    const cols = async (table: string) => (await sql<{ c: string }[]>`select column_name as c from information_schema.columns where table_schema = 'public' and table_name = ${table} and is_generated = 'NEVER' order by ordinal_position`).map((r) => r.c);
    const clone = async (table: string, from: string, overrides: Record<string, string>) => {
      const c = await cols(table);
      const select = c.map((k) => (k in overrides ? `${overrides[k]} as "${k}"` : `t."${k}"`)).join(", ");
      const r = await sql.unsafe(`insert into "${table}" (${c.map((k) => `"${k}"`).join(", ")}) select ${select} ${from}`);
      return r.count;
    };

    // 1. Materials and SKUs up to the A-PRD-12 ceilings.
    const [m] = await sql<{ n: number }[]>`select count(*)::int as n from materials`;
    const addM = Math.max(0, MATERIALS - m.n);
    await clone("materials", `from (select * from materials order by code limit 1) t, generate_series(1, ${addM}) g(i)`, {
      id: "gen_random_uuid()",
      code: `'LDM-' || lpad(g.i::text, 5, '0')`,
      name: `'Load material ' || g.i || ' (fictional)'`,
    });
    const [k] = await sql<{ n: number }[]>`select count(*)::int as n from skus`;
    const addK = Math.max(0, SKUS - k.n);
    if (addK) await clone("skus", `from (select * from skus order by code limit 1) t, generate_series(1, ${addK}) g(i)`, { id: "gen_random_uuid()", code: `'LDS-' || lpad(g.i::text, 5, '0')`, name: `'Load SKU ' || g.i || ' (fictional)'` });
    step(`materials +${addM}, skus +${addK}`);

    // 2. Lots: LOTS_PER_MONTH per month, 80 % at NFD, created evenly over the period, released, expiring later.
    const lots = Math.round(LOTS_PER_MONTH * MONTHS);
    await sql.unsafe(`create temp table ld_mats as select row_number() over (order by code) as rn, id, base_uom from materials`);
    const [mc] = await sql<{ n: number }[]>`select count(*)::int as n from ld_mats`;
    await clone(
      "inventory_lots",
      `from (select * from inventory_lots where item_kind = 'material' order by lot_number limit 1) t, generate_series(1, ${lots}) g(i) join ld_mats mm on mm.rn = 1 + (g.i % ${mc.n})`,
      {
        id: "gen_random_uuid()",
        site_id: `case when g.i % 5 = 0 then '${rvs}'::uuid else '${nfd}'::uuid end`,
        lot_number: `'LD-' || lpad(g.i::text, 6, '0')`,
        item_kind: `'material'`,
        material_id: "mm.id",
        product_id: "null",
        base_uom: "mm.base_uom",
        supplier_name: `'Laguna Oleo Supply (fictional)'`,
        quality_status: `'released'`,
        expires_on: `(now() + interval '2 years')::date`,
        retest_on: "null",
        source_batch_id: "null",
        origin_lot_id: "null",
        legacy_number: "null",
        created_at: `now() - (interval '1 day' * ${DAYS}) + (interval '1 day' * ${DAYS} * g.i / ${lots})`,
      },
    );
    await sql.unsafe(`create temp table ld_lots as select id, site_id, base_uom, created_at,
      case when site_id = '${nfd}' then '${locs.nfdA}'::uuid else '${locs.rvsA}'::uuid end as loc_a,
      case when site_id = '${nfd}' then '${locs.nfdB}'::uuid else '${locs.rvsB}'::uuid end as loc_b,
      row_number() over (order by lot_number) as rn
      from inventory_lots where lot_number like 'LD-%'`);
    step(`lots +${lots}`);

    // 3. Ledger: one receipt per lot, then transfers of 1 unit A→B, B→A, … spread from the lot's creation to now.
    const moves = MOVES_PER_DAY * DAYS;
    const perLot = Math.max(1, Math.round((moves - lots) / lots));
    await sql.unsafe(`insert into stock_movements (id, organization_id, site_id, movement_type, lot_id, from_location_id, to_location_id, qty_base, base_uom, qty_entered, entered_uom, quality_status_at_posting, correlation_id, source_document_type, posted_by, posted_at)
      select gen_random_uuid(), '${org.id}', l.site_id, 'receipt', l.id, null, l.loc_a, 1000, l.base_uom, 1000, l.base_uom, 'released', gen_random_uuid(), 'load_test_seed', '${wh.id}', l.created_at from ld_lots l`);
    await sql.unsafe(`insert into stock_movements (id, organization_id, site_id, movement_type, lot_id, from_location_id, to_location_id, qty_base, base_uom, qty_entered, entered_uom, quality_status_at_posting, correlation_id, source_document_type, posted_by, posted_at)
      select gen_random_uuid(), '${org.id}', l.site_id, 'transfer', l.id,
             case when j % 2 = 1 then l.loc_a else l.loc_b end, case when j % 2 = 1 then l.loc_b else l.loc_a end,
             1, l.base_uom, 1, l.base_uom, 'released', gen_random_uuid(), 'load_test_seed', '${wh.id}',
             l.created_at + (now() - l.created_at) * j / ${perLot + 1}
        from ld_lots l, generate_series(1, ${perLot}) j`);
    step(`movements +${lots + lots * perLot}`);

    // 4. Projection computed from the generated ledger (never invented): reconciliation must be zero.
    await sql.unsafe(`insert into inventory_balances (id, site_id, lot_id, location_id, qty_base, updated_at)
      select gen_random_uuid(), site_id, lot_id, location_id, sum(delta), now() from (
        select m.site_id, m.lot_id, m.to_location_id as location_id, m.qty_base as delta from stock_movements m join ld_lots l on l.id = m.lot_id where m.to_location_id is not null
        union all
        select m.site_id, m.lot_id, m.from_location_id, -m.qty_base from stock_movements m join ld_lots l on l.id = m.lot_id where m.from_location_id is not null
      ) x group by site_id, lot_id, location_id`);
    step("balances projected from the ledger");

    // 5. One audit event per generated movement (what postMovement writes).
    await sql.unsafe(`insert into audit_events (id, organization_id, site_id, actor_id, action, entity_type, entity_id, occurred_at, after)
      select gen_random_uuid(), m.organization_id, m.site_id, m.posted_by, 'inventory.stock_movement.posted', 'stock_movements', m.id, m.posted_at, jsonb_build_object('loadTest', true)
        from stock_movements m where m.source_document_type = 'load_test_seed'`);
    step("audit events");

    // 6. Sales orders (ORDERS_PER_DAY) cloned round-robin from the seeded orders (each keeps its template's consistent state), with lines.
    const orders = ORDERS_PER_DAY * DAYS;
    await sql.unsafe(`create temp table ld_tpl_orders as select row_number() over (order by created_at, id) as rn, id from sales_orders`);
    const [oc] = await sql<{ n: number }[]>`select count(*)::int as n from ld_tpl_orders`;
    await sql.unsafe(`create temp table ld_orders as select g.i, gen_random_uuid() as new_id, t.id as tpl_id from generate_series(1, ${orders}) g(i) join ld_tpl_orders t on t.rn = 1 + (g.i % ${oc.n})`);
    const soCols = await cols("sales_orders");
    const dateCols = soCols.filter((c) => c.endsWith("_at"));
    const soOver: Record<string, string> = { id: "o.new_id", order_number: `'SO-LD-' || lpad(o.i::text, 6, '0')` };
    for (const c of dateCols) soOver[c] = `t."${c}" - (interval '1 day' * (o.i % ${DAYS}))`;
    if (soCols.includes("idempotency_key")) soOver.idempotency_key = "null";
    await clone("sales_orders", `from ld_orders o join sales_orders t on t.id = o.tpl_id`, soOver);
    const lineCols = await cols("sales_order_lines");
    const lineOver: Record<string, string> = { id: "gen_random_uuid()", sales_order_id: "o.new_id" };
    if (lineCols.includes("idempotency_key")) lineOver.idempotency_key = "null";
    await clone("sales_order_lines", `from ld_orders o join sales_order_lines t on t.sales_order_id = o.tpl_id`, lineOver);
    // Shipments of the cloned shipped orders (header rows; stock issue cost is measured by the posting harness).
    const shCols = await cols("shipments");
    const shOver: Record<string, string> = { id: "gen_random_uuid()", sales_order_id: "o.new_id", shipment_number: `'SH-LD-' || lpad(o.i::text, 6, '0')`, idempotency_key: "null", delivery_receipt_number: `case when t.delivery_receipt_number is null then null else 'DR-LD-' || lpad(o.i::text, 6, '0') end` };
    for (const c of shCols.filter((x) => x.endsWith("_at"))) shOver[c] = `t."${c}" - (interval '1 day' * (o.i % ${DAYS}))`;
    await clone("shipments", `from ld_orders o join shipments t on t.sales_order_id = o.tpl_id`, shOver);
    step(`orders +${orders}`);

    // 7. Batches (BATCHES_PER_MONTH) cloned from released seeded batches, dated over the period, with their current yield record.
    const batches = Math.round(BATCHES_PER_MONTH * MONTHS);
    await sql.unsafe(`create temp table ld_tpl_batches as select row_number() over (order by batch_number) as rn, id from batches where status in ('released','awaiting_qc','completed','closed')`);
    const [bc] = await sql<{ n: number }[]>`select count(*)::int as n from ld_tpl_batches`;
    if (bc.n > 0) {
      await sql.unsafe(`create temp table ld_batches as select g.i, gen_random_uuid() as new_id, t.id as tpl_id from generate_series(1, ${batches}) g(i) join ld_tpl_batches t on t.rn = 1 + (g.i % ${bc.n})`);
      const bCols = await cols("batches");
      const bOver: Record<string, string> = { id: "b.new_id", batch_number: `'B-LD-' || lpad(b.i::text, 5, '0')`, output_lot_id: "null" };
      for (const c of bCols.filter((x) => x.endsWith("_at"))) bOver[c] = `t."${c}" - (interval '1 day' * (b.i % ${DAYS}))`;
      await clone("batches", `from ld_batches b join batches t on t.id = b.tpl_id`, bOver);
      const yCols = await cols("yield_records");
      const yOver: Record<string, string> = { id: "gen_random_uuid()", batch_id: "b.new_id" };
      for (const c of yCols.filter((x) => x.endsWith("_at"))) yOver[c] = `t."${c}" - (interval '1 day' * (b.i % ${DAYS}))`;
      if (yCols.includes("idempotency_key")) yOver.idempotency_key = "null";
      await clone("yield_records", `from ld_batches b join yield_records t on t.batch_id = b.tpl_id and t.is_current`, yOver);
    }
    step(`batches +${bc.n > 0 ? batches : 0}`);

    // 8. Notifications (read and unread) for the dashboard bell and the retention sweep.
    await sql.unsafe(`insert into notifications (id, organization_id, site_id, recipient_user_id, kind, severity, title, body, created_at, read_at)
      select gen_random_uuid(), '${org.id}', '${nfd}', u.id, 'load_test', 'info', 'Load test notice ' || g.i, 'Fictional', now() - (interval '1 day' * (g.i % ${DAYS})), case when g.i % 3 = 0 then null else now() end
        from generate_series(1, ${NOTIFICATIONS}) g(i) join (select id, row_number() over (order by email) as rn from users where status = 'active') u on u.rn = 1 + (g.i % 15)`);
    step(`notifications +${NOTIFICATIONS}`);

    await sql.unsafe("commit");
    await sql.unsafe("analyze");
    const sizes = await sql<{ t: string; n: string }[]>`select relname as t, n_live_tup::text as n from pg_stat_user_tables where relname in ('materials','skus','inventory_lots','stock_movements','inventory_balances','audit_events','sales_orders','sales_order_lines','shipments','batches','notifications') order by relname`;
    const [db] = await sql<{ size: string }[]>`select pg_size_pretty(pg_database_size(current_database())) as size`;
    console.log(JSON.stringify({ done: true, seconds: Math.round((Date.now() - t0) / 1000), databaseSize: db.size, rows: Object.fromEntries(sizes.map((r) => [r.t, Number(r.n)])) }, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
