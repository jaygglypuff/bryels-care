import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import { db, type Tx } from "@/db/client";
import {
  containerContents,
  containers,
  inventoryBalances,
  inventoryLots,
  locations,
  materials,
  products,
  stockAdjustmentLines,
  stockAdjustments,
  approvalDecisions,
  users,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { assertReasonCode } from "@/modules/masterdata";
import { postMovement } from "./ledger";
import { isUuid } from "./lots";
import { claimIdempotencyKey, stateMachine, storeIdempotentResult } from "./command-kit";
import { assertLocationsNotFrozen } from "./counts";
import { looseQty } from "./moves";
import { getInventorySetting } from "./policy";
import { type ApprovalEvaluation, canDecideEvaluatedStep, evaluateApprovalRules, evaluateApprovalRulesAudited } from "@/modules/governance";

/** Value basis of the `stock_adjustment` approval rules; an unknown value counts as above every bound when configured. */
function adjustmentBasis(total: Decimal.Value, valueUnknown: boolean, unknownNeeds: boolean) {
  return { amount: valueUnknown && unknownNeeds ? ("unbounded" as const) : new Decimal(total).toString() };
}

/** Wave 1 documents carry one boolean for a second step; more steps need a document change first. */
function assertTwoSteps(ev: ApprovalEvaluation) {
  if (ev.steps.length > 2) throw new DomainError("setup_required", "The approval rules for stock adjustments define more than two steps; adjustments support two. Ask the owner to adjust the rules.");
}

type AdjustmentStatus = "draft" | "submitted" | "approved" | "rejected" | "posted" | "cancelled";

/** Stock adjustment document state machine (A-DM-32). An unapproved adjustment can never post. */
export const adjustmentMachine = stateMachine<AdjustmentStatus>("stock_adjustment", {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "rejected", "cancelled"],
  approved: ["posted", "cancelled"],
  rejected: [],
  posted: [],
  cancelled: [],
});

const QTY_RE = /^\d{1,12}(\.\d{1,6})?$/;
const MONEY_RE = /^\d{1,14}(\.\d{1,4})?$/;

export type AdjustmentLineInput = {
  lotId?: string | null;
  locationId: string;
  containerId?: string | null;
  direction: "increase" | "decrease";
  qty: string;
  unitCost?: string | null;
  note?: string | null;
  /** Found stock with no lot yet (W03 "found unlabelled"): the lot to create at posting, on QA hold. */
  newLot?: { materialId?: string | null; productId?: string | null; expiresOn?: string | null; supplierLotNumber?: string | null } | null;
};

export type CreateAdjustmentInput = { reasonCode: string; reasonNote?: string | null; lines: AdjustmentLineInput[]; idempotencyKey: string };

async function lockAdjustment(tx: Tx, ctx: AuthContext, id: string) {
  if (!isUuid(id)) throw new DomainError("not_found", "Adjustment not found in your sites.");
  const [a] = await tx.select().from(stockAdjustments).where(eq(stockAdjustments.id, id)).for("update").limit(1);
  if (!a || a.organizationId !== ctx.organizationId || !ctx.allowedSiteIds.includes(a.siteId)) throw new DomainError("not_found", "Adjustment not found in your sites.");
  ctx.requireSite(a.siteId);
  return a;
}

/** Drafts an adjustment (found / lost / damaged …) at the current site. Nothing posts until approved. */
export async function createAdjustment(ctx: AuthContext, input: CreateAdjustmentInput) {
  ctx.require("inventory.adjustment.create");
  ctx.requireSite(ctx.currentSiteId);
  // Shared reason codes, category `adjustment` (US-1-24): active code; codes that need a note (Other) get one.
  await assertReasonCode(db, ctx.organizationId, "adjustment", input.reasonCode, input.reasonNote);
  if (!input.lines?.length) throw new DomainError("validation", "Add at least one line.");
  if (input.lines.length > 100) throw new DomainError("validation", "An adjustment can have at most 100 lines.");
  const key = `adjustment_create:${input.idempotencyKey}`;
  const body = { ...input, idempotencyKey: undefined };
  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<{ id: string; adjustmentNumber: string }>(tx, ctx.organizationId, key, "inventory.adjustment.create", body);
    if (claimed) return { ...claimed.replay, replayed: true };
    const siteId = ctx.currentSiteId;
    const rows: (typeof stockAdjustmentLines.$inferInsert)[] = [];
    let lineNo = 0;
    for (const l of input.lines) {
      lineNo++;
      const where = `Line ${lineNo}`;
      if (l.direction !== "increase" && l.direction !== "decrease") throw new DomainError("validation", `${where}: choose increase or decrease.`);
      if (!QTY_RE.test(l.qty ?? "") || new Decimal(l.qty).lte(0)) throw new DomainError("validation", `${where}: enter a quantity greater than zero.`);
      if (l.unitCost && !MONEY_RE.test(l.unitCost)) throw new DomainError("validation", `${where}: enter the unit cost as a number (up to 4 decimals).`);
      const [loc] = isUuid(l.locationId) ? await tx.select().from(locations).where(eq(locations.id, l.locationId)) : [];
      if (!loc || loc.siteId !== siteId) throw new DomainError("validation", `${where}: choose a location of this site.`);
      let lotId: string | null = null;
      let uom: string;
      if (l.lotId) {
        const [lot] = isUuid(l.lotId) ? await tx.select().from(inventoryLots).where(eq(inventoryLots.id, l.lotId)) : [];
        if (!lot || lot.siteId !== siteId) throw new DomainError("validation", `${where}: the lot is not at this site.`);
        lotId = lot.id;
        uom = lot.baseUom;
        if (l.direction === "decrease") {
          const [bal] = await tx.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, lot.id), eq(inventoryBalances.locationId, loc.id)));
          if (new Decimal(bal?.qtyBase ?? 0).lt(l.qty)) throw new DomainError("insufficient_stock", `${where}: only ${new Decimal(bal?.qtyBase ?? 0).toString()} ${lot.baseUom} of lot ${lot.lotNumber} is at ${loc.code}.`);
        }
      } else {
        ctx.require("inventory.lot.create");
        const nl = l.newLot;
        if (l.direction !== "increase" || !nl || (!!nl.materialId === !!nl.productId)) throw new DomainError("validation", `${where}: choose the lot, or for found stock the material or product of the new lot.`);
        if (nl.expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(nl.expiresOn)) throw new DomainError("validation", `${where}: enter the expiry as YYYY-MM-DD.`);
        if (nl.materialId) {
          const [m] = isUuid(nl.materialId) ? await tx.select().from(materials).where(and(eq(materials.id, nl.materialId), eq(materials.organizationId, ctx.organizationId))) : [];
          if (!m) throw new DomainError("validation", `${where}: material not found.`);
          uom = m.baseUom;
        } else {
          const [p] = isUuid(nl.productId!) ? await tx.select().from(products).where(and(eq(products.id, nl.productId!), eq(products.organizationId, ctx.organizationId))) : [];
          if (!p) throw new DomainError("validation", `${where}: product not found.`);
          uom = p.baseUom;
        }
      }
      if (uom === "pcs" && !new Decimal(l.qty).isInteger()) throw new DomainError("validation", `${where}: this item is counted in pieces; enter a whole number.`);
      if (l.containerId) {
        const [box] = isUuid(l.containerId) ? await tx.select().from(containers).where(eq(containers.id, l.containerId)) : [];
        if (!box || box.siteId !== siteId || box.currentLocationId !== loc.id) throw new DomainError("validation", `${where}: the box is not at ${loc.code}.`);
        if (!lotId) throw new DomainError("validation", `${where}: found stock is adjusted loose; pack it into a box afterwards.`);
      }
      rows.push({
        stockAdjustmentId: "",
        lineNo,
        lotId,
        locationId: loc.id,
        containerId: l.containerId || null,
        direction: l.direction,
        qtyBase: new Decimal(l.qty).toString(),
        unitCostAmount: l.unitCost || null,
        note: l.note?.trim() || null,
        newLotMaterialId: lotId ? null : l.newLot?.materialId || null,
        newLotProductId: lotId ? null : l.newLot?.productId || null,
        newLotExpiresOn: lotId ? null : l.newLot?.expiresOn || null,
        newLotSupplierLotNumber: lotId ? null : l.newLot?.supplierLotNumber?.trim() || null,
      });
    }
    const number = await nextNumber(tx, ctx.organizationId, "ADJ");
    const [a] = await tx
      .insert(stockAdjustments)
      .values({ organizationId: ctx.organizationId, siteId, adjustmentNumber: number, status: "draft", reasonCode: input.reasonCode, reasonNote: input.reasonNote?.trim() || null, createdBy: ctx.userId, currency: "PHP" })
      .returning();
    await tx.insert(stockAdjustmentLines).values(rows.map((r) => ({ ...r, stockAdjustmentId: a.id })));
    await audit(tx, ctx, {
      action: "inventory.stock_adjustment.created",
      entityType: "stock_adjustment",
      entityId: a.id,
      entityNumber: number,
      siteId,
      reason: input.reasonCode,
      after: { lines: rows.length, reasonCode: input.reasonCode },
    });
    const result = { id: a.id, adjustmentNumber: number };
    await storeIdempotentResult(tx, ctx.organizationId, key, body, result);
    return { ...result, replayed: false };
  });
}

/** Submits a draft for approval; computes the value basis of the approval rule. */
export async function submitAdjustment(ctx: AuthContext, id: string) {
  ctx.require("inventory.adjustment.submit");
  return db.transaction(async (tx) => {
    const a = await lockAdjustment(tx, ctx, id);
    adjustmentMachine.assert(a.status, "submitted", `Adjustment ${a.adjustmentNumber}`);
    const lines = await tx.select().from(stockAdjustmentLines).where(eq(stockAdjustmentLines.stockAdjustmentId, a.id));
    const valueUnknown = lines.some((l) => l.unitCostAmount === null);
    const total = lines.reduce((s, l) => (l.unitCostAmount === null ? s : s.plus(new Decimal(l.qtyBase).times(l.unitCostAmount))), new Decimal(0));
    // US-1-14: the thresholds are `approval_rules` rows (document type stock_adjustment), evaluated and audited here.
    const unknownNeeds = await getInventorySetting(tx, a.organizationId, a.siteId, "inventory.adjustment.unknown_value_requires_second_step");
    const ev = await evaluateApprovalRulesAudited(tx, ctx, { documentType: "stock_adjustment", siteId: a.siteId, recordId: a.id, recordNumber: a.adjustmentNumber, basis: adjustmentBasis(total, valueUnknown, unknownNeeds) });
    assertTwoSteps(ev);
    const requiresSecond = ev.steps.length > 1;
    await tx
      .update(stockAdjustments)
      .set({ status: "submitted", submittedBy: ctx.userId, submittedAt: new Date(), totalValueAmount: total.toDecimalPlaces(4).toString(), valueUnknown, requiresSecondApproval: requiresSecond, updatedAt: new Date() })
      .where(eq(stockAdjustments.id, a.id));
    await audit(tx, ctx, {
      action: "inventory.stock_adjustment.submitted",
      entityType: "stock_adjustment",
      entityId: a.id,
      entityNumber: a.adjustmentNumber,
      siteId: a.siteId,
      before: { status: a.status },
      after: { status: "submitted", totalValue: total.toString(), valueUnknown, requiresSecondApproval: requiresSecond },
    });
    return { requiresSecondApproval: requiresSecond, totalValue: total.toString(), valueUnknown };
  });
}

function assertNotOwn(a: { createdBy: string; submittedBy: string | null }, ctx: AuthContext) {
  if (ctx.sodBlocks(a.createdBy === ctx.userId || a.submittedBy === ctx.userId, "SEPARATION_OF_DUTIES: you drafted or submitted this adjustment, so someone else must approve it.")) {
    throw new DomainError("separation_of_duties", "SEPARATION_OF_DUTIES: you drafted or submitted this adjustment, so someone else must approve it.", { ...ctx.refusalDetails(), rule: "authz.sod.approve_own" });
  }
}

/**
 * Approves a submitted adjustment. Step 1 by a holder of inventory.adjustment.approve other than the
 * drafter/submitter; above the value threshold a second step by the configured role (default
 * owner_director), again a different person, is required before it is approved.
 */
export async function approveAdjustment(ctx: AuthContext, id: string, note?: string | null) {
  ctx.require("inventory.adjustment.approve");
  return db.transaction(async (tx) => {
    const a = await lockAdjustment(tx, ctx, id);
    if (a.status !== "submitted") throw new DomainError("state", `Adjustment ${a.adjustmentNumber} is ${a.status}; only a submitted adjustment can be approved.`);
    assertNotOwn(a, ctx);
    const decisions = await tx
      .select()
      .from(approvalDecisions)
      .where(and(eq(approvalDecisions.recordType, "stock_adjustment"), eq(approvalDecisions.recordId, a.id), eq(approvalDecisions.decision, "approved")));
    const step = decisions.some((d) => d.step === 1) ? 2 : 1;
    const unknownNeeds = await getInventorySetting(tx, a.organizationId, a.siteId, "inventory.adjustment.unknown_value_requires_second_step");
    const ev = await evaluateApprovalRules(tx, a.organizationId, { documentType: "stock_adjustment", siteId: a.siteId, basis: adjustmentBasis(a.totalValueAmount ?? 0, a.valueUnknown, unknownNeeds) });
    const stepDef = ev.steps[step - 1];
    const pendingSince = step === 1 ? a.submittedAt : (decisions.find((d) => d.step === 1)?.decidedAt ?? null);
    if (stepDef && !canDecideEvaluatedStep(ctx, stepDef, pendingSince)) {
      const roles = stepDef.roleCodes.map((r) => r.replace(/_/g, " ")).join(" or ");
      throw new DomainError("forbidden", step === 2 ? `This adjustment is above the approval threshold; the second approval needs the ${roles} role.` : `This approval needs the ${roles} role.`);
    }
    ctx.assertSeparation(step === 2 && decisions.some((d) => d.decidedBy === ctx.userId), "SEPARATION_OF_DUTIES: the second approval must come from a different person than the first.");
    await tx.insert(approvalDecisions).values({ organizationId: a.organizationId, siteId: a.siteId, recordType: "stock_adjustment", recordId: a.id, step, decision: "approved", decidedBy: ctx.userId, note: note?.trim() || null });
    const final = step === 2 || !a.requiresSecondApproval;
    if (final) {
      adjustmentMachine.assert(a.status, "approved", `Adjustment ${a.adjustmentNumber}`);
      await tx.update(stockAdjustments).set({ status: "approved", approvedBy: ctx.userId, approvedAt: new Date(), updatedAt: new Date() }).where(eq(stockAdjustments.id, a.id));
    }
    await audit(tx, ctx, {
      action: "inventory.stock_adjustment.approved",
      entityType: "stock_adjustment",
      entityId: a.id,
      entityNumber: a.adjustmentNumber,
      siteId: a.siteId,
      reason: note?.trim() || null,
      before: { status: a.status },
      after: { status: final ? "approved" : "submitted", step, awaitingSecondStep: !final },
    });
    return { status: (final ? "approved" : "submitted") as AdjustmentStatus, step, awaitingSecondStep: !final };
  });
}

export async function rejectAdjustment(ctx: AuthContext, id: string, reason: string) {
  ctx.require("inventory.adjustment.approve");
  if (!reason?.trim() || reason.trim().length < 3) throw new DomainError("validation", "Say why the adjustment is rejected (at least 3 characters).");
  return db.transaction(async (tx) => {
    const a = await lockAdjustment(tx, ctx, id);
    adjustmentMachine.assert(a.status, "rejected", `Adjustment ${a.adjustmentNumber}`);
    assertNotOwn(a, ctx);
    const [{ steps }] = await tx
      .select({ steps: sql<number>`count(*)::int` })
      .from(approvalDecisions)
      .where(and(eq(approvalDecisions.recordType, "stock_adjustment"), eq(approvalDecisions.recordId, a.id), eq(approvalDecisions.decision, "approved")));
    await tx.insert(approvalDecisions).values({ organizationId: a.organizationId, siteId: a.siteId, recordType: "stock_adjustment", recordId: a.id, step: steps + 1, decision: "rejected", decidedBy: ctx.userId, note: reason.trim() });
    await tx.update(stockAdjustments).set({ status: "rejected", rejectedBy: ctx.userId, rejectedAt: new Date(), rejectionReason: reason.trim(), updatedAt: new Date() }).where(eq(stockAdjustments.id, a.id));
    await audit(tx, ctx, {
      action: "inventory.stock_adjustment.rejected",
      entityType: "stock_adjustment",
      entityId: a.id,
      entityNumber: a.adjustmentNumber,
      siteId: a.siteId,
      reason: reason.trim(),
      before: { status: a.status },
      after: { status: "rejected" },
    });
  });
}

export async function cancelAdjustment(ctx: AuthContext, id: string, reason: string) {
  ctx.require("inventory.adjustment.create");
  if (!reason?.trim() || reason.trim().length < 3) throw new DomainError("validation", "Say why the adjustment is cancelled (at least 3 characters).");
  return db.transaction(async (tx) => {
    const a = await lockAdjustment(tx, ctx, id);
    adjustmentMachine.assert(a.status, "cancelled", `Adjustment ${a.adjustmentNumber}`);
    if (a.createdBy !== ctx.userId && !ctx.can("inventory.adjustment.approve")) throw new DomainError("forbidden", "Only the person who drafted it or an approver can cancel this adjustment.");
    await tx.update(stockAdjustments).set({ status: "cancelled", cancelledBy: ctx.userId, cancelledAt: new Date(), cancelReason: reason.trim(), updatedAt: new Date() }).where(eq(stockAdjustments.id, a.id));
    await audit(tx, ctx, {
      action: "inventory.stock_adjustment.cancelled",
      entityType: "stock_adjustment",
      entityId: a.id,
      entityNumber: a.adjustmentNumber,
      siteId: a.siteId,
      reason: reason.trim(),
      before: { status: a.status },
      after: { status: "cancelled" },
    });
  });
}

/**
 * Posts an approved adjustment: one `adjustment` movement per line with the header reason
 * (source `stock_adjustment`). Found-stock lines first create their lot on QA hold
 * (inventory.inventory_lot.created). Above the threshold the poster must differ from the final
 * approver (A-PM-10). Locations inside an active count are refused (V-FREEZE).
 */
export async function postAdjustment(ctx: AuthContext, id: string, idempotencyKey: string) {
  ctx.require("inventory.adjustment.post");
  const key = `adjustment_post:${id}:${idempotencyKey}`;
  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<{ movements: string[] }>(tx, ctx.organizationId, key, "inventory.adjustment.post", { id });
    if (claimed) return { ...claimed.replay, replayed: true };
    const a = await lockAdjustment(tx, ctx, id);
    if (a.status !== "approved") throw new DomainError("state", `Adjustment ${a.adjustmentNumber} is ${a.status}; only an approved adjustment can be posted.`, { rule: "inventory.adjustment_post_requires_approval" });
    if (ctx.sodBlocks(a.requiresSecondApproval && a.approvedBy === ctx.userId, "SEPARATION_OF_DUTIES: above the approval threshold the person who posts must differ from the final approver.")) {
      throw new DomainError("separation_of_duties", "SEPARATION_OF_DUTIES: above the approval threshold the person who posts must differ from the final approver.", ctx.refusalDetails());
    }
    const lines = await tx.select().from(stockAdjustmentLines).where(eq(stockAdjustmentLines.stockAdjustmentId, a.id)).orderBy(asc(stockAdjustmentLines.lineNo));
    const boxIds = [...new Set(lines.map((l) => l.containerId).filter((x): x is string => !!x))].sort();
    if (boxIds.length) await tx.select({ id: containers.id }).from(containers).where(inArray(containers.id, boxIds)).orderBy(asc(containers.id)).for("update");
    const lotIds = [...new Set(lines.map((l) => l.lotId).filter((x): x is string => !!x))].sort();
    if (lotIds.length) await tx.select({ id: inventoryLots.id }).from(inventoryLots).where(inArray(inventoryLots.id, lotIds)).orderBy(asc(inventoryLots.id)).for("update");
    await assertLocationsNotFrozen(tx, lines.map((l) => l.locationId));
    const correlationId = randomUUID();
    const movements: string[] = [];
    for (const l of lines) {
      let lotId = l.lotId;
      if (!lotId) {
        const lotNumber = await nextNumber(tx, ctx.organizationId, "LOT");
        const [m] = l.newLotMaterialId ? await tx.select().from(materials).where(eq(materials.id, l.newLotMaterialId)) : [];
        const [p] = l.newLotProductId ? await tx.select().from(products).where(eq(products.id, l.newLotProductId)) : [];
        const [lot] = await tx
          .insert(inventoryLots)
          .values({
            organizationId: a.organizationId,
            siteId: a.siteId,
            lotNumber,
            itemKind: m ? "material" : "product",
            materialId: m?.id ?? null,
            productId: p?.id ?? null,
            supplierLotNumber: l.newLotSupplierLotNumber,
            expiresOn: l.newLotExpiresOn,
            // Found stock is not usable until QA identifies it (W03 exception path).
            qualityStatus: "on_hold",
            baseUom: (m ?? p)!.baseUom,
            createdBy: ctx.userId,
          })
          .returning();
        lotId = lot.id;
        await tx.update(stockAdjustmentLines).set({ lotId }).where(eq(stockAdjustmentLines.id, l.id));
        await audit(tx, ctx, {
          action: "inventory.inventory_lot.created",
          entityType: "inventory_lot",
          entityId: lot.id,
          entityNumber: lotNumber,
          siteId: a.siteId,
          reason: a.reasonCode,
          after: { qualityStatus: "on_hold", source: a.adjustmentNumber },
        });
      }
      const qty = new Decimal(l.qtyBase);
      if (l.direction === "decrease" && !l.containerId) {
        const loose = await looseQty(tx, lotId, l.locationId);
        if (loose.lt(qty)) throw new DomainError("insufficient_stock", `Line ${l.lineNo}: only ${loose.toString()} is loose at the location; the rest is in boxes, so adjust the box instead.`);
      }
      if (l.containerId) {
        const [content] = await tx.select().from(containerContents).where(and(eq(containerContents.containerId, l.containerId), eq(containerContents.lotId, lotId)));
        if (l.direction === "decrease") {
          if (!content || new Decimal(content.qtyBase).lt(qty)) throw new DomainError("insufficient_stock", `Line ${l.lineNo}: the box holds less than ${qty.toString()} of this lot.`);
          await tx.update(containerContents).set({ qtyBase: sql`${containerContents.qtyBase} - ${qty.toString()}`, updatedAt: new Date() }).where(eq(containerContents.id, content.id));
        } else {
          const [lot] = await tx.select({ baseUom: inventoryLots.baseUom }).from(inventoryLots).where(eq(inventoryLots.id, lotId));
          await tx
            .insert(containerContents)
            .values({ organizationId: a.organizationId, siteId: a.siteId, containerId: l.containerId, lotId, baseUom: lot.baseUom, qtyBase: qty.toString() })
            .onConflictDoUpdate({ target: [containerContents.containerId, containerContents.lotId], set: { qtyBase: sql`${containerContents.qtyBase} + ${qty.toString()}`, updatedAt: new Date() } });
        }
      }
      const { movement } = await postMovement(tx, ctx, {
        movementType: "adjustment",
        lotId,
        fromLocationId: l.direction === "decrease" ? l.locationId : null,
        toLocationId: l.direction === "increase" ? l.locationId : null,
        qtyBase: qty,
        sourceDocumentType: "stock_adjustment",
        sourceDocumentId: a.id,
        sourceDocumentNumber: a.adjustmentNumber,
        reason: a.reasonCode + (a.reasonNote ? `: ${a.reasonNote}` : ""),
        idempotencyKey: `${key}:${l.lineNo}`,
        correlationId,
        meta: { containerId: l.containerId, lineNo: l.lineNo, direction: l.direction },
      });
      await tx.update(stockAdjustmentLines).set({ stockMovementId: movement.id }).where(eq(stockAdjustmentLines.id, l.id));
      movements.push(movement.id);
    }
    await tx.update(stockAdjustments).set({ status: "posted", postedBy: ctx.userId, postedAt: new Date(), correlationId, idempotencyKey: key, updatedAt: new Date() }).where(eq(stockAdjustments.id, a.id));
    await audit(tx, ctx, {
      action: "inventory.stock_adjustment.posted",
      entityType: "stock_adjustment",
      entityId: a.id,
      entityNumber: a.adjustmentNumber,
      siteId: a.siteId,
      reason: a.reasonCode,
      before: { status: a.status },
      after: { status: "posted", movements: movements.length, correlationId },
    });
    const result = { movements };
    await storeIdempotentResult(tx, ctx.organizationId, key, { id }, result);
    return { ...result, replayed: false };
  });
}

export async function listAdjustments(ctx: AuthContext, f: { status?: string } = {}) {
  ctx.require("inventory.adjustment.view");
  ctx.requireSite(ctx.currentSiteId);
  const conds = [eq(stockAdjustments.siteId, ctx.currentSiteId)];
  if (f.status) conds.push(eq(stockAdjustments.status, f.status));
  return db
    .select({
      id: stockAdjustments.id,
      number: stockAdjustments.adjustmentNumber,
      status: stockAdjustments.status,
      reasonCode: stockAdjustments.reasonCode,
      requiresSecondApproval: stockAdjustments.requiresSecondApproval,
      totalValueAmount: stockAdjustments.totalValueAmount,
      valueUnknown: stockAdjustments.valueUnknown,
      createdAt: stockAdjustments.createdAt,
      createdBy: users.displayName,
      lines: sql<number>`(select count(*)::int from ${stockAdjustmentLines} l where l.stock_adjustment_id = ${stockAdjustments.id})`,
    })
    .from(stockAdjustments)
    .innerJoin(users, eq(users.id, stockAdjustments.createdBy))
    .where(and(...conds))
    .orderBy(desc(stockAdjustments.createdAt))
    .limit(200);
}

export async function getAdjustment(ctx: AuthContext, id: string) {
  ctx.require("inventory.adjustment.view");
  if (!isUuid(id)) throw new DomainError("not_found", "Adjustment not found in your sites.");
  const [a] = await db
    .select()
    .from(stockAdjustments)
    .where(and(eq(stockAdjustments.id, id), eq(stockAdjustments.organizationId, ctx.organizationId), inArray(stockAdjustments.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!a) throw new DomainError("not_found", "Adjustment not found in your sites.");
  ctx.requireSite(a.siteId);
  const lines = await db
    .select({
      id: stockAdjustmentLines.id,
      lineNo: stockAdjustmentLines.lineNo,
      direction: stockAdjustmentLines.direction,
      qtyBase: stockAdjustmentLines.qtyBase,
      unitCostAmount: stockAdjustmentLines.unitCostAmount,
      note: stockAdjustmentLines.note,
      lotId: stockAdjustmentLines.lotId,
      lotNumber: inventoryLots.lotNumber,
      baseUom: inventoryLots.baseUom,
      locationCode: locations.code,
      containerNumber: containers.containerNumber,
      newLotItem: sql<string | null>`coalesce((select m.name from ${materials} m where m.id = ${stockAdjustmentLines.newLotMaterialId}), (select p.name from ${products} p where p.id = ${stockAdjustmentLines.newLotProductId}))`,
      itemName: sql<string | null>`coalesce(${materials.name}, ${products.name})`,
      stockMovementId: stockAdjustmentLines.stockMovementId,
    })
    .from(stockAdjustmentLines)
    .innerJoin(locations, eq(locations.id, stockAdjustmentLines.locationId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, stockAdjustmentLines.lotId))
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .leftJoin(containers, eq(containers.id, stockAdjustmentLines.containerId))
    .where(eq(stockAdjustmentLines.stockAdjustmentId, a.id))
    .orderBy(asc(stockAdjustmentLines.lineNo));
  const decisions = await db
    .select({ step: approvalDecisions.step, decision: approvalDecisions.decision, byId: approvalDecisions.decidedBy, by: users.displayName, at: approvalDecisions.decidedAt, note: approvalDecisions.note })
    .from(approvalDecisions)
    .innerJoin(users, eq(users.id, approvalDecisions.decidedBy))
    .where(and(eq(approvalDecisions.recordType, "stock_adjustment"), eq(approvalDecisions.recordId, a.id)))
    .orderBy(asc(approvalDecisions.decidedAt));
  const people = await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, [a.createdBy, a.submittedBy, a.approvedBy, a.postedBy].filter((x): x is string => !!x)));
  const name = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? null;
  const own = a.createdBy === ctx.userId || a.submittedBy === ctx.userId;
  const stepDone = decisions.some((d) => d.step === 1 && d.decision === "approved");
  return {
    ...a,
    lines,
    decisions,
    createdByName: name(a.createdBy),
    submittedByName: name(a.submittedBy),
    approvedByName: name(a.approvedBy),
    postedByName: name(a.postedBy),
    can: {
      submit: a.status === "draft" && ctx.can("inventory.adjustment.submit"),
      approve: a.status === "submitted" && ctx.can("inventory.adjustment.approve") && !(own && !ctx.ownerOverride) && !decisions.some((d) => ctx.sodConflict(d.byId) && d.decision === "approved"),
      post: a.status === "approved" && ctx.can("inventory.adjustment.post"),
      cancel: ["draft", "submitted", "approved"].includes(a.status) && (a.createdBy === ctx.userId ? ctx.can("inventory.adjustment.create") : ctx.can("inventory.adjustment.approve")),
      awaitingSecondStep: a.status === "submitted" && a.requiresSecondApproval && stepDone,
      own,
    },
  };
}

export type AdjustmentDetail = Awaited<ReturnType<typeof getAdjustment>>;
