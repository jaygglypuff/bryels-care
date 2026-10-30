import "server-only";
import Decimal from "decimal.js";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { inventoryBalances, inventoryLots, locations, materials, products, warehouses } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { isSection, sectionSql } from "@/modules/masterdata";
import { manilaToday } from "./availability";
import { fmtStock, fmtStockFriendly, lowStockItems } from "./low-stock";
import { EXPIRY_WARN_DAYS } from "./lots";

/**
 * Stock by item (owner review 2026-10-30, brief Part II §3 "Inventory Management" mockup): ONE row per
 * material or product at the current site, name first, total usable quantity in a friendly unit, the worst
 * status in plain words and the nearest expiry; the lots behind the row are returned for the tap-to-expand
 * view. Lots that must not be used (expired, rejected, recalled) are returned separately (`doNotUse`) so the
 * screen can show them in a red group at the bottom, never under "use next".
 *
 * Reads only. Scope: `inventory.lot.view` and the caller's CURRENT site (requireSite); another site's lots
 * never appear. Quantities are summed with decimal.js. Low stock uses the owner-maintained minimums through
 * `lowStockItems` (needs `inventory.balance.view`; without it no item is flagged low).
 */

/** State of one lot as the owner reads it. `expiring` = released and expiring within EXPIRY_WARN_DAYS. */
export type LotState = "ok" | "expiring" | "waiting" | "on_hold" | "expired" | "rejected" | "recalled";
/** State of one item row: the worst of its lots, or `low` when everything is fine but below the minimum. */
export type ItemState = LotState | "low";

/** The status chips of the stock screen; `do_not_use` is reachable by link (old "expired" links). */
export const ITEM_STATUS_FILTERS = ["ok", "waiting", "on_hold", "expiring", "low", "do_not_use"] as const;
export type ItemStatusFilter = (typeof ITEM_STATUS_FILTERS)[number];

export type StockByItemFilter = {
  kind?: "material" | "product";
  /** Words, any case; every word must match the item name, item code, lot number or supplier lot (AND). */
  q?: string;
  status?: string;
  section?: string;
  locationId?: string;
};

export type StockItemLot = {
  lotId: string;
  lotNumber: string;
  supplierLotNumber: string | null;
  /** Supplier name and brand as recorded at receipt (ADR-076); null when not recorded. */
  supplierName: string | null;
  brand: string | null;
  /** Plain location names, comma separated. */
  where: string;
  qty: string;
  qtyText: string;
  expiresOn: string | null;
  /** Days until expiry from today's business date (Asia/Manila); negative = past. */
  daysLeft: number | null;
  state: LotState;
};

export type StockItem = {
  kind: "material" | "product";
  id: string;
  code: string;
  name: string;
  unit: string;
  state: ItemState;
  /** Below the owner's minimum (usable stock only). */
  low: boolean;
  minimumText: string | null;
  /** Released, in-date stock. */
  usable: string;
  usableText: string;
  /** Stock waiting for the quality check / on hold (null when none). */
  waitingText: string | null;
  onHoldText: string | null;
  /** Everything in the row (for the "Do not use" group this is the blocked quantity). */
  totalText: string;
  nearestExpiry: string | null;
  nearestDaysLeft: number | null;
  /**
   * The ONE total of the item (all of its lots here, whatever the status chip): total = ready + waiting for QA
   * check + stopped by QA + expired + bad (rejected / recalled). Grade-5 usability test 2026-10-30.
   */
  breakdown: { totalText: string; readyText: string; waitingText: string; onHoldText: string; expiredText: string; badText: string };
  /** Earliest expiry first: the top lot is the one to use next. */
  lots: StockItemLot[];
};

export type StockByItemResult = {
  items: StockItem[];
  doNotUse: StockItem[];
  /** Items per chip for the current kind / words / section (before the status filter). */
  counts: Record<"all" | ItemStatusFilter, number>;
};

const BLOCKED: LotState[] = ["expired", "rejected", "recalled"];
const ROW_ORDER: ItemState[] = ["recalled", "rejected", "expired", "on_hold", "waiting", "expiring", "low", "ok"];

/** Plain words → lowercase search terms (≥ 1 char, LIKE wildcards removed, at most 6). */
export function searchWords(q: string | undefined): string[] {
  return (q ?? "")
    .toLowerCase()
    .split(/[\s,;/]+/)
    .map((w) => w.replace(/[%_\\]/g, ""))
    .filter((w) => w.length >= 1)
    .slice(0, 6);
}

export function lotState(status: string, daysLeft: number | null): LotState {
  if (status === "recalled") return "recalled";
  if (status === "rejected") return "rejected";
  if (status === "expired" || (daysLeft !== null && daysLeft < 0)) return "expired";
  if (status === "on_hold") return "on_hold";
  if (status === "quarantine") return "waiting";
  return daysLeft !== null && daysLeft <= EXPIRY_WARN_DAYS ? "expiring" : "ok";
}

function worst(states: ItemState[]): ItemState {
  return ROW_ORDER.find((s) => states.includes(s)) ?? "ok";
}

type LotRow = {
  lot_id: string;
  lot_number: string;
  supplier_lot_number: string | null;
  supplier_name: string | null;
  brand: string | null;
  quality_status: string;
  expires_on: string | null;
  days_left: number | null;
  item_kind: "material" | "product";
  item_id: string;
  item_code: string;
  item_name: string;
  unit: string;
  qty: string;
  where_names: string;
};

function lotMatchesFilter(s: LotState, f: ItemStatusFilter | undefined): boolean {
  if (!f || f === "low") return !BLOCKED.includes(s);
  if (f === "ok") return s === "ok" || s === "expiring";
  if (f === "do_not_use") return BLOCKED.includes(s);
  return s === f;
}

export async function stockByItem(ctx: AuthContext, f: StockByItemFilter = {}): Promise<StockByItemResult> {
  ctx.require("inventory.lot.view");
  ctx.requireSite(ctx.currentSiteId);
  const site = ctx.currentSiteId;
  const today = manilaToday();
  const status = (ITEM_STATUS_FILTERS as readonly string[]).includes(f.status ?? "") ? (f.status as ItemStatusFilter) : undefined;
  const kind = f.kind === "material" || f.kind === "product" ? f.kind : undefined;
  const words = searchWords(f.q);

  const conds: SQL[] = [sql`b.site_id = ${site}`, sql`b.qty_base > 0`, sql`lot.organization_id = ${ctx.organizationId}`];
  if (kind) conds.push(sql`lot.item_kind = ${kind}`);
  if (isSection(f.section)) conds.push(sql`${sectionSql("l", "w")} = ${f.section}`);
  if (f.locationId && /^[0-9a-f-]{36}$/i.test(f.locationId)) conds.push(sql`b.location_id = ${f.locationId}`);
  for (const w of words) {
    const like = `%${w}%`;
    conds.push(sql`(lot.lot_number ilike ${like} or coalesce(lot.supplier_lot_number, '') ilike ${like} or coalesce(m.name, p.name, '') ilike ${like} or coalesce(m.code, p.sku_code, '') ilike ${like})`);
  }

  const rows = (await db.execute(sql`
    select lot.id as lot_id, lot.lot_number, lot.supplier_lot_number, lot.supplier_name, lot.brand, lot.quality_status,
           lot.expires_on::text as expires_on, (lot.expires_on - ${today}::date) as days_left,
           lot.item_kind, coalesce(m.id, p.id) as item_id, coalesce(m.code, p.sku_code) as item_code,
           coalesce(m.name, p.name) as item_name, lot.base_uom as unit,
           sum(b.qty_base)::text as qty, string_agg(distinct coalesce(nullif(l.name, ''), l.code), ', ') as where_names
      from ${inventoryBalances} b
      join ${locations} l on l.id = b.location_id
      join ${warehouses} w on w.id = l.warehouse_id
      join ${inventoryLots} lot on lot.id = b.lot_id
      left join ${materials} m on m.id = lot.material_id
      left join ${products} p on p.id = lot.product_id
     where ${sql.join(conds, sql` and `)}
     group by lot.id, m.id, p.id
     order by lot.expires_on asc nulls last, lot.lot_number asc
     limit 3000`)) as unknown as LotRow[];

  // Low stock at this site (owner-maintained minimums); only for callers who may see balances.
  const low = new Map<string, { minimumText: string; kind: "material" | "product"; id: string; code: string; name: string; unit: string }>();
  if (ctx.canAt("inventory.balance.view", site)) {
    for (const li of await lowStockItems(ctx, { siteIds: [site] })) {
      if (li.siteId === site) low.set(`${li.kind}:${li.id}`, { minimumText: li.minimumText, kind: li.kind, id: li.id, code: li.code, name: li.name, unit: li.unit });
    }
  }

  type Acc = { kind: "material" | "product"; id: string; code: string; name: string; unit: string; lots: StockItemLot[] };
  const byItem = new Map<string, Acc>();
  for (const r of rows) {
    const key = `${r.item_kind}:${r.item_id}`;
    const acc = byItem.get(key) ?? { kind: r.item_kind, id: r.item_id, code: r.item_code, name: r.item_name, unit: r.unit, lots: [] };
    const daysLeft = r.days_left === null ? null : Number(r.days_left);
    acc.lots.push({
      lotId: r.lot_id,
      lotNumber: r.lot_number,
      supplierLotNumber: r.supplier_lot_number,
      supplierName: r.supplier_name,
      brand: r.brand,
      where: r.where_names,
      qty: new Decimal(r.qty).toString(),
      qtyText: fmtStock(r.qty, r.unit),
      expiresOn: r.expires_on,
      daysLeft,
      state: lotState(r.quality_status, daysLeft),
    });
    byItem.set(key, acc);
  }

  // Low items with no stock row here at all still matter ("0 kg, minimum 20 kg"), unless the list is narrowed to a place.
  if (!isSection(f.section) && !f.locationId) {
    for (const [key, li] of low) {
      if (byItem.has(key) || (kind && li.kind !== kind)) continue;
      const hay = `${li.name} ${li.code}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      byItem.set(key, { kind: li.kind, id: li.id, code: li.code, name: li.name, unit: li.unit, lots: [] });
    }
  }

  const build = (a: Acc, lots: StockItemLot[], blockedGroup: boolean): StockItem => {
    const all = (pred: (s: LotState) => boolean) => fmtStockFriendly(a.lots.filter((l) => pred(l.state)).reduce((t, l) => t.plus(l.qty), new Decimal(0)), a.unit);
    const sum = (pred: (s: LotState) => boolean) => lots.filter((l) => pred(l.state)).reduce((t, l) => t.plus(l.qty), new Decimal(0));
    const usable = sum((s) => s === "ok" || s === "expiring");
    const waiting = sum((s) => s === "waiting");
    const onHold = sum((s) => s === "on_hold");
    const total = lots.reduce((t, l) => t.plus(l.qty), new Decimal(0));
    const lowInfo = blockedGroup ? undefined : low.get(`${a.kind}:${a.id}`);
    const states: ItemState[] = lots.map((l) => l.state);
    if (lowInfo) states.push("low");
    const firstDated = lots.find((l) => l.expiresOn);
    return {
      kind: a.kind,
      id: a.id,
      code: a.code,
      name: a.name,
      unit: a.unit,
      state: worst(states),
      low: !!lowInfo,
      minimumText: lowInfo?.minimumText ?? null,
      usable: usable.toString(),
      usableText: fmtStock(usable, a.unit),
      waitingText: waiting.gt(0) ? fmtStock(waiting, a.unit) : null,
      onHoldText: onHold.gt(0) ? fmtStock(onHold, a.unit) : null,
      totalText: fmtStock(total, a.unit),
      nearestExpiry: firstDated?.expiresOn ?? null,
      nearestDaysLeft: firstDated?.daysLeft ?? null,
      breakdown: {
        totalText: all(() => true),
        readyText: all((s) => s === "ok" || s === "expiring"),
        waitingText: all((s) => s === "waiting"),
        onHoldText: all((s) => s === "on_hold"),
        expiredText: all((s) => s === "expired"),
        badText: all((s) => s === "rejected" || s === "recalled"),
      },
      lots,
    };
  };

  const counts: StockByItemResult["counts"] = { all: 0, ok: 0, waiting: 0, on_hold: 0, expiring: 0, low: 0, do_not_use: 0 };
  const items: StockItem[] = [];
  const doNotUse: StockItem[] = [];
  for (const a of byItem.values()) {
    const has = (f2: ItemStatusFilter) => a.lots.some((l) => lotMatchesFilter(l.state, f2));
    const isLow = low.has(`${a.kind}:${a.id}`);
    const usableRow = a.lots.some((l) => !BLOCKED.includes(l.state)) || isLow;
    if (usableRow) counts.all += 1;
    for (const k of ["ok", "waiting", "on_hold", "expiring", "do_not_use"] as const) if (has(k)) counts[k] += 1;
    if (isLow) counts.low += 1;

    if (status === "low" && !isLow) continue;
    const mainLots = a.lots.filter((l) => lotMatchesFilter(l.state, status === "do_not_use" ? "do_not_use" : status));
    if (status !== "do_not_use" && (mainLots.length > 0 || (isLow && (!status || status === "low")))) {
      const it = build(a, mainLots, false);
      items.push(status === "low" ? { ...it, state: "low" } : it); // the chip the user filtered on
    }
    if (!status || status === "do_not_use") {
      const blocked = a.lots.filter((l) => BLOCKED.includes(l.state));
      if (blocked.length) doNotUse.push(build(a, blocked, true));
    }
  }
  const byName = (x: StockItem, y: StockItem) => x.name.localeCompare(y.name) || x.code.localeCompare(y.code);
  return { items: items.sort(byName), doNotUse: doNotUse.sort(byName), counts };
}
