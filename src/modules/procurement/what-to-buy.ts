import "server-only";
import Decimal from "decimal.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { materialReorderPolicies, materials, products, supplierMaterials, suppliers, workOrders } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { friendlyUnit, toBaseQty } from "@/lib/units";
import { workOrderRequirements } from "@/modules/production";
import { businessDate, canSeePrices } from "./shared";

/**
 * ADR-131 (C-office problem 5, "Nothing tells her what to buy"): one list built from shortages at the current site.
 *
 * For each material:
 * - needed = what open production orders (draft, waiting for approval, approved) still need from the store room:
 *   their recipe amounts minus what is already set aside for them (reservations);
 * - plus the minimum to keep (the "Running low" minimum and safety stock, when set);
 * - minus the free stock (released, in date, not set aside for anything) and what is already coming (open purchase
 *   orders and requests to buy).
 * A material is listed when that is above zero, with the production orders that need it, a suggested supplier (the
 * minimum's preferred one, else the approved one with the shortest lead time), the last price paid and "Ask to buy N"
 * (in the unit people use, rounded up). Read only; `procurement.purchase_request.create` or
 * `procurement.reorder_suggestion.view` at the site.
 */
export type WhatToBuyRow = {
  materialId: string;
  materialName: string;
  baseUom: string;
  neededBase: string;
  minimumBase: string;
  freeBase: string;
  comingBase: string;
  shortBase: string;
  askQty: string;
  askUom: string;
  forOrders: { id: string; number: string; productName: string; neededBy: string | null }[];
  supplierId: string | null;
  supplierName: string | null;
  lastPrice: { amount: string; uom: string } | null;
  why: string;
};

const OPEN_WO = ["draft", "planned", "released"] as const;

export async function whatToBuy(ctx: AuthContext): Promise<WhatToBuyRow[]> {
  if (!ctx.can("procurement.purchase_request.create") && !ctx.can("procurement.reorder_suggestion.view")) ctx.require("procurement.reorder_suggestion.view");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);
  const today = businessDate();
  // 1. What open production orders still need (recipe amounts minus their reservations).
  const wos = await db
    .select({ wo: workOrders, productName: products.name })
    .from(workOrders)
    .innerJoin(products, eq(products.id, workOrders.productId))
    .where(and(eq(workOrders.organizationId, ctx.organizationId), eq(workOrders.siteId, siteId), inArray(workOrders.status, [...OPEN_WO])));
  const need = new Map<string, { qty: Decimal; orders: WhatToBuyRow["forOrders"] }>();
  for (const { wo, productName } of wos) {
    const reqs = await workOrderRequirements(db, wo);
    if (!reqs.length) continue;
    const reserved = (await db.execute(sql`
      select l.material_id, coalesce(sum(r.qty_base), 0)::text as qty
        from stock_reservations r join inventory_lots l on l.id = r.lot_id
       where r.demand_type = 'work_order' and r.demand_id = ${wo.id}::uuid and r.status = 'active'
       group by l.material_id`)) as unknown as { material_id: string; qty: string }[];
    for (const r of reqs) {
      const left = Decimal.max(r.required.minus(reserved.find((x) => x.material_id === r.materialId)?.qty ?? 0), 0);
      if (left.lte(0)) continue;
      const e = need.get(r.materialId) ?? { qty: new Decimal(0), orders: [] };
      e.qty = e.qty.plus(left);
      e.orders.push({ id: wo.id, number: wo.workOrderNumber, productName, neededBy: wo.neededBy ?? wo.plannedStart });
      need.set(r.materialId, e);
    }
  }
  // 2. Minimums ("Running low").
  const policies = await db.select().from(materialReorderPolicies).where(and(eq(materialReorderPolicies.organizationId, ctx.organizationId), eq(materialReorderPolicies.siteId, siteId), eq(materialReorderPolicies.isActive, true)));
  const ids = [...new Set([...need.keys(), ...policies.map((p) => p.materialId)])];
  if (!ids.length) return [];
  const mats = await db.select().from(materials).where(and(eq(materials.organizationId, ctx.organizationId), inArray(materials.id, ids)));
  const idList = sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `);
  // 3. Free stock and what is coming, per material.
  const free = (await db.execute(sql`
    select l.material_id,
           (coalesce(sum(b.qty_base), 0) - coalesce((select sum(r.qty_base) from stock_reservations r join inventory_lots l2 on l2.id = r.lot_id where l2.material_id = l.material_id and r.site_id = ${siteId}::uuid and r.status = 'active'), 0))::text as qty
      from inventory_balances b join inventory_lots l on l.id = b.lot_id
     where b.site_id = ${siteId}::uuid and l.material_id in (${idList}) and l.quality_status = 'released' and b.qty_base > 0
       and (l.expires_on is null or l.expires_on >= ${today}::date)
     group by l.material_id`)) as unknown as { material_id: string; qty: string }[];
  const coming = (await db.execute(sql`
    select material_id, sum(qty)::text as qty from (
      select pol.material_id, greatest(pol.qty_base - pol.qty_received_base, 0) as qty
        from purchase_order_lines pol join purchase_orders po on po.id = pol.purchase_order_id
       where po.site_id = ${siteId}::uuid and pol.line_status = 'open' and po.status in ('draft', 'submitted', 'approved', 'sent', 'partially_received') and pol.material_id in (${idList})
      union all
      select l.material_id, l.qty_base
        from purchase_request_lines l join purchase_requests r on r.id = l.purchase_request_id
       where r.site_id = ${siteId}::uuid and l.converted_po_line_id is null and r.status in ('draft', 'submitted', 'approved') and l.material_id in (${idList})
    ) x group by material_id`)) as unknown as { material_id: string; qty: string }[];
  const pairs = await db
    .select({ sm: supplierMaterials, name: suppliers.name, dflt: suppliers.defaultLeadTimeDays, active: suppliers.isActive, status: suppliers.qualityStatus })
    .from(supplierMaterials)
    .innerJoin(suppliers, eq(suppliers.id, supplierMaterials.supplierId))
    .where(and(eq(supplierMaterials.organizationId, ctx.organizationId), eq(supplierMaterials.isApproved, true), inArray(supplierMaterials.materialId, ids)));
  const prices = canSeePrices(ctx);
  const last = prices
    ? ((await db.execute(sql`
        select distinct on (pol.material_id) pol.material_id, pol.unit_amount::text as amount, pol.uom_entered as uom, po.supplier_id
          from purchase_order_lines pol join purchase_orders po on po.id = pol.purchase_order_id
         where po.organization_id = ${ctx.organizationId}::uuid and po.site_id in (${sql.join(ctx.allowedSiteIds.map((s) => sql`${s}::uuid`), sql`, `)}) and pol.material_id in (${idList})
           and po.status in ('sent', 'partially_received', 'received', 'closed')
         order by pol.material_id, po.order_date desc, po.po_number desc`)) as unknown as { material_id: string; amount: string; uom: string; supplier_id: string }[])
    : [];
  const out: WhatToBuyRow[] = [];
  for (const m of mats) {
    const n = need.get(m.id);
    const pol = policies.find((p) => p.materialId === m.id);
    const minimum = pol ? new Decimal(pol.minStockBase).plus(pol.safetyStockBase ?? 0) : new Decimal(0);
    const f = Decimal.max(new Decimal(free.find((x) => x.material_id === m.id)?.qty ?? 0), 0);
    const c = new Decimal(coming.find((x) => x.material_id === m.id)?.qty ?? 0);
    const needed = n?.qty ?? new Decimal(0);
    const short = needed.plus(minimum).minus(f).minus(c);
    if (short.lte(0)) continue;
    const usable = pairs.filter((p) => p.sm.materialId === m.id && p.active && p.status !== "suspended");
    const lp = last.find((x) => x.material_id === m.id);
    const pick = usable.find((p) => p.sm.supplierId === pol?.preferredSupplierId) ?? usable.find((p) => p.sm.supplierId === lp?.supplier_id) ?? [...usable].sort((a, b) => (a.sm.leadTimeDays ?? a.dflt ?? 0) - (b.sm.leadTimeDays ?? b.dflt ?? 0))[0] ?? null;
    const unit = friendlyUnit(m.baseUom);
    const per = unit !== m.baseUom ? toBaseQty("1", unit, m.baseUom) : null;
    const askQty = per && per.ok && per.qtyBase.gt(0) ? short.div(per.qtyBase).toDecimalPlaces(2, Decimal.ROUND_UP) : short.toDecimalPlaces(0, Decimal.ROUND_UP);
    const why = [needed.gt(0) ? `production orders need it (${n!.orders.map((o) => o.number).join(", ")})` : "", minimum.gt(0) && f.lt(minimum) ? "below the minimum to keep" : ""].filter(Boolean).join("; ");
    out.push({
      materialId: m.id,
      materialName: m.name,
      baseUom: m.baseUom,
      neededBase: needed.toString(),
      minimumBase: minimum.toString(),
      freeBase: f.toString(),
      comingBase: c.toString(),
      shortBase: short.toString(),
      askQty: askQty.toString(),
      askUom: per && per.ok ? unit : m.baseUom,
      forOrders: n?.orders ?? [],
      supplierId: pick?.sm.supplierId ?? null,
      supplierName: pick?.name ?? null,
      lastPrice: lp ? { amount: new Decimal(lp.amount).toString(), uom: lp.uom } : null,
      why: why ? `Short because ${why}.` : "Short.",
    });
  }
  return out.sort((a, b) => (a.forOrders[0]?.neededBy ?? "9999").localeCompare(b.forOrders[0]?.neededBy ?? "9999") || a.materialName.localeCompare(b.materialName));
}
