import "server-only";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { batchMaterials, batches, dispenseRecords, processStepRecords, productionLines, products, users, workOrders } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { getSetting, type SettingValue } from "@/lib/settings";
import { type FormulaSnapshot, manilaToday } from "./shared";
import { planWorkOrder, releaseWorkOrder } from "./work-orders";

/**
 * Production board (US-3-07, docs/ux-system.md §9.3, A-UX-12): work orders and batches of a site
 * by state in configurable columns (setting production.board.columns). A drag to another column
 * runs the matching command only when the transition is legal AND the user holds its permission;
 * otherwise the board explains why, and nothing changes. Reads only; commands run through the
 * work order and batch services, which re-check everything.
 */

export type BoardColumn = SettingValue<"production.board.columns">[number];
export type BoardAction = "plan_work_order" | "release_work_order";
export type MoveVerdict = { allowed: true; action: BoardAction; label: string } | { allowed: false; reason: string };
export type CardRef = { kind: "work_order" | "batch"; status: string; hasWorkOrder: boolean };

/**
 * Pure decision for one card dropped on one column (unit-tested). The legal board moves are the
 * forward steps a planner or supervisor takes by hand; everything else happens in its own flow,
 * which the reason names.
 */
export function boardMove(card: CardRef, column: BoardColumn, can: (p: Permission) => boolean): MoveVerdict {
  const targets = card.kind === "work_order" ? column.workOrderStatuses : column.batchStatuses;
  if ((targets as string[]).includes(card.status)) return { allowed: false, reason: "The card is already in this column." };
  if (card.kind === "work_order") {
    if (card.status === "draft" && (targets as string[]).includes("planned")) {
      return can("production.work_order.submit") ? { allowed: true, action: "plan_work_order", label: "Plan work order" } : { allowed: false, reason: "Planning a work order needs the planner permission (production.work_order.submit)." };
    }
    if (card.status === "planned" && (targets as string[]).includes("released")) {
      return can("production.work_order.approve")
        ? { allowed: true, action: "release_work_order", label: "Release and reserve materials" }
        : { allowed: false, reason: "Releasing a work order needs release permission (production.work_order.approve), held by the site manager." };
    }
    if (column.workOrderStatuses.length === 0) return { allowed: false, reason: "This column shows batches. Work orders move on by creating and running their batches." };
    return { allowed: false, reason: "Work orders move one step at a time: draft → planned → released. In progress and completed follow the batches." };
  }
  if (card.status === "materials_staged" && (targets as string[]).includes("in_process")) {
    return { allowed: false, reason: "A staged batch starts when its weighing-area line clearance is signed (checker co-signs) in the batch workspace." };
  }
  if (card.status === "planned" && (targets as string[]).includes("materials_staged")) {
    return { allowed: false, reason: card.hasWorkOrder ? "A batch is staged by scanning its reserved lots to the staging location. Open Stage materials." : "This batch has no work order, so no materials are reserved for it." };
  }
  if ((targets as string[]).includes("in_process")) {
    return {
      allowed: false,
      reason: ["draft", "planned"].includes(card.status)
        ? "Stage the materials first (scan the reserved lots to the staging location); a staged batch can then be started."
        : "A batch does not move back to In process from here; rework is decided by QA and reopening needs a controlled approval.",
    };
  }
  if ((targets as string[]).some((s) => ["awaiting_qc"].includes(s))) return { allowed: false, reason: "A batch reaches Awaiting QC when its steps are complete and output is posted in the batch workspace." };
  if ((targets as string[]).some((s) => ["quarantined", "released", "rejected", "rework_approved"].includes(s))) return { allowed: false, reason: "Only QA decides release, rejection or rework, in the QA queue." };
  return { allowed: false, reason: "This move is not a step of the batch process." };
}

export type BoardFilter = { siteId?: string; lineId?: string; productId?: string; from?: string; to?: string; assigneeId?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

export async function getProductionBoard(ctx: AuthContext, f: BoardFilter = {}) {
  ctx.require("production.work_order.view");
  ctx.require("production.batch.view");
  const siteId = f.siteId && UUID.test(f.siteId) ? f.siteId : ctx.currentSiteId;
  ctx.requireSite(siteId);
  const columns = await getSetting(db, ctx.organizationId, "production.board.columns", siteId);
  const woStatuses = [...new Set(columns.flatMap((c) => c.workOrderStatuses))];
  const bStatuses = [...new Set(columns.flatMap((c) => c.batchStatuses))];
  const today = manilaToday();

  const woConds: SQL[] = [eq(workOrders.organizationId, ctx.organizationId), eq(workOrders.siteId, siteId)];
  if (f.lineId && UUID.test(f.lineId)) woConds.push(eq(workOrders.productionLineId, f.lineId));
  if (f.productId && UUID.test(f.productId)) woConds.push(eq(workOrders.productId, f.productId));
  if (f.from && DATE.test(f.from)) woConds.push(sql`${workOrders.plannedEnd} >= ${f.from}`);
  if (f.to && DATE.test(f.to)) woConds.push(sql`${workOrders.plannedStart} <= ${f.to}`);
  const wos = woStatuses.length
    ? await db
        .select({ wo: workOrders, productName: products.name, lineCode: productionLines.code })
        .from(workOrders)
        .innerJoin(products, eq(products.id, workOrders.productId))
        .leftJoin(productionLines, eq(productionLines.id, workOrders.productionLineId))
        .where(and(...woConds, inArray(workOrders.status, woStatuses)))
        .limit(300)
    : [];

  const bConds: SQL[] = [eq(batches.organizationId, ctx.organizationId), eq(batches.siteId, siteId)];
  if (f.productId && UUID.test(f.productId)) bConds.push(eq(batches.productId, f.productId));
  if (f.from && DATE.test(f.from)) bConds.push(sql`coalesce(${batches.plannedStartOn}, to_char(${batches.createdAt}, 'YYYY-MM-DD')) >= ${f.from}`);
  if (f.to && DATE.test(f.to)) bConds.push(sql`coalesce(${batches.plannedStartOn}, to_char(${batches.createdAt}, 'YYYY-MM-DD')) <= ${f.to}`);
  const bs = bStatuses.length
    ? await db
        .select({
          b: batches,
          productName: products.name,
          wo: workOrders,
          lineCode: productionLines.code,
          stepsDone: sql<number>`(select count(*)::int from ${processStepRecords} where ${processStepRecords.batchId} = ${batches.id})`,
          exceptions: sql<number>`(select count(*)::int from ${batchMaterials} where ${batchMaterials.batchId} = ${batches.id} and ${batchMaterials.status} = 'exception')`,
        })
        .from(batches)
        .innerJoin(products, eq(products.id, batches.productId))
        .leftJoin(workOrders, eq(workOrders.id, batches.workOrderId))
        .leftJoin(productionLines, eq(productionLines.id, workOrders.productionLineId))
        .where(and(...bConds, inArray(batches.status, bStatuses), ...(f.lineId && UUID.test(f.lineId) ? [eq(workOrders.productionLineId, f.lineId)] : [])))
        .limit(400)
    : [];

  // Assignees: planner and supervisor of the work order; operators who recorded steps or weighings on the batch.
  const batchIds = bs.map((x) => x.b.id);
  const workers = batchIds.length
    ? [
        ...(await db.selectDistinct({ batchId: processStepRecords.batchId, userId: processStepRecords.conductedBy }).from(processStepRecords).where(inArray(processStepRecords.batchId, batchIds))),
        ...(await db
          .selectDistinct({ batchId: batchMaterials.batchId, userId: dispenseRecords.operatorId })
          .from(dispenseRecords)
          .innerJoin(batchMaterials, eq(batchMaterials.id, dispenseRecords.batchMaterialId))
          .where(inArray(batchMaterials.batchId, batchIds))),
      ]
    : [];
  const userIds = [...new Set([...wos.flatMap((x) => [x.wo.assignedPlannerId, x.wo.assignedSupervisorId]), ...bs.flatMap((x) => [x.wo?.assignedSupervisorId]), ...workers.map((x) => x.userId)].filter((x): x is string => !!x))];
  const people = userIds.length ? await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, userIds)) : [];
  const person = (id: string | null | undefined) => {
    const p = people.find((x) => x.id === id);
    return p ? { id: p.id, name: p.name, initials: initials(p.name) } : null;
  };

  type Card = {
    kind: "work_order" | "batch";
    id: string;
    number: string;
    status: string;
    productName: string;
    sizeG: string;
    batchCount: number | null;
    lineCode: string | null;
    plannedStart: string | null;
    workOrderNumber: string | null;
    workOrderId: string | null;
    assignees: { id: string; name: string; initials: string }[];
    progress: { done: number; total: number } | null;
    risks: { tone: "warn" | "bad"; label: string }[];
    href: string;
    moves: Record<string, MoveVerdict>;
  };
  const can = (p: Permission) => ctx.can(p);
  const verdicts = (ref: CardRef) => Object.fromEntries(columns.map((c) => [c.key, boardMove(ref, c, can)]));

  const cards: Card[] = [];
  for (const x of wos) {
    const risks: Card["risks"] = [];
    if (["draft", "planned", "released"].includes(x.wo.status) && x.wo.plannedStart < today) risks.push({ tone: "bad", label: "Late start" });
    if (x.wo.releaseShortages) risks.push({ tone: "warn", label: "Material shortage" });
    const ref = { kind: "work_order" as const, status: x.wo.status, hasWorkOrder: true };
    cards.push({
      kind: "work_order",
      id: x.wo.id,
      number: x.wo.workOrderNumber,
      status: x.wo.status,
      productName: x.productName,
      sizeG: x.wo.qtyPlannedBase,
      batchCount: x.wo.batchCount,
      lineCode: x.lineCode,
      plannedStart: x.wo.plannedStart,
      workOrderNumber: x.wo.workOrderNumber,
      workOrderId: x.wo.id,
      assignees: [person(x.wo.assignedPlannerId), person(x.wo.assignedSupervisorId)].filter((p, i, a): p is NonNullable<typeof p> => !!p && a.findIndex((q) => q?.id === p.id) === i),
      progress: null,
      risks,
      href: `/production/work-orders/${x.wo.id}`,
      moves: verdicts(ref),
    });
  }
  for (const x of bs) {
    const snap = x.b.formulaSnapshot as FormulaSnapshot;
    const risks: Card["risks"] = [];
    if (["draft", "planned", "materials_staged"].includes(x.b.status) && x.b.plannedStartOn && x.b.plannedStartOn < today) risks.push({ tone: "bad", label: "Late start" });
    if (x.exceptions > 0) risks.push({ tone: "warn", label: `${x.exceptions} weighing exception${x.exceptions === 1 ? "" : "s"}` });
    if (x.b.status === "planned" && x.wo?.releaseShortages) risks.push({ tone: "warn", label: "Material shortage" });
    const assignees = [person(x.wo?.assignedSupervisorId), ...workers.filter((w) => w.batchId === x.b.id).map((w) => person(w.userId))].filter(
      (p, i, a): p is NonNullable<typeof p> => !!p && a.findIndex((q) => q?.id === p.id) === i,
    );
    cards.push({
      kind: "batch",
      id: x.b.id,
      number: x.b.batchNumber,
      status: x.b.status,
      productName: x.productName,
      sizeG: x.b.plannedSizeG,
      batchCount: null,
      lineCode: x.lineCode ?? null,
      plannedStart: x.b.plannedStartOn,
      workOrderNumber: x.wo?.workOrderNumber ?? null,
      workOrderId: x.wo?.id ?? null,
      assignees: assignees.slice(0, 4),
      progress: { done: Math.min(x.stepsDone, snap.steps.length), total: snap.steps.length },
      risks,
      href: x.b.status === "planned" && x.wo ? `/production/staging/${x.b.id}` : `/production/${x.b.id}`,
      moves: verdicts({ kind: "batch", status: x.b.status, hasWorkOrder: !!x.wo }),
    });
  }
  const filtered = f.assigneeId && UUID.test(f.assigneeId) ? cards.filter((c) => c.assignees.some((a) => a.id === f.assigneeId)) : cards;
  const byStart = (a: Card, z: Card) => (a.plannedStart ?? "9999").localeCompare(z.plannedStart ?? "9999") || a.number.localeCompare(z.number);
  return {
    siteId,
    columns: columns.map((c) => ({
      key: c.key,
      title: c.title,
      cards: filtered.filter((card) => (card.kind === "work_order" ? (c.workOrderStatuses as string[]) : (c.batchStatuses as string[])).includes(card.status)).sort(byStart),
    })),
    assigneeOptions: people.map((p) => ({ id: p.id, name: p.name })).sort((a, z) => a.name.localeCompare(z.name)),
    total: filtered.length,
  };
}
export type ProductionBoard = Awaited<ReturnType<typeof getProductionBoard>>;
export type BoardCard = ProductionBoard["columns"][number]["cards"][number];

/**
 * Executes a board drop. The verdict is recomputed on the server from the stored status (never
 * trusted from the client); a refused move throws 409 `state` with the explanation and changes
 * nothing. Allowed moves call the same services as the buttons on the detail pages.
 */
export async function moveBoardCard(ctx: AuthContext, input: { kind: "work_order" | "batch"; id: string; toColumn: string; idempotencyKey?: string | null }) {
  if (!UUID.test(input.id)) throw new DomainError("not_found", "Card not found in your sites.");
  let ref: CardRef;
  let siteId: string;
  if (input.kind === "work_order") {
    ctx.require("production.work_order.view");
    const [wo] = await db.select().from(workOrders).where(and(eq(workOrders.id, input.id), eq(workOrders.organizationId, ctx.organizationId))).limit(1);
    if (!wo || !ctx.allowedSiteIds.includes(wo.siteId)) throw new DomainError("not_found", "Work order not found in your sites.");
    ref = { kind: "work_order", status: wo.status, hasWorkOrder: true };
    siteId = wo.siteId;
  } else {
    ctx.require("production.batch.view");
    const [b] = await db.select().from(batches).where(and(eq(batches.id, input.id), eq(batches.organizationId, ctx.organizationId))).limit(1);
    if (!b || !ctx.allowedSiteIds.includes(b.siteId)) throw new DomainError("not_found", "Batch not found in your sites.");
    ref = { kind: "batch", status: b.status, hasWorkOrder: !!b.workOrderId };
    siteId = b.siteId;
  }
  ctx.requireSite(siteId);
  const columns = await getSetting(db, ctx.organizationId, "production.board.columns", siteId);
  const column = columns.find((c) => c.key === input.toColumn);
  if (!column) throw new DomainError("validation", "That column is not on this board.");
  const v = boardMove(ref, column, (p) => ctx.can(p));
  if (!v.allowed) throw new DomainError("state", v.reason, { board: true });
  if (v.action === "plan_work_order") {
    const r = await planWorkOrder(ctx, input.id);
    return { message: `Work order ${r.workOrderNumber} planned with ${r.formulaRevision} and ${r.routingRevision}.` };
  }
  if (v.action === "release_work_order") {
    const r = await releaseWorkOrder(ctx, input.id, { idempotencyKey: input.idempotencyKey });
    return { message: `Work order ${r.workOrderNumber} released; ${r.reservations.length} reservation${r.reservations.length === 1 ? "" : "s"} made${r.shortages.length ? `, ${r.shortages.length} material${r.shortages.length === 1 ? "" : "s"} short` : ""}.` };
  }
  throw new DomainError("state", "This move is not a step of the batch process.");
}
