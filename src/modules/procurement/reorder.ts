import "server-only";
import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbOrTx, type Tx } from "@/db/client";
import { auditEvents, materialReorderPolicies, materials, reorderSuggestions, sites, supplierMaterials, suppliers, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { systemContext } from "@/lib/auth/system";
import { DomainError } from "@/lib/errors";
import { fmtQty } from "@/lib/qty";
import { getSetting } from "@/lib/settings";
import { createPurchaseRequest } from "./requests";
import { addDaysIso, assertInScope, businessDate, cleanText, isUuid, parseDecimal, requireReason, toBase } from "./shared";

/**
 * Reorder suggestions with their drivers (US-6-04, W04-01; docs/analytics-kpis.md §6.5). Nothing is
 * ever ordered automatically: a suggestion is a row a person accepts (a purchase request is created)
 * or dismisses with a reason. The documented simple method (A-W4A-05, configuration per site ×
 * material in `material_reorder_policies`):
 *
 *   usable on hand   = released, in-date stock of the material at the site
 *   reserved         = active reservations on that stock
 *   expiry risk      = usable stock expiring before today + lead time + `procurement.reorder.expiry_window_days`
 *   open supply      = open quantity on purchase orders (draft … partially received) + open purchase requests
 *   projected        = usable on hand − reserved − expiry risk + open supply
 *   suggest when projected < minimum stock: (minimum + safety stock − projected), raised to the MOQ
 *
 * Materials have no demand forecast in this build (forecasts are SKU level, US-6-20), so the forecast
 * driver is shown as "not forecast".
 */

export type PolicyInput = { materialId: string; minStockBase: string; safetyStockBase?: string | null; preferredSupplierId?: string | null; isActive?: boolean };

export async function listReorderPolicies(ctx: AuthContext) {
  ctx.require("procurement.reorder_suggestion.view");
  const siteId = ctx.currentSiteId;
  const rows = await db
    .select({ p: materialReorderPolicies, code: materials.code, name: materials.name, baseUom: materials.baseUom, supplierName: suppliers.name })
    .from(materialReorderPolicies)
    .innerJoin(materials, eq(materials.id, materialReorderPolicies.materialId))
    .leftJoin(suppliers, eq(suppliers.id, materialReorderPolicies.preferredSupplierId))
    .where(and(eq(materialReorderPolicies.organizationId, ctx.organizationId), eq(materialReorderPolicies.siteId, siteId)))
    .orderBy(asc(materials.code));
  return rows.map((r) => ({ ...r.p, materialCode: r.code, materialName: r.name, baseUom: r.baseUom, supplierName: r.supplierName }));
}

/** Creates or updates the policy of a material at the current site (procurement.reorder_suggestion.approve). */
export async function saveReorderPolicy(ctx: AuthContext, input: PolicyInput) {
  const siteId = ctx.currentSiteId;
  ctx.requireAt("procurement.reorder_suggestion.approve", siteId);
  ctx.assertWritable();
  if (!isUuid(input.materialId)) throw new DomainError("validation", "Choose a material.", { field: "materialId" });
  const min = parseDecimal(input.minStockBase, "minStockBase", "Minimum stock", { allowZero: true });
  const safety = input.safetyStockBase ? parseDecimal(input.safetyStockBase, "safetyStockBase", "Safety stock", { allowZero: true }) : new Decimal(0);
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(materials).where(and(eq(materials.id, input.materialId), eq(materials.organizationId, ctx.organizationId))).limit(1);
    if (!m) throw new DomainError("validation", "Choose a material.", { field: "materialId" });
    let supplierId: string | null = null;
    if (input.preferredSupplierId) {
      if (!isUuid(input.preferredSupplierId)) throw new DomainError("validation", "Choose a supplier from the list.", { field: "preferredSupplierId" });
      const [sm] = await tx.select().from(supplierMaterials).where(and(eq(supplierMaterials.supplierId, input.preferredSupplierId), eq(supplierMaterials.materialId, m.id), eq(supplierMaterials.isApproved, true))).limit(1);
      if (!sm) throw new DomainError("validation", `The preferred supplier must be on the approved list for ${m.code} (V-ASL).`, { field: "preferredSupplierId", rule: "V-ASL" });
      supplierId = input.preferredSupplierId;
    }
    const [before] = await tx.select().from(materialReorderPolicies).where(and(eq(materialReorderPolicies.siteId, siteId), eq(materialReorderPolicies.materialId, m.id))).limit(1);
    const values = { minStockBase: min.toString(), safetyStockBase: safety.toString(), preferredSupplierId: supplierId, isActive: input.isActive !== false, updatedBy: ctx.userId, updatedAt: new Date() };
    if (before) await tx.update(materialReorderPolicies).set(values).where(eq(materialReorderPolicies.id, before.id));
    else await tx.insert(materialReorderPolicies).values({ organizationId: ctx.organizationId, siteId, materialId: m.id, ...values });
    await audit(tx, ctx, { action: "procurement.reorder_policy.saved", entityType: "material", entityId: m.id, entityNumber: m.code, siteId, before: before ? { minStockBase: before.minStockBase, safetyStockBase: before.safetyStockBase, preferredSupplierId: before.preferredSupplierId, isActive: before.isActive } : null, after: values });
    return { materialId: m.id };
  });
}

type Drivers = {
  onHand: Decimal;
  reserved: Decimal;
  expiryRisk: Decimal;
  openSupply: Decimal;
  leadTimeDays: number;
  supplierId: string | null;
  supplierName: string | null;
  moqBase: Decimal | null;
};

async function driversFor(q: DbOrTx, organizationId: string, siteId: string, mat: typeof materials.$inferSelect, preferredSupplierId: string | null, today: string, windowDays: number): Promise<Drivers> {
  // Supplier: the preferred one, else the approved pair with the shortest lead time.
  const pairs = await q
    .select({ sm: supplierMaterials, name: suppliers.name, dflt: suppliers.defaultLeadTimeDays, status: suppliers.qualityStatus, active: suppliers.isActive })
    .from(supplierMaterials)
    .innerJoin(suppliers, eq(suppliers.id, supplierMaterials.supplierId))
    .where(and(eq(supplierMaterials.materialId, mat.id), eq(supplierMaterials.isApproved, true), eq(supplierMaterials.organizationId, organizationId)));
  const usable = pairs.filter((p) => p.active && p.status !== "suspended");
  const lead = (p: (typeof usable)[number]) => p.sm.leadTimeDays ?? p.dflt ?? 0;
  const pick = usable.find((p) => p.sm.supplierId === preferredSupplierId) ?? [...usable].sort((a, b) => lead(a) - lead(b))[0] ?? null;
  const leadTimeDays = pick ? lead(pick) : 0;
  const moqBase = pick?.sm.moqQty && pick.sm.moqUom ? await toBase(q, organizationId, mat, new Decimal(pick.sm.moqQty), pick.sm.moqUom) : null;
  const riskBefore = addDaysIso(today, leadTimeDays + windowDays);
  const [stock] = (await q.execute(sql`
    select coalesce(sum(b.qty_base), 0)::text as on_hand,
           coalesce(sum(b.qty_base) filter (where l.expires_on is not null and l.expires_on < ${riskBefore}::date), 0)::text as expiry_risk
      from inventory_balances b join inventory_lots l on l.id = b.lot_id
     where b.site_id = ${siteId}::uuid and l.material_id = ${mat.id}::uuid and l.quality_status = 'released'
       and (l.expires_on is null or l.expires_on >= ${today}::date) and b.qty_base > 0`)) as unknown as { on_hand: string; expiry_risk: string }[];
  const [res] = (await q.execute(sql`
    select coalesce(sum(r.qty_base), 0)::text as reserved
      from stock_reservations r join inventory_lots l on l.id = r.lot_id
     where r.site_id = ${siteId}::uuid and l.material_id = ${mat.id}::uuid and r.status = 'active'`)) as unknown as { reserved: string }[];
  const [po] = (await q.execute(sql`
    select coalesce(sum(greatest(pol.qty_base - pol.qty_received_base, 0)), 0)::text as open_qty
      from purchase_order_lines pol join purchase_orders po on po.id = pol.purchase_order_id
     where po.site_id = ${siteId}::uuid and pol.material_id = ${mat.id}::uuid and pol.line_status = 'open'
       and po.status in ('draft', 'submitted', 'approved', 'sent', 'partially_received')`)) as unknown as { open_qty: string }[];
  const [pr] = (await q.execute(sql`
    select coalesce(sum(l.qty_base), 0)::text as open_qty
      from purchase_request_lines l join purchase_requests r on r.id = l.purchase_request_id
     where r.site_id = ${siteId}::uuid and l.material_id = ${mat.id}::uuid and l.converted_po_line_id is null
       and r.status in ('draft', 'submitted', 'approved')`)) as unknown as { open_qty: string }[];
  return {
    onHand: new Decimal(stock?.on_hand ?? 0),
    reserved: new Decimal(res?.reserved ?? 0),
    expiryRisk: new Decimal(stock?.expiry_risk ?? 0),
    openSupply: new Decimal(po?.open_qty ?? 0).plus(pr?.open_qty ?? 0),
    leadTimeDays,
    supplierId: pick?.sm.supplierId ?? null,
    supplierName: pick?.name ?? null,
    moqBase,
  };
}

/** The pure decision of the documented method (unit-tested): the suggested quantity, or null. */
export function suggestQty(d: { onHand: Decimal.Value; reserved: Decimal.Value; expiryRisk: Decimal.Value; openSupply: Decimal.Value; minStock: Decimal.Value; safetyStock: Decimal.Value; moq: Decimal.Value | null }) {
  const projected = new Decimal(d.onHand).minus(d.reserved).minus(d.expiryRisk).plus(d.openSupply);
  if (!projected.lt(d.minStock)) return { projected, qty: null as Decimal | null };
  let qty = new Decimal(d.minStock).plus(d.safetyStock).minus(projected);
  if (d.moq && qty.lt(d.moq)) qty = new Decimal(d.moq);
  return { projected, qty: qty.gt(0) ? qty : null };
}

/**
 * Recomputes suggestions for every active policy (optionally one site). Earlier open suggestions of a
 * material are superseded; accepted and dismissed rows are history. Runs as the job
 * `procurement.reorder_suggest` or from the screen.
 */
export async function computeReorderSuggestions(ctx: AuthContext, opts: { siteId?: string; now?: Date } = {}) {
  ctx.require("procurement.reorder_suggestion.view");
  const now = opts.now ?? new Date();
  const today = businessDate(now);
  return db.transaction(async (tx) => {
    const conds = [eq(materialReorderPolicies.organizationId, ctx.organizationId), eq(materialReorderPolicies.isActive, true)];
    if (opts.siteId) conds.push(eq(materialReorderPolicies.siteId, opts.siteId));
    const policies = await tx.select({ p: materialReorderPolicies, m: materials }).from(materialReorderPolicies).innerJoin(materials, eq(materials.id, materialReorderPolicies.materialId)).where(and(...conds)).orderBy(asc(materialReorderPolicies.siteId), asc(materials.code));
    let created = 0;
    let superseded = 0;
    for (const { p, m } of policies) {
      if (!ctx.allowedSiteIds.includes(p.siteId)) continue;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"reorder:" + p.siteId + ":" + m.id}))`);
      const windowDays = await getSetting(tx, ctx.organizationId, "procurement.reorder.expiry_window_days", p.siteId);
      const d = await driversFor(tx, ctx.organizationId, p.siteId, m, p.preferredSupplierId, today, windowDays);
      const { projected, qty } = suggestQty({ onHand: d.onHand, reserved: d.reserved, expiryRisk: d.expiryRisk, openSupply: d.openSupply, minStock: p.minStockBase, safetyStock: p.safetyStockBase, moq: d.moqBase });
      const old = await tx.update(reorderSuggestions).set({ status: "superseded" }).where(and(eq(reorderSuggestions.siteId, p.siteId), eq(reorderSuggestions.materialId, m.id), eq(reorderSuggestions.status, "open"))).returning({ id: reorderSuggestions.id });
      superseded += old.length;
      if (!qty) continue;
      const u = m.baseUom;
      const explanation = [
        `Usable on hand ${fmtQty(d.onHand, u, 0)}`,
        `reserved ${fmtQty(d.reserved, u, 0)}`,
        `${fmtQty(d.expiryRisk, u, 0)} expire within lead time + ${windowDays} d`,
        `open POs and requests ${fmtQty(d.openSupply, u, 0)}`,
        `projected ${fmtQty(projected, u, 0)} is below the minimum ${fmtQty(p.minStockBase, u, 0)}`,
        `safety stock ${fmtQty(p.safetyStockBase, u, 0)}`,
        d.moqBase ? `MOQ ${fmtQty(d.moqBase, u, 0)}` : "no MOQ",
        `lead time ${d.leadTimeDays} d${d.supplierName ? ` (${d.supplierName})` : " (no approved supplier)"}`,
        "no material forecast",
      ].join(", ") + ` → suggest ${fmtQty(qty, u, 0)} by ${addDaysIso(today, d.leadTimeDays)}.`;
      await tx.insert(reorderSuggestions).values({
        organizationId: ctx.organizationId,
        siteId: p.siteId,
        materialId: m.id,
        runAt: now,
        suggestedQtyBase: qty.toString(),
        baseUom: u,
        onHandBase: d.onHand.toString(),
        reservedBase: d.reserved.toString(),
        openPoQtyBase: d.openSupply.toString(),
        forecastQtyBase: null,
        minStockBase: p.minStockBase,
        safetyStockBase: p.safetyStockBase,
        expiryRiskQtyBase: d.expiryRisk.toString(),
        moqBase: d.moqBase?.toString() ?? null,
        leadTimeDays: d.leadTimeDays,
        supplierId: d.supplierId,
        needByDate: addDaysIso(today, d.leadTimeDays),
        explanation,
      });
      created += 1;
    }
    await audit(tx, ctx, { action: "procurement.reorder_suggestion.computed", entityType: "reorder_suggestion", siteId: opts.siteId ?? null, after: { policies: policies.length, created, superseded, asOf: today } });
    return { policies: policies.length, created, superseded };
  });
}

/** Suggestions older than this are recomputed when the screen opens (the nightly job runs every 24 h). */
const STALE_AFTER_MS = 26 * 3_600_000;

/** When suggestions were last computed for the organization (job, "Recompute now" or screen), or null. */
export async function lastReorderComputation(ctx: AuthContext): Promise<Date | null> {
  ctx.require("procurement.reorder_suggestion.view");
  const [r] = await db
    .select({ at: sql<Date | null>`max(${auditEvents.occurredAt})` })
    .from(auditEvents)
    .where(and(eq(auditEvents.organizationId, ctx.organizationId), eq(auditEvents.action, "procurement.reorder_suggestion.computed")));
  return r?.at ? new Date(r.at) : null;
}

/**
 * Owner QA 2026-10-30: the Reorder suggestions screen was empty although PKG-0101 was far below its
 * minimum, because the nightly job `procurement.reorder_suggest` had never run (no worker in the demo, or
 * a missed night). When the last computation is missing or older than 26 h, this runs the same
 * computation the job runs, as the organization's system actor (audited like the job), so the screen
 * never shows an empty list just because the job did not run. Read-only maintenance mode skips it.
 * Returns when suggestions were last computed and whether this call computed them.
 */
export async function ensureReorderSuggestionsFresh(ctx: AuthContext, now: Date = new Date()): Promise<{ lastComputedAt: Date | null; computedNow: boolean }> {
  const last = await lastReorderComputation(ctx);
  if (ctx.readOnly || (last && now.getTime() - last.getTime() < STALE_AFTER_MS)) return { lastComputedAt: last, computedNow: false };
  const sys = await systemContext(ctx.organizationId, { code: "procurement.reorder_suggest", systemPermissions: ["procurement.reorder_suggestion.view"] });
  await computeReorderSuggestions(sys, { now });
  return { lastComputedAt: now, computedNow: true };
}

export async function listReorderSuggestions(ctx: AuthContext, f: { status?: string } = {}) {
  ctx.require("procurement.reorder_suggestion.view");
  const siteIds = ctx.allowedSiteIds.filter((s) => ctx.canAt("procurement.reorder_suggestion.view", s));
  if (!siteIds.length) return [];
  const conds = [eq(reorderSuggestions.organizationId, ctx.organizationId), inArray(reorderSuggestions.siteId, siteIds)];
  conds.push(eq(reorderSuggestions.status, f.status && f.status !== "all" ? f.status : "open"));
  const rows = await db
    .select({ r: reorderSuggestions, siteCode: sites.code, code: materials.code, name: materials.name, supplierName: suppliers.name, reviewedByName: users.displayName })
    .from(reorderSuggestions)
    .innerJoin(sites, eq(sites.id, reorderSuggestions.siteId))
    .innerJoin(materials, eq(materials.id, reorderSuggestions.materialId))
    .leftJoin(suppliers, eq(suppliers.id, reorderSuggestions.supplierId))
    .leftJoin(users, eq(users.id, reorderSuggestions.reviewedBy))
    .where(and(...conds))
    .orderBy(desc(reorderSuggestions.runAt), asc(materials.code))
    .limit(300);
  return rows.map((r) => ({ ...r.r, siteCode: r.siteCode, materialCode: r.code, materialName: r.name, supplierName: r.supplierName, reviewedByName: r.reviewedByName }));
}

async function lockSuggestion(tx: Tx, ctx: AuthContext, id: string) {
  if (!isUuid(id)) throw new DomainError("not_found", "Suggestion not found in your sites.");
  const [s] = await tx.select().from(reorderSuggestions).where(and(eq(reorderSuggestions.id, id), eq(reorderSuggestions.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!s) throw new DomainError("not_found", "Suggestion not found in your sites.");
  assertInScope(ctx, s.siteId, "Suggestion");
  if (s.status !== "open") throw new DomainError("state", `This suggestion is already ${s.status}.`);
  return s;
}

/** Accepts a suggestion into a draft purchase request (W04-01 → W04-02); the quantity may be changed. */
export async function acceptReorderSuggestion(ctx: AuthContext, input: { suggestionId: string; qty?: string | null; note?: string | null; idempotencyKey?: string | null }) {
  return db.transaction(async (tx) => {
    const s = await lockSuggestion(tx, ctx, input.suggestionId);
    ctx.requireAt("procurement.reorder_suggestion.approve", s.siteId);
    ctx.requireAt("procurement.purchase_request.create", s.siteId);
    if (s.siteId !== ctx.currentSiteId) throw new DomainError("validation", "Switch to the suggestion's site to accept it.", { field: "suggestionId" });
    const qty = input.qty ? parseDecimal(input.qty, "qty", "Quantity") : new Decimal(s.suggestedQtyBase);
    const note = cleanText(input.note, 500, "note", "Note") ?? `Accepted reorder suggestion (${s.explanation.slice(0, 300)})`;
    const pr = await createPurchaseRequest(ctx, { neededByDate: s.needByDate, justification: note, reorderSuggestionId: s.id, idempotencyKey: input.idempotencyKey ?? null, lines: [{ materialId: s.materialId, qty: qty.toString(), uom: s.baseUom, suggestedSupplierId: s.supplierId }] }, { tx });
    await tx.update(reorderSuggestions).set({ status: "accepted", reviewedBy: ctx.userId, reviewedAt: new Date(), reviewNote: note, purchaseRequestId: pr.requestId }).where(eq(reorderSuggestions.id, s.id));
    await audit(tx, ctx, { action: "procurement.reorder_suggestion.accepted", entityType: "reorder_suggestion", entityId: s.id, siteId: s.siteId, reason: note, after: { purchaseRequestId: pr.requestId, requestNumber: pr.requestNumber, suggested: s.suggestedQtyBase, accepted: qty.toString() } });
    return { suggestionId: s.id, requestId: pr.requestId, requestNumber: pr.requestNumber };
  });
}

export async function dismissReorderSuggestion(ctx: AuthContext, input: { suggestionId: string; note: string }) {
  const note = requireReason(input.note, "note");
  return db.transaction(async (tx) => {
    const s = await lockSuggestion(tx, ctx, input.suggestionId);
    ctx.requireAt("procurement.reorder_suggestion.approve", s.siteId);
    await tx.update(reorderSuggestions).set({ status: "dismissed", reviewedBy: ctx.userId, reviewedAt: new Date(), reviewNote: note }).where(eq(reorderSuggestions.id, s.id));
    await audit(tx, ctx, { action: "procurement.reorder_suggestion.dismissed", entityType: "reorder_suggestion", entityId: s.id, siteId: s.siteId, reason: note });
    return { suggestionId: s.id };
  });
}
