import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import { db, type Tx } from "@/db/client";
import { batches, formulaRevisions, formulas, productionLines, productionPlanLines, products, salesOrders, users, workOrderStateTransitions, workOrders } from "@/db/schema";
import { uuidv7 } from "uuidv7";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { getEffectiveFormulaRevision, getEffectiveRouting } from "@/modules/masterdata";
import { idempotent } from "./shared";
import { transitionBatch } from "./state";
import { transitionWorkOrder, type WorkOrderStatus } from "./work-orders-state";
import { batchesOfWorkOrder, endReservationsForDemand, insertWorkOrderReservations, reserveWorkOrderMaterials, type Shortage } from "./work-orders-reserve";
import { notifyProductionOrderApprovers } from "./production-order-approvals";

/**
 * Work orders (US-3-05; docs/process-maps.md W05-02, W05-04; docs/data-model.md §3.5, §6.3).
 * Every command takes AuthContext first, checks permission and site, runs in one transaction,
 * goes through the work order state machine and writes audit events `production.work_order.*`.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.").refine((v) => !Number.isNaN(Date.parse(v + "T00:00:00Z")), "Choose a valid date.");
const optUuid = z
  .string()
  .uuid("Choose a valid option.")
  .nullish()
  .or(z.literal("").transform(() => null));
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .nullish()
    .transform((v) => (v ? v : null));

export const workOrderInputSchema = z
  .object({
    productId: z.string().uuid("Choose the product."),
    formulaId: optUuid,
    /** Batch size in kg with at most 3 decimals (grams); defaults to the formula's reference size. */
    batchSizeKg: z
      .string()
      .trim()
      .regex(/^\d{1,9}(\.\d{1,3})?$/, "Enter the batch size in kg, for example 17.6.")
      .nullish()
      .or(z.literal("").transform(() => null)),
    batchCount: z.coerce.number().int("Enter a whole number of batches.").min(1, "At least one batch.").max(200, "At most 200 batches per work order."),
    plannedStart: isoDate,
    plannedEnd: isoDate,
    /** ADR-080 (V2-2): needed-by date; empty = none; omitted on edit = unchanged. */
    neededBy: isoDate.nullish().or(z.literal("").transform(() => null)),
    productionLineId: optUuid,
    priority: z.coerce.number().int().min(1).max(9).default(5),
    assignedSupervisorId: optUuid,
    targetUnits: z
      .string()
      .trim()
      .regex(/^\d{1,9}$/, "Enter the target units as a whole number.")
      .nullish()
      .or(z.literal("").transform(() => null)),
    notes: optText(1000),
    salesOrderId: optUuid,
  })
  .strict()
  .refine((v) => v.plannedEnd >= v.plannedStart, { path: ["plannedEnd"], message: "The planned end cannot be before the planned start." });
export type WorkOrderInput = z.input<typeof workOrderInputSchema>;

function parseInput(raw: unknown) {
  const r = workOrderInputSchema.safeParse(raw);
  if (!r.success) {
    throw new DomainError("validation", r.error.issues.length > 1 ? "Check the highlighted fields." : r.error.issues[0].message, {
      issues: r.error.issues.map((i) => ({ path: String(i.path[0] ?? "form"), message: i.message })),
    });
  }
  return r.data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loads a work order of the caller's organization with a row lock and checks site scope. */
export async function lockWorkOrder(tx: Tx, ctx: AuthContext, workOrderId: string) {
  if (!UUID.test(workOrderId)) throw new DomainError("not_found", "Work order not found in your sites.");
  const [wo] = await tx
    .select()
    .from(workOrders)
    .where(and(eq(workOrders.id, workOrderId), eq(workOrders.organizationId, ctx.organizationId)))
    .for("update")
    .limit(1);
  if (!wo || !ctx.allowedSiteIds.includes(wo.siteId)) throw new DomainError("not_found", "Work order not found in your sites.");
  ctx.requireSite(wo.siteId);
  return wo;
}

/** Validates references and resolves defaults; shared by create, edit and plan-line conversion. */
async function resolveFields(tx: Tx, ctx: AuthContext, siteId: string, input: ReturnType<typeof parseInput>) {
  const [product] = await tx.select().from(products).where(and(eq(products.id, input.productId), eq(products.organizationId, ctx.organizationId))).limit(1);
  if (!product) throw new DomainError("validation", "Choose a product of your organization.", { field: "productId" });
  const productFormulas = await tx.select().from(formulas).where(and(eq(formulas.productId, product.id), eq(formulas.organizationId, ctx.organizationId)));
  let formula = input.formulaId ? productFormulas.find((f) => f.id === input.formulaId) : undefined;
  if (input.formulaId && !formula) throw new DomainError("validation", "That formula is not a formula of this product.", { field: "formulaId" });
  const effective = await getEffectiveFormulaRevision(ctx, product.id, input.plannedStart, { tx });
  if (!formula) {
    if (effective) formula = productFormulas.find((f) => f.id === effective.formula.id);
    else if (productFormulas.length === 1) formula = productFormulas[0];
  }
  if (!formula) {
    throw new DomainError("validation", productFormulas.length ? "Choose which formula of this product the work order uses." : `${product.name} has no formula yet. Ask the process owner to create and approve one.`, {
      field: productFormulas.length ? "formulaId" : "productId",
    });
  }
  let sizeG: Decimal;
  if (input.batchSizeKg) sizeG = new Decimal(input.batchSizeKg).mul(1000);
  else {
    const [rev] =
      effective && effective.formula.id === formula.id
        ? [effective.rev]
        : await tx.select().from(formulaRevisions).where(and(eq(formulaRevisions.formulaId, formula.id), eq(formulaRevisions.status, "approved"))).orderBy(formulaRevisions.revisionNo).limit(1);
    if (!rev) throw new DomainError("validation", "Enter the batch size: the formula has no approved revision to take it from.", { field: "batchSizeKg" });
    sizeG = new Decimal(rev.referenceBatchSizeG);
  }
  if (sizeG.lte(0)) throw new DomainError("validation", "The batch size must be greater than zero.", { field: "batchSizeKg" });
  if (input.productionLineId) {
    const [line] = await tx.select().from(productionLines).where(eq(productionLines.id, input.productionLineId)).limit(1);
    if (!line || line.siteId !== siteId) throw new DomainError("validation", "Choose a production line of this site.", { field: "productionLineId" });
    if (line.status !== "active") throw new DomainError("validation", `Line ${line.code} is ${line.status}; choose an active line.`, { field: "productionLineId" });
  }
  if (input.assignedSupervisorId) {
    const [u] = await tx.select().from(users).where(and(eq(users.id, input.assignedSupervisorId), eq(users.organizationId, ctx.organizationId))).limit(1);
    if (!u || u.status !== "active") throw new DomainError("validation", "Choose an active person as supervisor.", { field: "assignedSupervisorId" });
  }
  if (input.salesOrderId) {
    const [so] = await tx.select().from(salesOrders).where(eq(salesOrders.id, input.salesOrderId)).limit(1);
    if (!so || so.organizationId !== ctx.organizationId || so.siteId !== siteId) throw new DomainError("validation", "Choose a sales order of this site.", { field: "salesOrderId" });
  }
  return { product, formula, sizeG };
}

/**
 * Inserts a draft work order in the caller's transaction (used by createWorkOrder and by plan
 * line conversion, so both write the same record and audit).
 */
export async function insertWorkOrder(tx: Tx, ctx: AuthContext, raw: unknown, links: { productionPlanLineId?: string | null } = {}) {
  ctx.require("production.work_order.create");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);
  const input = parseInput(raw);
  const { product, formula, sizeG } = await resolveFields(tx, ctx, siteId, input);
  const number = await nextNumber(tx, ctx.organizationId, "WO");
  const [wo] = await tx
    .insert(workOrders)
    .values({
      organizationId: ctx.organizationId,
      siteId,
      workOrderNumber: number,
      status: "draft",
      productId: product.id,
      formulaId: formula.id,
      productionLineId: input.productionLineId ?? null,
      productionPlanLineId: links.productionPlanLineId ?? null,
      salesOrderId: input.salesOrderId ?? null,
      qtyPlannedBase: sizeG.mul(input.batchCount).toString(),
      baseUom: "g",
      batchCount: input.batchCount,
      batchSizeBase: sizeG.toString(),
      targetUnits: input.targetUnits ?? null,
      plannedStart: input.plannedStart,
      plannedEnd: input.plannedEnd,
      neededBy: input.neededBy ?? null,
      priority: input.priority,
      assignedPlannerId: ctx.userId,
      assignedSupervisorId: input.assignedSupervisorId ?? null,
      notes: input.notes,
      statusChangedBy: ctx.userId,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning();
  await transitionlessCreate(tx, ctx, wo);
  await audit(tx, ctx, {
    action: "production.work_order.created",
    entityType: "work_order",
    entityId: wo.id,
    entityNumber: number,
    siteId,
    after: {
      product: product.skuCode,
      formula: formula.code,
      batchCount: input.batchCount,
      batchSizeG: sizeG.toString(),
      qtyPlannedG: wo.qtyPlannedBase,
      plannedStart: input.plannedStart,
      plannedEnd: input.plannedEnd,
      neededBy: input.neededBy ?? null,
      salesOrderId: input.salesOrderId ?? null,
      targetUnits: input.targetUnits ?? null,
      productionPlanLineId: links.productionPlanLineId ?? null,
    },
  });
  return wo;
}

/** The creation row of the transition log (from_state null), as for batches. */
async function transitionlessCreate(tx: Tx, ctx: AuthContext, wo: typeof workOrders.$inferSelect) {
  await tx.insert(workOrderStateTransitions).values({
    organizationId: wo.organizationId,
    siteId: wo.siteId,
    workOrderId: wo.id,
    fromState: null,
    toState: "draft",
    actorId: ctx.userId,
    correlationId: ctx.correlationId && UUID.test(ctx.correlationId) ? ctx.correlationId : uuidv7(),
  });
}

/** Creates a draft work order at the current site (W05-02). */
export async function createWorkOrder(ctx: AuthContext, raw: WorkOrderInput & { idempotencyKey?: string | null }) {
  ctx.require("production.work_order.create");
  const { idempotencyKey, ...rest } = raw;
  return db.transaction(async (tx) => {
    const { result } = await idempotent(tx, ctx, idempotencyKey, "production.work_order.create", async () => {
      const wo = await insertWorkOrder(tx, ctx, rest);
      // Consultant review 2026-10-30 (flow B): the approvers hear about the new order at once (no silent hand-off).
      await notifyProductionOrderApprovers(tx, ctx, wo);
      return { workOrderId: wo.id, workOrderNumber: wo.workOrderNumber };
    });
    return result;
  });
}

/** Edits a draft work order (planned and later states are changed only by their transitions). */
export async function editWorkOrder(ctx: AuthContext, workOrderId: string, raw: WorkOrderInput) {
  ctx.require("production.work_order.edit");
  const input = parseInput(raw);
  return db.transaction(async (tx) => {
    const wo = await lockWorkOrder(tx, ctx, workOrderId);
    if (wo.status !== "draft") throw new DomainError("state", `Work order ${wo.workOrderNumber} is ${wo.status.replace(/_/g, " ")}; only a draft can be edited.`);
    if (input.productId !== wo.productId) throw new DomainError("validation", "The product of a work order cannot change; cancel it and create a new one.", { field: "productId" });
    const { formula, sizeG } = await resolveFields(tx, ctx, wo.siteId, input);
    const after = {
      formulaId: formula.id,
      productionLineId: input.productionLineId ?? null,
      salesOrderId: input.salesOrderId ?? null,
      qtyPlannedBase: sizeG.mul(input.batchCount).toString(),
      batchCount: input.batchCount,
      batchSizeBase: sizeG.toString(),
      targetUnits: input.targetUnits ?? null,
      plannedStart: input.plannedStart,
      plannedEnd: input.plannedEnd,
      neededBy: input.neededBy === undefined ? wo.neededBy : input.neededBy,
      priority: input.priority,
      assignedSupervisorId: input.assignedSupervisorId ?? null,
      notes: input.notes,
    };
    await tx.update(workOrders).set({ ...after, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(workOrders.id, wo.id));
    await audit(tx, ctx, {
      action: "production.work_order.updated",
      entityType: "work_order",
      entityId: wo.id,
      entityNumber: wo.workOrderNumber,
      siteId: wo.siteId,
      before: { batchCount: wo.batchCount, batchSizeBase: wo.batchSizeBase, plannedStart: wo.plannedStart, plannedEnd: wo.plannedEnd, neededBy: wo.neededBy, productionLineId: wo.productionLineId, priority: wo.priority },
      after: { batchCount: after.batchCount, batchSizeBase: after.batchSizeBase, plannedStart: after.plannedStart, plannedEnd: after.plannedEnd, neededBy: after.neededBy, productionLineId: after.productionLineId, priority: after.priority },
    });
    return { workOrderNumber: wo.workOrderNumber };
  });
}

/**
 * draft → planned (W05-02): resolves the approved formula and routing revisions effective on the
 * planned start (V-REV; 422 when either is missing) and records the planner as submitter.
 */
export async function planWorkOrder(ctx: AuthContext, workOrderId: string) {
  ctx.require("production.work_order.submit");
  return db.transaction(async (tx) => {
    const wo = await lockWorkOrder(tx, ctx, workOrderId);
    return planLockedWorkOrder(tx, ctx, wo);
  });
}

/**
 * draft → planned in the caller's transaction on a locked work order (shared by planWorkOrder and
 * the one-step production order approval, ADR-074). The caller has checked the permission.
 */
export async function planLockedWorkOrder(tx: Tx, ctx: AuthContext, wo: typeof workOrders.$inferSelect) {
  if (wo.status !== "draft") await transitionWorkOrder(tx, ctx, wo, "planned"); // throws 409 with the state words
  const [product] = await tx.select().from(products).where(eq(products.id, wo.productId)).limit(1);
  const rev = await getEffectiveFormulaRevision(ctx, wo.productId, wo.plannedStart, { tx });
  if (!rev || rev.formula.id !== wo.formulaId) {
    throw new DomainError("validation", `No approved formula revision of ${product.name} is effective on ${wo.plannedStart}. Approve a revision or move the planned start (V-REV).`, {
      rule: "V-REV",
      fieldErrors: { plannedStart: "No effective formula revision on this date." },
    });
  }
  const routing = await getEffectiveRouting(ctx, wo.productId, wo.plannedStart, { tx });
  if (!routing) {
    throw new DomainError("validation", `${product.name} has no approved routing effective on ${wo.plannedStart}. A routing revision must be approved first (V-REV).`, {
      rule: "V-REV",
      fieldErrors: { plannedStart: "No effective routing revision on this date." },
    });
  }
  const now = new Date();
  await transitionWorkOrder(tx, ctx, wo, "planned", {
    set: { formulaRevisionId: rev.rev.id, routingRevisionId: routing.rev.id, submittedBy: ctx.userId, submittedAt: now },
  });
  const sizeNote = new Decimal(wo.batchSizeBase).eq(rev.rev.referenceBatchSizeG) ? null : `Batch size ${wo.batchSizeBase} g differs from the reference ${rev.rev.referenceBatchSizeG} g; lines scale proportionally.`;
  await audit(tx, ctx, {
    action: "production.work_order.planned",
    entityType: "work_order",
    entityId: wo.id,
    entityNumber: wo.workOrderNumber,
    siteId: wo.siteId,
    before: { status: "draft" },
    after: { status: "planned", formulaRevision: `${rev.formula.code} rev ${rev.rev.revisionNo}`, routingRevision: `${routing.routing.code} rev ${routing.rev.revisionNo}`, note: sizeNote },
  });
  return { workOrderNumber: wo.workOrderNumber, formulaRevision: `${rev.formula.code} rev ${rev.rev.revisionNo}`, routingRevision: `${routing.routing.code} rev ${routing.rev.revisionNo}` };
}

function shortageMessage(shortages: Shortage[]) {
  return shortages.map((s) => `${s.materialName} short ${new Decimal(s.short).toDecimalPlaces(3).toString()} ${s.baseUom}`).join("; ");
}

/**
 * planned → released (W05-04, `production.work_order.approve`): reserves released lots by
 * FEFO/FIFO for the whole requirement, lists shortages and refuses release with a shortage unless
 * `production.work_order.allow_release_with_shortage` is on. Separation of duties against the
 * planner follows `approvals.sod.work_order` (A-PM-14).
 */
export async function releaseWorkOrder(ctx: AuthContext, workOrderId: string, opts: { note?: string | null; idempotencyKey?: string | null } = {}) {
  ctx.require("production.work_order.approve");
  return db.transaction(async (tx) => {
    const { result } = await idempotent(tx, ctx, opts.idempotencyKey, "production.work_order.release", async () => {
      const wo = await lockWorkOrder(tx, ctx, workOrderId);
      if (wo.status !== "planned") await transitionWorkOrder(tx, ctx, wo, "released"); // 409 with plain words
      if (await getSetting(tx, ctx.organizationId, "approvals.sod.work_order_release", wo.siteId)) {
        if (ctx.sodBlocks(wo.submittedBy === ctx.userId, "You planned this work order; another person with release permission must release it.")) {
          throw new DomainError("separation_of_duties", "You planned this work order; another person with release permission must release it.", ctx.refusalDetails());
        }
      }
      return releaseLockedWorkOrder(tx, ctx, wo, opts.note);
    });
    return result;
  });
}

/**
 * planned → released in the caller's transaction on a locked work order (shared by releaseWorkOrder
 * and the one-step production order approval, ADR-074). The caller has checked the permission and
 * separation of duties. Throws `insufficient_stock` with `details.shortages` when stock is short and
 * release with shortage is not allowed; the caller's transaction then rolls back.
 */
export async function releaseLockedWorkOrder(tx: Tx, ctx: AuthContext, wo: typeof workOrders.$inferSelect, note?: string | null) {
  const opts = { note };
  const [rev] = await tx.select().from(formulaRevisions).where(eq(formulaRevisions.id, wo.formulaRevisionId!)).limit(1);
  if (!rev || rev.status !== "approved") {
    throw new DomainError("state", "The formula revision resolved at planning is no longer approved. Cancel this work order and plan a new one (V-REV).", { rule: "V-REV" });
  }
  const { picks, shortages } = await reserveWorkOrderMaterials(tx, ctx, wo);
  const allow = await getSetting(tx, ctx.organizationId, "production.work_order.allow_release_with_shortage", wo.siteId);
  if (shortages.length && !allow) {
    throw new DomainError("insufficient_stock", `Not enough released stock to reserve: ${shortageMessage(shortages)}. Nothing was reserved; receive or release stock, or ask the owner to allow release with shortage.`, {
      shortages,
    });
  }
  const reservations = await insertWorkOrderReservations(tx, ctx, wo, picks);
  const now = new Date();
  await transitionWorkOrder(tx, ctx, wo, "released", {
    set: { approvedBy: ctx.userId, approvedAt: now, approvalNote: opts.note?.trim() || null, releaseShortages: shortages.length ? shortages : null, releasedWithShortage: shortages.length > 0 },
  });
  await audit(tx, ctx, {
    action: "production.work_order.released",
    entityType: "work_order",
    entityId: wo.id,
    entityNumber: wo.workOrderNumber,
    siteId: wo.siteId,
    reason: shortages.length ? `Released with shortage: ${shortageMessage(shortages)}` : null,
    before: { status: "planned" },
    after: { status: "released", reservations: reservations.map((r) => `${r.reservationNumber} ${r.materialCode} ${r.lotNumber}@${r.locationCode} ${r.qty} ${r.baseUom}`), shortages: shortages.map((s) => `${s.materialCode} short ${s.short}`) },
  });
  return { workOrderNumber: wo.workOrderNumber, reservations, shortages };
}

/** Tops up reservations of a released / in-progress work order after stock arrived (same rules as release). */
export async function reserveWorkOrderShortages(ctx: AuthContext, workOrderId: string) {
  ctx.require("production.work_order.approve");
  return db.transaction(async (tx) => {
    const wo = await lockWorkOrder(tx, ctx, workOrderId);
    if (wo.status !== "released" && wo.status !== "in_progress") {
      throw new DomainError("state", `Work order ${wo.workOrderNumber} is ${wo.status.replace(/_/g, " ")}; reservations are topped up only while it is released or in progress.`);
    }
    const { picks, shortages } = await reserveWorkOrderMaterials(tx, ctx, wo);
    const reservations = await insertWorkOrderReservations(tx, ctx, wo, picks);
    await tx.update(workOrders).set({ releaseShortages: shortages.length ? shortages : null, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(workOrders.id, wo.id));
    await audit(tx, ctx, {
      action: "production.work_order.reservations_topped_up",
      entityType: "work_order",
      entityId: wo.id,
      entityNumber: wo.workOrderNumber,
      siteId: wo.siteId,
      after: { reservations: reservations.map((r) => r.reservationNumber), shortages: shortages.map((s) => `${s.materialCode} short ${s.short}`) },
    });
    return { reservations, shortages };
  });
}

/**
 * draft | planned | released → cancelled (`production.work_order.void`, reason required). Active
 * work-order reservations end as `cancelled`; batches that were planned but never staged are
 * abandoned (`planned → rejected`, docs/data-model.md §6.2). Refused once a batch is staged or later.
 */
export async function cancelWorkOrder(ctx: AuthContext, workOrderId: string, reason: string) {
  ctx.require("production.work_order.void");
  const why = reason?.trim() ?? "";
  if (why.length < 5) throw new DomainError("validation", "Give a reason (at least 5 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const wo = await lockWorkOrder(tx, ctx, workOrderId);
    if (!["draft", "planned", "released"].includes(wo.status)) await transitionWorkOrder(tx, ctx, wo, "cancelled", { reason: why });
    const bs = await tx.select().from(batches).where(eq(batches.workOrderId, wo.id)).for("update");
    const blocking = bs.filter((b) => !["draft", "planned", "rejected", "closed"].includes(b.status));
    if (blocking.length) {
      throw new DomainError("state", `Batch ${blocking[0].batchNumber} is ${blocking[0].status.replace(/_/g, " ")}. Return staged materials and finish or reject the batch before cancelling the work order.`);
    }
    for (const b of bs.filter((x) => x.status === "planned" || x.status === "draft")) {
      await transitionBatch(tx, ctx, b, "rejected", { reason: `Work order ${wo.workOrderNumber} cancelled: ${why}` });
      await audit(tx, ctx, { action: "production.batch.abandoned", entityType: "batch", entityId: b.id, entityNumber: b.batchNumber, siteId: b.siteId, reason: why, before: { status: "planned" }, after: { status: "rejected" } });
    }
    const ended = await endReservationsForDemand(tx, ctx, "work_order", wo.id, "cancelled", `Work order ${wo.workOrderNumber} cancelled: ${why}`);
    const before = wo.status;
    await transitionWorkOrder(tx, ctx, wo, "cancelled", { reason: why, set: { cancelReason: why } });
    await audit(tx, ctx, {
      action: "production.work_order.cancelled",
      entityType: "work_order",
      entityId: wo.id,
      entityNumber: wo.workOrderNumber,
      siteId: wo.siteId,
      reason: why,
      before: { status: before },
      after: { status: "cancelled", reservationsEnded: ended, batchesAbandoned: bs.filter((b) => b.status === "rejected").length },
    });
    return { workOrderNumber: wo.workOrderNumber, reservationsEnded: ended };
  });
}

const STARTED: readonly string[] = ["in_process", "awaiting_qc", "quarantined", "released", "rework_approved", "closed"];
const AT_OR_AFTER_QC: readonly string[] = ["awaiting_qc", "quarantined", "released", "rejected", "rework_approved", "closed"];

/**
 * Keeps the work order in step with its batches (docs/data-model.md §6.3): released → in_progress
 * when a batch is in process; in_progress → completed when the planned number of batches exist and
 * every one reached awaiting_qc or beyond; completed → closed when every batch is closed. Runs in
 * the caller's transaction; batch services (W2B execution, W2D closure) call it after a batch
 * transition. Returns the transitions made.
 */
export async function syncWorkOrderProgress(tx: Tx, ctx: AuthContext, workOrderId: string | null | undefined): Promise<WorkOrderStatus[]> {
  if (!workOrderId) return [];
  const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, workOrderId)).for("update").limit(1);
  if (!wo) return [];
  const bs = await batchesOfWorkOrder(tx, wo.id);
  const made: WorkOrderStatus[] = [];
  const step = async (to: WorkOrderStatus) => {
    const from = wo.status;
    await transitionWorkOrder(tx, ctx, wo, to);
    await audit(tx, ctx, { action: "production.work_order.state_changed", entityType: "work_order", entityId: wo.id, entityNumber: wo.workOrderNumber, siteId: wo.siteId, before: { status: from }, after: { status: to } });
    made.push(to);
  };
  // Batches abandoned before they started do not count towards the planned number.
  const counted = bs.filter((b) => b.status !== "rejected" || b.startedAt !== null);
  if (wo.status === "released" && bs.some((b) => STARTED.includes(b.status) || (b.status === "rejected" && b.startedAt))) await step("in_progress");
  if (wo.status === "in_progress" && counted.length >= wo.batchCount && counted.every((b) => AT_OR_AFTER_QC.includes(b.status))) await step("completed");
  if (wo.status === "completed" && counted.length > 0 && counted.every((b) => b.status === "closed" || b.status === "rejected")) {
    if (counted.every((b) => b.status === "closed" || (b.status === "rejected" && b.startedAt === null))) await step("closed");
  }
  return made;
}

/**
 * Guard called by createBatch inside its transaction when a batch comes from a work order
 * (US-3-06, W05-03): the work order is planned, released or in progress, at the batch's site, the
 * batch uses exactly the work order's frozen formula and routing revisions and its batch size, the
 * planned start lies within the work order's dates, and no more than batch_count batches exist.
 */
export async function assertWorkOrderAcceptsBatch(
  tx: Tx,
  ctx: AuthContext,
  workOrderId: string,
  b: { siteId: string; formulaRevisionId: string; routingRevisionId: string; plannedSizeG: Decimal; plannedStartOn: string },
) {
  const wo = await lockWorkOrder(tx, ctx, workOrderId);
  if (!["planned", "released", "in_progress"].includes(wo.status)) {
    throw new DomainError("state", `Work order ${wo.workOrderNumber} is ${wo.status.replace(/_/g, " ")}; batches are created from planned or released work orders.`);
  }
  if (wo.siteId !== b.siteId) throw new DomainError("validation", "Switch to the work order's site to create its batches.");
  if (wo.formulaRevisionId !== b.formulaRevisionId) throw new DomainError("validation", "The batch must use the formula revision frozen on the work order.");
  if (wo.routingRevisionId !== b.routingRevisionId) {
    throw new DomainError("state", `Another routing revision is effective on ${b.plannedStartOn} than the one frozen on work order ${wo.workOrderNumber}. Plan a new work order for that date (V-REV).`, { rule: "V-REV" });
  }
  if (!b.plannedSizeG.eq(wo.batchSizeBase)) throw new DomainError("validation", `Batches of ${wo.workOrderNumber} are ${new Decimal(wo.batchSizeBase).div(1000).toString()} kg.`);
  if (b.plannedStartOn < wo.plannedStart || b.plannedStartOn > wo.plannedEnd) {
    throw new DomainError("validation", `Choose a start date between ${wo.plannedStart} and ${wo.plannedEnd} (the work order's dates).`, { fieldErrors: { plannedStartOn: "Outside the work order's dates." } });
  }
  const existing = (await batchesOfWorkOrder(tx, wo.id)).filter((x) => x.status !== "rejected" || x.startedAt !== null);
  if (existing.length >= wo.batchCount) {
    throw new DomainError("state", `Work order ${wo.workOrderNumber} already has its ${wo.batchCount} batch${wo.batchCount === 1 ? "" : "es"}.`);
  }
  return wo;
}

/** Creates the next batch of a work order with the frozen revision snapshot (US-3-06). */
export async function createBatchFromWorkOrder(ctx: AuthContext, input: { workOrderId: string; plannedStartOn?: string | null; idempotencyKey?: string | null }) {
  ctx.require("production.batch.create");
  const [wo] = UUID.test(input.workOrderId)
    ? await db.select().from(workOrders).where(and(eq(workOrders.id, input.workOrderId), eq(workOrders.organizationId, ctx.organizationId), inArray(workOrders.siteId, ctx.allowedSiteIds))).limit(1)
    : [];
  if (!wo) throw new DomainError("not_found", "Work order not found in your sites.");
  ctx.requireSite(wo.siteId);
  if (!wo.formulaRevisionId) throw new DomainError("state", `Plan work order ${wo.workOrderNumber} first; batches use the revisions frozen at planning.`);
  if (wo.siteId !== ctx.currentSiteId) throw new DomainError("validation", "Switch to the work order's site to create its batches.");
  const { createBatch } = await import("./batches");
  return createBatch(ctx, {
    formulaRevisionId: wo.formulaRevisionId,
    plannedSizeKg: new Decimal(wo.batchSizeBase).div(1000).toString(),
    plannedStartOn: input.plannedStartOn || wo.plannedStart,
    workOrderId: wo.id,
    idempotencyKey: input.idempotencyKey,
  });
}

/** Plan line link used by planning.ts (kept here so the work order row and its audit stay in one place). */
export async function linkedPlanLine(tx: Tx, planLineId: string) {
  const [l] = await tx.select().from(productionPlanLines).where(eq(productionPlanLines.id, planLineId)).limit(1);
  return l ?? null;
}
