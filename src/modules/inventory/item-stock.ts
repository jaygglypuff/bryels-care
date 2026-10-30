import "server-only";
import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { AuthContext, SiteRef } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { SECTION_LABELS, SECTION_ORDER, lookupLabels, sectionSql, type LocationSection } from "@/modules/masterdata";
import { manilaToday } from "./availability";
import { fmtStock, fmtStockFriendly as friendly, lowStockItems } from "./low-stock";
import { OPEN_ALLOCATION_ORDER_STATUSES } from "./reservations";
import { lotState, type LotState } from "./stock-by-item";

/**
 * Item page read model (owner question 2026-10-30: "Palm oil can have different lots: how much is the total?
 * From which suppliers and brands? How much? What is expiring?"). Everything about ONE material or product:
 * totals by status, the split by supplier and brand (materials) or by batch (products), what expires in the
 * next 30 / 60 / 90 days, where it is stored, every lot in the order to use it, and the last movements as
 * plain sentences.
 *
 * Reads only. Scope (server-side):
 * - `inventory.lot.view` (403 otherwise) and the caller's CURRENT site (requireSite) by default;
 * - `all: true` = every site the caller is assigned to AND holds `inventory.lot.view` at; only honoured when
 *   the caller has more than one site (same rule as the dashboards' "All my sites", `resolveScope`).
 *   Another site's lots are never counted otherwise.
 * - The minimum stock and the "below minimum" flag need `inventory.balance.view` at the site (as in
 *   `lowStockItems`); without it they are null / false.
 *
 * Status buckets (one per lot, `lotState`): released and in date = Ready to use; quarantine = Waiting for
 * check; on_hold = On hold; expired (status or date), rejected, recalled = Do not use. A lot is usable through
 * the end of its expiry day (A-W1A-04). "Set aside" = active, unexpired reservations plus open sales
 * allocations of open orders on READY lots only (as in `availabilityRows`); Free to use = Ready − Set aside,
 * never below zero. Quantities are decimal.js strings in the item's base unit; `…Text` are friendly
 * (25 kg, not 25,000 g).
 */

export type ItemKind = "material" | "product";

export type ItemStockInput = {
  kind: string;
  id: string;
  /** "All my sites" (only with more than one allowed site). */
  all?: boolean;
  /** Business date for expiry (YYYY-MM-DD, Asia/Manila); tests pin it. Default: today in Manila. */
  asOf?: string;
};

export type Amount = { qty: string; text: string };

export type ItemLot = {
  lotId: string;
  lotNumber: string;
  siteCode: string;
  supplierName: string | null;
  brand: string | null;
  supplierLotNumber: string | null;
  batchNumber: string | null;
  /** Received date (materials) or made date (products). */
  dateOn: string | null;
  expiresOn: string | null;
  daysLeft: number | null;
  state: LotState;
  qty: string;
  qtyText: string;
  setAside: string;
  /** Part of `setAside` promised to customer orders (open allocations). */
  promised: string;
  /** "A-01 Oil rack (10 kg), B-02 (5 kg)". */
  where: string;
};

export type SupplierRow = {
  /** Materials: supplier name; products: batch number. null = not recorded. */
  supplierName: string | null;
  brand: string | null;
  batchNumber: string | null;
  madeOn: string | null;
  lots: number;
  ready: Amount;
  waiting: Amount;
  onHold: Amount;
  doNotUse: Amount;
  total: Amount;
  nearestExpiry: string | null;
  nearestDaysLeft: number | null;
};

export type ExpiringLot = { lotId: string; lotNumber: string; supplierName: string | null; brand: string | null; batchNumber: string | null; expiresOn: string; daysLeft: number; state: LotState; qty: string; qtyText: string; where: string };
export type ExpiryBucket = { key: "expired" | "d30" | "d60" | "d90"; label: string; total: Amount; lots: ExpiringLot[] };

export type PlaceRow = { section: LocationSection; sectionLabel: string; total: Amount; locations: { locationId: string; code: string; name: string; siteCode: string; qty: string; qtyText: string; lots: number }[] };

export type ItemMovement = { id: string; postedAt: string; sentence: string; lotId: string; lotNumber: string; by: string | null };

export type ItemStock = {
  item: {
    kind: ItemKind;
    id: string;
    code: string;
    name: string;
    unit: string;
    /** Material category label or product family. */
    group: string | null;
    usualBrand: string | null;
    shelfLifeDays: number | null;
    storageConditions: string | null;
  };
  scope: { all: boolean; sites: SiteRef[]; label: string; canAll: boolean };
  asOf: string;
  minimum: Amount | null;
  belowMinimum: boolean;
  totals: {
    inStock: Amount;
    ready: Amount;
    waiting: Amount;
    onHold: Amount;
    /** expired + bad */
    doNotUse: Amount;
    expired: Amount;
    /** Rejected or recalled. */
    bad: Amount;
    /** Reservations + open order allocations on ready lots. */
    setAside: Amount;
    /** The part of setAside promised to customer orders. */
    promised: Amount;
    free: Amount;
    expiringSoon: Amount;
  };
  /** Products only, with `sales.sales_order.view` at a site in view (else null): open customer orders not yet set aside, and what is left to sell. */
  orders: { notSetAside: Amount; freeToSell: Amount } | null;
  /** Materials: kg per supplier and per brand (any supplier); both add up to the total. */
  bySupplierTotal: { name: string | null; lots: number; total: Amount }[];
  byBrandTotal: { name: string | null; lots: number; total: Amount }[];
  bySupplier: SupplierRow[];
  expiring: ExpiryBucket[];
  places: PlaceRow[];
  lots: ItemLot[];
  movements: ItemMovement[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BLOCKED: LotState[] = ["expired", "rejected", "recalled"];
const READY: LotState[] = ["ok", "expiring"];
/** Order to use: ready first, then waiting, on hold, and blocked last. */
const USE_ORDER: Record<LotState, number> = { ok: 0, expiring: 0, waiting: 1, on_hold: 2, expired: 3, rejected: 3, recalled: 3 };

/** "Oils rack A-01" when the name already says the code, else "Oils rack (A-01)", or just the code. */
function placeName(code: string, name: string | null): string {
  if (!name) return code;
  return name.includes(code) ? name : `${name} (${code})`;
}

const notFound = () => new DomainError("not_found", "Item not found.");

/** Which sites the read covers (see the header comment). */
export function itemStockScope(ctx: AuthContext, wantAll: boolean): ItemStock["scope"] {
  const permitted = ctx.allowedSites.filter((s) => ctx.canAt("inventory.lot.view", s.id));
  const canAll = permitted.length > 1;
  const all = wantAll && canAll;
  const sites = all ? permitted : [ctx.currentSite];
  for (const s of sites) ctx.requireSite(s.id);
  return { all, sites, canAll, label: all ? `All my sites (${sites.map((s) => s.code).join(", ")})` : ctx.currentSite.name };
}

/** Plain sentence for one movement ("Received 25 kg from Laguna Oleo"). Pure; unit-tested. */
export function movementSentence(m: {
  movementType: string;
  qtyText: string;
  supplierName?: string | null;
  docType?: string | null;
  docNumber?: string | null;
  fromName?: string | null;
  toName?: string | null;
  reason?: string | null;
}): string {
  const q = m.qtyText;
  const doc = m.docNumber ? ` ${m.docNumber}` : "";
  const isBatch = m.docType === "batch" || m.docType === "batch_retained_sample";
  switch (m.movementType) {
    case "receipt":
      if (m.docType === "transfer_in") return `Received ${q} from another site`;
      if (m.docType === "opening_balance") return `Started with ${q} (first count)`;
      return m.supplierName ? `Received ${q} from ${m.supplierName}` : `Received ${q}`;
    case "output":
      return `Made ${q}${m.docNumber ? ` in batch${doc}` : ""}`;
    case "consumption":
      if (isBatch) return `Used ${q}${m.docNumber ? ` in batch${doc}` : " in a batch"}`;
      if (m.docType === "inspection") return `Used ${q} for a quality test`;
      return `Used ${q}`;
    case "transfer":
      return `Moved ${q}${m.toName ? ` to ${m.toName}` : ""}`;
    case "issue":
      if (m.docType === "maintenance_work_order") return `Gave out ${q} for maintenance`;
      return `Sent ${q} out${m.docNumber ? ` (${m.docNumber.trim()})` : ""}`;
    case "shipment":
      return `Shipped ${q} to a customer${m.docNumber ? ` (${m.docNumber.trim()})` : ""}`;
    case "return":
      return `Got ${q} back from a customer`;
    case "adjustment":
      return m.toName ? `Added ${q} (stock correction)` : `Took away ${q} (stock correction)`;
    case "reversal":
      return `Undid an earlier entry of ${q}`;
    default:
      return `${m.movementType} ${q}`;
  }
}

type LotLocRow = {
  lot_id: string;
  lot_number: string;
  site_id: string;
  supplier_name: string | null;
  brand: string | null;
  supplier_lot_number: string | null;
  batch_number: string | null;
  manufactured_on: string | null;
  created_on: string;
  quality_status: string;
  expires_on: string | null;
  days_left: number | null;
  location_id: string;
  location_code: string;
  location_name: string | null;
  section: string;
  qty: string;
};

export async function getItemStock(ctx: AuthContext, input: ItemStockInput): Promise<ItemStock> {
  ctx.require("inventory.lot.view");
  ctx.requireSite(ctx.currentSiteId);
  if (input.kind !== "material" && input.kind !== "product") throw notFound();
  if (typeof input.id !== "string" || !UUID.test(input.id)) throw notFound();
  const kind: ItemKind = input.kind;
  const asOf = input.asOf ?? manilaToday();
  if (!DATE_RE.test(asOf)) throw new DomainError("validation", "As-of date must be YYYY-MM-DD.", { field: "asOf" });
  const scope = itemStockScope(ctx, !!input.all);
  const siteIds = scope.sites.map((s) => s.id);
  const inSites = sql.join(siteIds.map((s) => sql`${s}::uuid`), sql`, `);
  const siteCode = new Map(scope.sites.map((s) => [s.id, s.code]));

  // ---- header (organisation master data) ----
  const head = (
    kind === "material"
      ? await db.execute(sql`
          select m.id, m.code, m.name, m.base_uom as unit, m.category as grp, m.brand as usual_brand,
                 m.shelf_life_days, m.storage_conditions
            from materials m
           where m.id = ${input.id}::uuid and m.organization_id = ${ctx.organizationId}::uuid`)
      : await db.execute(sql`
          select p.id, p.sku_code as code, p.name, p.base_uom as unit, p.family as grp, null as usual_brand,
                 p.shelf_life_days, p.storage_conditions
            from products p
           where p.id = ${input.id}::uuid and p.organization_id = ${ctx.organizationId}::uuid`)
  ) as unknown as { id: string; code: string; name: string; unit: string; grp: string | null; usual_brand: string | null; shelf_life_days: number | null; storage_conditions: string | null }[];
  const h = head[0];
  if (!h) throw notFound();
  // Category code → the owner's label (the editable list, or its defaults while the list is empty).
  if (kind === "material" && h.grp) h.grp = (await lookupLabels(db, ctx.organizationId, "material_category")).get(h.grp) ?? h.grp;
  const unit = h.unit;
  const amt = (d: Decimal.Value): Amount => ({ qty: new Decimal(d).toString(), text: friendly(d, unit) });
  const itemCol = kind === "material" ? sql`lot.material_id` : sql`lot.product_id`;

  // ---- stock per lot × location in scope ----
  const rows = (await db.execute(sql`
    select lot.id as lot_id, lot.lot_number, lot.site_id, lot.supplier_name, lot.brand, lot.supplier_lot_number,
           bt.batch_number, lot.manufactured_on::text as manufactured_on,
           (lot.created_at at time zone 'Asia/Manila')::date::text as created_on,
           lot.quality_status, lot.expires_on::text as expires_on, (lot.expires_on - ${asOf}::date) as days_left,
           l.id as location_id, l.code as location_code, nullif(l.name, '') as location_name,
           ${sectionSql("l", "w")} as section, b.qty_base::text as qty
      from inventory_balances b
      join inventory_lots lot on lot.id = b.lot_id
      join locations l on l.id = b.location_id
      join warehouses w on w.id = l.warehouse_id
      left join batches bt on bt.id = lot.source_batch_id
     where b.site_id in (${inSites}) and lot.site_id in (${inSites}) and b.qty_base > 0
       and lot.organization_id = ${ctx.organizationId}::uuid and lot.item_kind = ${kind} and ${itemCol} = ${input.id}::uuid
     order by lot.expires_on asc nulls last, lot.created_at asc, l.code asc`)) as unknown as LotLocRow[];

  const lotIds = [...new Set(rows.map((r) => r.lot_id))];
  const inLots = lotIds.length ? sql.join(lotIds.map((s) => sql`${s}::uuid`), sql`, `) : null;

  // ---- set aside (reservations + open order allocations) per lot ----
  const setAsideByLot = new Map<string, Decimal>();
  const promisedByLot = new Map<string, Decimal>();
  if (inLots) {
    const openStatuses = sql.join(OPEN_ALLOCATION_ORDER_STATUSES.map((s) => sql`${s}`), sql`, `);
    const res = (await db.execute(sql`
      select lot_id, sum(qty)::text as qty, coalesce(sum(qty) filter (where src = 'order'), 0)::text as promised from (
        select r.lot_id, r.qty_base as qty, 'reservation' as src from stock_reservations r
         where r.lot_id in (${inLots}) and r.site_id in (${inSites}) and r.status = 'active' and (r.expires_at is null or r.expires_at > now())
        union all
        select a.lot_id, a.qty_units, 'order' from stock_allocations a
          join sales_order_lines sol on sol.id = a.sales_order_line_id
          join sales_orders so on so.id = sol.sales_order_id
         where a.lot_id in (${inLots}) and a.status = 'open' and so.status in (${openStatuses}) and so.site_id in (${inSites})
      ) x group by lot_id`)) as unknown as { lot_id: string; qty: string; promised: string }[];
    for (const r of res) {
      setAsideByLot.set(r.lot_id, new Decimal(r.qty));
      promisedByLot.set(r.lot_id, new Decimal(r.promised));
    }
  }

  // ---- lots ----
  type Acc = ItemLot & { qtyD: Decimal; locs: { name: string; qty: Decimal }[]; createdOn: string; manufacturedOn: string | null };
  const byLot = new Map<string, Acc>();
  for (const r of rows) {
    const daysLeft = r.days_left === null ? null : Number(r.days_left);
    let a = byLot.get(r.lot_id);
    if (!a) {
      const state = lotState(r.quality_status, daysLeft);
      a = {
        lotId: r.lot_id,
        lotNumber: r.lot_number,
        siteCode: siteCode.get(r.site_id) ?? "",
        supplierName: r.supplier_name,
        brand: r.brand,
        supplierLotNumber: r.supplier_lot_number,
        batchNumber: r.batch_number,
        dateOn: kind === "product" ? (r.manufactured_on ?? r.created_on) : r.created_on,
        expiresOn: r.expires_on,
        daysLeft,
        state,
        qty: "0",
        qtyText: "",
        setAside: "0",
        promised: "0",
        where: "",
        qtyD: new Decimal(0),
        locs: [],
        createdOn: r.created_on,
        manufacturedOn: r.manufactured_on,
      };
      byLot.set(r.lot_id, a);
    }
    a.qtyD = a.qtyD.plus(r.qty);
    a.locs.push({ name: placeName(r.location_code, r.location_name), qty: new Decimal(r.qty) });
  }
  const accs = [...byLot.values()];
  for (const a of accs) {
    a.qty = a.qtyD.toString();
    a.qtyText = fmtStock(a.qtyD, unit);
    const sa = READY.includes(a.state) ? Decimal.min(setAsideByLot.get(a.lotId) ?? 0, a.qtyD) : new Decimal(0);
    a.setAside = sa.toString();
    a.promised = (READY.includes(a.state) ? Decimal.min(promisedByLot.get(a.lotId) ?? 0, sa) : new Decimal(0)).toString();
    a.where = a.locs.length === 1 ? a.locs[0].name : a.locs.map((l) => `${l.name} (${fmtStock(l.qty, unit)})`).join(", ");
  }
  accs.sort(
    (x, y) =>
      USE_ORDER[x.state] - USE_ORDER[y.state] ||
      (x.expiresOn ?? "9999-12-31").localeCompare(y.expiresOn ?? "9999-12-31") ||
      x.createdOn.localeCompare(y.createdOn) ||
      x.lotNumber.localeCompare(y.lotNumber),
  );
  const lots: ItemLot[] = accs.map(({ qtyD: _q, locs: _l, createdOn: _c, manufacturedOn: _m, ...l }) => l);

  // ---- totals ----
  const sum = (pred: (l: ItemLot) => boolean, f: (l: ItemLot) => Decimal.Value = (l) => l.qty) => lots.filter(pred).reduce((t, l) => t.plus(f(l)), new Decimal(0));
  const ready = sum((l) => READY.includes(l.state));
  const setAside = sum((l) => READY.includes(l.state), (l) => l.setAside);
  const free = Decimal.max(ready.minus(setAside), 0);
  const expiringSoon = sum((l) => !BLOCKED.includes(l.state) && l.daysLeft !== null && l.daysLeft >= 0 && l.daysLeft <= 30);
  const totals: ItemStock["totals"] = {
    inStock: amt(sum(() => true)),
    ready: amt(ready),
    waiting: amt(sum((l) => l.state === "waiting")),
    onHold: amt(sum((l) => l.state === "on_hold")),
    doNotUse: amt(sum((l) => BLOCKED.includes(l.state))),
    expired: amt(sum((l) => l.state === "expired")),
    bad: amt(sum((l) => l.state === "rejected" || l.state === "recalled")),
    setAside: amt(setAside),
    promised: amt(sum((l) => READY.includes(l.state), (l) => l.promised)),
    free: amt(free),
    expiringSoon: amt(expiringSoon),
  };

  // ---- customer orders not yet set aside (products; needs sales.sales_order.view) ----
  let orders: ItemStock["orders"] = null;
  const salesSites = siteIds.filter((s) => ctx.canAt("sales.sales_order.view", s));
  if (kind === "product" && salesSites.length) {
    const openStatuses = sql.join(OPEN_ALLOCATION_ORDER_STATUSES.map((s) => sql`${s}`), sql`, `);
    const inSales = sql.join(salesSites.map((s) => sql`${s}::uuid`), sql`, `);
    // Per open line: ordered − (open + fulfilled allocations), never below 0. Confirmed orders with no allocation count in full.
    const o = (await db.execute(sql`
      select coalesce(sum(greatest(sol.qty_units - coalesce(al.q, 0), 0)), 0)::text as q
        from sales_order_lines sol
        join sales_orders so on so.id = sol.sales_order_id
        left join (select sales_order_line_id, sum(qty_units) as q from stock_allocations where status in ('open', 'fulfilled') group by 1) al on al.sales_order_line_id = sol.id
       where so.organization_id = ${ctx.organizationId}::uuid and so.site_id in (${inSales}) and so.status in (${openStatuses})
         and sol.product_id = ${input.id}::uuid`)) as unknown as { q: string }[];
    const notSetAside = new Decimal(o[0]?.q ?? 0);
    orders = { notSetAside: amt(notSetAside), freeToSell: amt(Decimal.max(free.minus(notSetAside), 0)) };
  }

  // ---- totals per supplier and per brand (materials) ----
  const totalsBy = (key: (l: ItemLot) => string | null) => {
    const m = new Map<string | null, ItemLot[]>();
    for (const l of lots) m.set(key(l), [...(m.get(key(l)) ?? []), l]);
    return [...m.entries()]
      .map(([name, ls]) => ({ name, lots: ls.length, total: amt(ls.reduce((t, l) => t.plus(l.qty), new Decimal(0))) }))
      .sort((a, b) => new Decimal(b.total.qty).comparedTo(a.total.qty) || (a.name ?? "\uffff").localeCompare(b.name ?? "\uffff"));
  };
  const bySupplierTotal = kind === "material" ? totalsBy((l) => l.supplierName) : [];
  const byBrandTotal = kind === "material" ? totalsBy((l) => l.brand) : [];

  // ---- by supplier and brand (materials) / by batch (products) ----
  const groups = new Map<string, ItemLot[]>();
  for (const l of lots) {
    const key = kind === "material" ? `${l.supplierName ?? ""}\u0000${l.brand ?? ""}` : `${l.batchNumber ?? ""}\u0000${l.dateOn ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const bySupplier: SupplierRow[] = [...groups.values()].map((ls) => {
    const s = (pred: (l: ItemLot) => boolean) => ls.filter(pred).reduce((t, l) => t.plus(l.qty), new Decimal(0));
    const dated = ls.filter((l) => l.expiresOn && !BLOCKED.includes(l.state)).sort((a, b) => a.expiresOn!.localeCompare(b.expiresOn!))[0] ?? ls.filter((l) => l.expiresOn).sort((a, b) => a.expiresOn!.localeCompare(b.expiresOn!))[0];
    return {
      supplierName: kind === "material" ? ls[0].supplierName : null,
      brand: kind === "material" ? ls[0].brand : null,
      batchNumber: kind === "product" ? ls[0].batchNumber : null,
      madeOn: kind === "product" ? ls[0].dateOn : null,
      lots: ls.length,
      ready: amt(s((l) => READY.includes(l.state))),
      waiting: amt(s((l) => l.state === "waiting")),
      onHold: amt(s((l) => l.state === "on_hold")),
      doNotUse: amt(s((l) => BLOCKED.includes(l.state))),
      total: amt(s(() => true)),
      nearestExpiry: dated?.expiresOn ?? null,
      nearestDaysLeft: dated?.daysLeft ?? null,
    };
  });
  bySupplier.sort((a, b) =>
    kind === "product"
      ? (a.madeOn ?? "").localeCompare(b.madeOn ?? "")
      : new Decimal(b.total.qty).comparedTo(a.total.qty) || (a.supplierName ?? "￿").localeCompare(b.supplierName ?? "￿") || (a.brand ?? "").localeCompare(b.brand ?? ""),
  );

  // ---- expiring ----
  const bucketDefs: { key: ExpiryBucket["key"]; label: string; test: (l: ItemLot) => boolean }[] = [
    { key: "expired", label: "Already expired", test: (l) => l.state === "expired" },
    { key: "d30", label: "Within 30 days", test: (l) => !BLOCKED.includes(l.state) && l.daysLeft !== null && l.daysLeft >= 0 && l.daysLeft <= 30 },
    { key: "d60", label: "In 31 to 60 days", test: (l) => !BLOCKED.includes(l.state) && l.daysLeft !== null && l.daysLeft > 30 && l.daysLeft <= 60 },
    { key: "d90", label: "In 61 to 90 days", test: (l) => !BLOCKED.includes(l.state) && l.daysLeft !== null && l.daysLeft > 60 && l.daysLeft <= 90 },
  ];
  const byExpiry = [...lots].filter((l) => l.expiresOn).sort((a, b) => a.expiresOn!.localeCompare(b.expiresOn!));
  const expiring: ExpiryBucket[] = bucketDefs.map((d) => {
    const ls = byExpiry.filter(d.test);
    return {
      key: d.key,
      label: d.label,
      total: amt(ls.reduce((t, l) => t.plus(l.qty), new Decimal(0))),
      lots: ls.map((l) => ({ lotId: l.lotId, lotNumber: l.lotNumber, supplierName: l.supplierName, brand: l.brand, batchNumber: l.batchNumber, expiresOn: l.expiresOn!, daysLeft: l.daysLeft ?? 0, state: l.state, qty: l.qty, qtyText: l.qtyText, where: l.where })),
    };
  });

  // ---- where it is ----
  const placeMap = new Map<string, { section: LocationSection; locs: Map<string, { code: string; name: string; siteCode: string; qty: Decimal; lots: Set<string> }> }>();
  for (const r of rows) {
    const section = r.section as LocationSection;
    const p = placeMap.get(section) ?? { section, locs: new Map() };
    const l = p.locs.get(r.location_id) ?? { code: r.location_code, name: r.location_name ?? r.location_code, siteCode: siteCode.get(r.site_id) ?? "", qty: new Decimal(0), lots: new Set<string>() };
    l.qty = l.qty.plus(r.qty);
    l.lots.add(r.lot_id);
    p.locs.set(r.location_id, l);
    placeMap.set(section, p);
  }
  const places: PlaceRow[] = [...placeMap.values()]
    .sort((a, b) => SECTION_ORDER[a.section] - SECTION_ORDER[b.section])
    .map((p) => {
      const locs = [...p.locs.entries()].map(([id, l]) => ({ locationId: id, code: l.code, name: l.name, siteCode: l.siteCode, qty: l.qty.toString(), qtyText: fmtStock(l.qty, unit), lots: l.lots.size }));
      locs.sort((a, b) => new Decimal(b.qty).comparedTo(a.qty) || a.code.localeCompare(b.code));
      return { section: p.section, sectionLabel: SECTION_LABELS[p.section], total: amt(locs.reduce((t, l) => t.plus(l.qty), new Decimal(0))), locations: locs };
    });

  // ---- minimum (owner configuration; needs inventory.balance.view at the site) ----
  const balanceSites = siteIds.filter((s) => ctx.canAt("inventory.balance.view", s));
  let minimum: Amount | null = null;
  let belowMinimum = false;
  if (balanceSites.length) {
    const inBal = sql.join(balanceSites.map((s) => sql`${s}::uuid`), sql`, `);
    const minRows = (
      kind === "material"
        ? await db.execute(sql`select sum(min_stock_base)::text as m from material_reorder_policies where organization_id = ${ctx.organizationId}::uuid and material_id = ${input.id}::uuid and is_active and min_stock_base > 0 and site_id in (${inBal})`)
        : await db.execute(sql`select sum(min_stock_units)::text as m from product_min_stock where organization_id = ${ctx.organizationId}::uuid and product_id = ${input.id}::uuid and min_stock_units > 0 and site_id in (${inBal})`)
    ) as unknown as { m: string | null }[];
    if (minRows[0]?.m) {
      minimum = amt(minRows[0].m);
      belowMinimum = (await lowStockItems(ctx, { siteIds: balanceSites })).some((li) => li.kind === kind && li.id === input.id);
    }
  }

  // ---- recent movements (last 10) ----
  const mv = (await db.execute(sql`
    select m.id, m.posted_at, m.movement_type, m.qty_base::text as qty, m.source_document_type as doc_type,
           m.source_document_number as doc_number, m.reason, lot.id as lot_id, lot.lot_number, lot.supplier_name,
           fl.code as from_code, tl.code as to_code, u.display_name as by_name
      from stock_movements m
      join inventory_lots lot on lot.id = m.lot_id
      left join locations fl on fl.id = m.from_location_id
      left join locations tl on tl.id = m.to_location_id
      left join users u on u.id = m.posted_by
     where m.site_id in (${inSites}) and m.organization_id = ${ctx.organizationId}::uuid
       and lot.item_kind = ${kind} and ${itemCol} = ${input.id}::uuid
     order by m.posted_at desc, m.id desc
     limit 10`)) as unknown as { id: string; posted_at: Date | string; movement_type: string; qty: string; doc_type: string | null; doc_number: string | null; reason: string | null; lot_id: string; lot_number: string; supplier_name: string | null; from_code: string | null; to_code: string | null; by_name: string | null }[];
  const movements: ItemMovement[] = mv.map((m) => ({
    id: m.id,
    postedAt: new Date(m.posted_at).toISOString(),
    lotId: m.lot_id,
    lotNumber: m.lot_number,
    by: m.by_name,
    sentence: movementSentence({ movementType: m.movement_type, qtyText: fmtStock(m.qty, unit), supplierName: m.supplier_name, docType: m.doc_type, docNumber: m.doc_number, fromName: m.from_code, toName: m.to_code, reason: m.reason }),
  }));

  return {
    item: { kind, id: h.id, code: h.code, name: h.name, unit, group: h.grp, usualBrand: h.usual_brand, shelfLifeDays: h.shelf_life_days === null ? null : Number(h.shelf_life_days), storageConditions: h.storage_conditions },
    scope,
    asOf,
    minimum,
    belowMinimum,
    totals,
    orders,
    bySupplierTotal,
    byBrandTotal,
    bySupplier,
    expiring,
    places,
    lots,
    movements,
  };
}
