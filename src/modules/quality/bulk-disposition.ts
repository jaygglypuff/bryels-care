import "server-only";
import { and, asc, eq, gte, inArray, isNull, like, lte, or, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { batches, inventoryBalances, inventoryLots, locations, materials, products, users, warehouses } from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import { verifyPassword } from "@/lib/auth/password";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { decideLot } from "./dispositions";
import { BATCH_DECIDED_STATUSES, isLotExpired, type LotDecision } from "./rules";
import { isIsoDate, isUuid, optionalText } from "./shared";

/**
 * QA bulk disposition (US-2-23, docs/data-migration-plan.md §5 step 10, MC-07): qa_qc filters lots of
 * the current site and applies one decision with a reason code to the selection after re-entering the
 * password. Each lot is decided through the normal single-lot path (decideLot: same state machine,
 * expiry refusal, receiving/hold/inspection/deviation blockers, separation of duties, one disposition
 * row and audit event per lot) in its own transaction, all sharing one correlation id; lots that fail
 * are reported one by one and never block the others.
 */

/** A-W2C-04: reason codes offered for a bulk decision (QA to confirm the list). */
export const BULK_REASON_CODES = [
  { code: "legacy_release", label: "Legacy release: opening stock already released in the previous system" },
  { code: "legacy_reject", label: "Legacy reject: opening stock already rejected in the previous system" },
  { code: "qa_review", label: "QA review of the selected lots" },
] as const;

export type BulkFilter = {
  warehouseId?: string | null;
  itemKind?: "material" | "product" | null;
  materialKind?: string | null;
  status?: "quarantine" | "on_hold" | null;
  expiresFrom?: string | null;
  expiresTo?: string | null;
  lotPrefix?: string | null;
};

export async function bulkDispositionCandidates(ctx: AuthContext, f: BulkFilter = {}) {
  ctx.require("quality.disposition.approve");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);
  const maxLots = await getSetting(db, ctx.organizationId, "quality.bulk_disposition.max_lots");
  const status = f.status === "on_hold" ? "on_hold" : "quarantine";
  const conds = [eq(inventoryLots.siteId, siteId), eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.qualityStatus, status)];
  if (f.itemKind === "material" || f.itemKind === "product") conds.push(eq(inventoryLots.itemKind, f.itemKind));
  if (f.materialKind) conds.push(eq(materials.materialKind, f.materialKind));
  if (f.expiresFrom && isIsoDate(f.expiresFrom)) conds.push(gte(inventoryLots.expiresOn, f.expiresFrom));
  if (f.expiresTo && isIsoDate(f.expiresTo)) conds.push(lte(inventoryLots.expiresOn, f.expiresTo));
  if (f.lotPrefix && /^[A-Za-z0-9._-]{1,40}$/.test(f.lotPrefix)) conds.push(like(inventoryLots.lotNumber, `${f.lotPrefix.toUpperCase()}%`));
  if (f.warehouseId && isUuid(f.warehouseId)) {
    conds.push(
      sql`exists (select 1 from ${inventoryBalances} b join ${locations} l on l.id = b.location_id where b.lot_id = ${inventoryLots.id} and b.qty_base > 0 and l.warehouse_id = ${f.warehouseId})`,
    );
  }
  // Finished lots whose batch is not decided yet are decided through batch release, never in bulk.
  conds.push(or(isNull(inventoryLots.sourceBatchId), inArray(batches.status, [...BATCH_DECIDED_STATUSES]))!);
  const rows = await db
    .select({
      id: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      qualityStatus: inventoryLots.qualityStatus,
      itemKind: inventoryLots.itemKind,
      expiresOn: inventoryLots.expiresOn,
      supplierName: inventoryLots.supplierName,
      supplierLotNumber: inventoryLots.supplierLotNumber,
      baseUom: inventoryLots.baseUom,
      itemName: sql<string>`coalesce(${materials.name}, ${products.name})`,
      itemCode: sql<string>`coalesce(${materials.code}, ${products.skuCode})`,
      materialKind: materials.materialKind,
      onHand: sql<string>`coalesce((select sum(b.qty_base) from ${inventoryBalances} b where b.lot_id = ${inventoryLots.id}), 0)::text`,
    })
    .from(inventoryLots)
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .leftJoin(batches, eq(batches.id, inventoryLots.sourceBatchId))
    .where(and(...conds))
    .orderBy(asc(inventoryLots.expiresOn), asc(inventoryLots.lotNumber))
    .limit(maxLots + 1);
  const whs = await db.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses).where(eq(warehouses.siteId, siteId)).orderBy(asc(warehouses.code));
  const kinds = await db.selectDistinct({ k: materials.materialKind }).from(materials).where(eq(materials.organizationId, ctx.organizationId)).orderBy(asc(materials.materialKind));
  return {
    rows: rows.slice(0, maxLots).map((r) => ({ ...r, expired: isLotExpired(r) })),
    truncated: rows.length > maxLots,
    maxLots,
    warehouses: whs,
    materialKinds: kinds.map((k) => k.k),
    reasonCodes: BULK_REASON_CODES.map((r) => ({ ...r })),
  };
}

export type BulkDispositionInput = { lotIds: string[]; decision: "release" | "reject"; reasonCode: string; note?: string | null; password: string };

export type BulkLotOutcome = { lotId: string; lotNumber: string; ok: boolean; toStatus?: string; message?: string; labelNote?: string | null };

export async function applyBulkDisposition(ctx: AuthContext, input: BulkDispositionInput) {
  ctx.require("quality.disposition.approve");
  if (!["release", "reject"].includes(input.decision)) throw new DomainError("validation", "Choose release or reject.", { field: "decision" });
  const reasonCode = BULK_REASON_CODES.find((r) => r.code === input.reasonCode);
  if (!reasonCode) throw new DomainError("validation", "Choose a reason code.", { field: "reasonCode" });
  const note = optionalText(input.note, "note", 500);
  const ids = [...new Set(input.lotIds ?? [])];
  if (ids.length === 0) throw new DomainError("validation", "Select at least one lot.", { field: "lotIds" });
  if (!ids.every(isUuid)) throw new DomainError("validation", "The selection contains an invalid lot.", { field: "lotIds" });
  const maxLots = await getSetting(db, ctx.organizationId, "quality.bulk_disposition.max_lots");
  if (ids.length > maxLots) throw new DomainError("validation", `Select at most ${maxLots} lots per run.`, { field: "lotIds" });

  // Re-authentication (restricted decision, permissions matrix "R"): the user re-enters their password.
  const [me] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, ctx.userId)).limit(1);
  if (!me || !input.password || !(await verifyPassword(me.hash, input.password))) {
    throw new DomainError("reauth_required", "Your password did not match. Enter your own password to confirm this bulk decision.", { field: "password" });
  }

  const correlationId = uuidv7();
  const bulk = new AuthContext(ctx.userId, ctx.organizationId, ctx.displayName, ctx.email, ctx.roleCodes, ctx.permissions, ctx.allowedSites, ctx.currentSiteId, { ...ctx.options, correlationId });
  const reason = note ? `${reasonCode.code}: ${note}` : reasonCode.code;
  const lots = await db.select({ id: inventoryLots.id, lotNumber: inventoryLots.lotNumber, siteId: inventoryLots.siteId, qualityStatus: inventoryLots.qualityStatus }).from(inventoryLots).where(and(inArray(inventoryLots.id, ids), eq(inventoryLots.organizationId, ctx.organizationId)));
  const byId = new Map(lots.map((l) => [l.id, l]));
  const outcomes: BulkLotOutcome[] = [];
  for (const id of ids) {
    const l = byId.get(id);
    if (!l || l.siteId !== ctx.currentSiteId) {
      outcomes.push({ lotId: id, lotNumber: l?.lotNumber ?? "—", ok: false, message: "Not found at your current site." });
      continue;
    }
    const decision: LotDecision = input.decision === "reject" ? "reject" : l.qualityStatus === "on_hold" ? "release_from_hold" : "release";
    try {
      const r = await decideLot(bulk, { lotId: id, decision, reason }, { statusLabel: true });
      outcomes.push({ lotId: id, lotNumber: r.lotNumber, ok: true, toStatus: r.toStatus, labelNote: r.labelNote });
    } catch (e) {
      if (e instanceof DomainError) outcomes.push({ lotId: id, lotNumber: l.lotNumber, ok: false, message: e.message });
      else throw e;
    }
  }
  const done = outcomes.filter((o) => o.ok).length;
  await audit(db, bulk, {
    action: "quality.disposition.bulk_applied",
    entityType: "bulk_disposition",
    entityId: correlationId,
    siteId: ctx.currentSiteId,
    reason,
    after: { decision: input.decision, reasonCode: reasonCode.code, selected: ids.length, done, failed: ids.length - done, failures: outcomes.filter((o) => !o.ok).map((o) => ({ lot: o.lotNumber, message: o.message })) },
  });
  return { correlationId, total: ids.length, done, failed: ids.length - done, outcomes };
}
