import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  batchMaterialSubstitutions,
  batchMaterials,
  bomLineAlternatives,
  inventoryBalances,
  inventoryLots,
  locations,
  materialSubstitutionRequests,
  materials,
  products,
  stockReservations,
  users,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { assertLotUsable, lockLots } from "@/modules/inventory";
import { assertLocationNotHeld } from "@/modules/inventory/holds";
import { type ApprovalVerdict } from "@/modules/governance";
import { notifyUsers, usersHoldingPermissionAt } from "@/modules/platform/notifications";
import { isPackagingKind } from "./packaging-lines";
import { convertReservations } from "./staging";
import { type BatchRow } from "./execution";
import { idempotent, lockBatch, manilaToday } from "./shared";
import { offPlanWarning } from "./pick-plan";

/**
 * ADR-104 §1 "Another material at weighing" (docs/production-flow-v2.md §4.5).
 *
 * | Case                                   | Who                                  | What happens (one transaction, audited, idempotent)                      |
 * |----------------------------------------|--------------------------------------|---------------------------------------------------------------------------|
 * | Same ingredient, another lot           | operator (dispense_record.create)    | set-aside moved old lot → new lot; batch_material_substitutions floor_lot |
 * |                                        |                                      | with reason (one tap when it is not the lot to use first, A-FD-01)        |
 * | The recipe's approved alternative      | operator (dispense_record.create)    | line swapped for this batch (new line, old one `substituted`), set-aside  |
 * |                                        |                                      | moved to the alternative; substitution kind `alternative`                 |
 * | Something else (not in the recipe)     | operator asks; a QA person decides   | request → To approve (`approval.material_substitution`); approval swaps   |
 * |                                        | (quality.disposition.approve or QA   | the line like an alternative (`approved_other`). The requester never      |
 * |                                        | role, own roles only, A-FD-02)        | decides; the owner override and ADR-091 self-approval never apply          |
 *
 * Lots offered are released, in date, with stock at the site; expired, stopped (on hold) and waiting-for-QA lots are
 * never offered and are refused by the server (assertLotUsable, assertLocationNotHeld).
 */

/** One-tap reasons for not taking the lot to use first (A-FD-01: wording for QA review; the reason is stored as a code). */
export const LOT_CHANGE_REASONS = {
  used_up: "The first lot is used up",
  damaged: "The first lot is damaged",
  cant_reach: "I can't reach it",
  other: "Other",
} as const;
export type LotChangeReason = keyof typeof LOT_CHANGE_REASONS;
export const LOT_CHANGE_REASON_CODES = Object.keys(LOT_CHANGE_REASONS) as LotChangeReason[];

export const MATERIAL_SUBSTITUTION_APPROVAL_KIND = "approval.material_substitution";
/** Statuses of a line that can still change what it uses. */
const OPEN_LINE = ["pending", "partial"];
const SWAPPABLE_BATCH = ["planned", "materials_staged", "in_process"];

type Line = { bm: typeof batchMaterials.$inferSelect; material: typeof materials.$inferSelect };

const dec = (v: Decimal.Value) => new Decimal(v);
const fmt = (v: Decimal.Value, uom: string) => `${Number(new Decimal(v).toDecimalPlaces(3).toString()).toLocaleString("en-PH", { maximumFractionDigits: 3 })} ${uom}`;

/** QA person for a GMP decision: quality.disposition.approve or the QA role at the site, from their own roles (A-FD-02). */
export function isQaApproverAt(ctx: AuthContext, siteId: string): boolean {
  return ctx.canGenuinelyAt("quality.disposition.approve", siteId) || (ctx.roleCodes.includes("qa_qc") && ctx.allowedSiteIds.includes(siteId));
}

async function loadLine(q: DbOrTx, batch: BatchRow, batchMaterialId: string, lock: boolean): Promise<Line> {
  if (!/^[0-9a-f-]{36}$/i.test(batchMaterialId ?? "")) throw new DomainError("not_found", "Ingredient line not found on this batch.");
  const base = q
    .select({ bm: batchMaterials, material: materials })
    .from(batchMaterials)
    .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
    .where(and(eq(batchMaterials.id, batchMaterialId), eq(batchMaterials.batchId, batch.id)));
  const [row] = lock ? await base.for("update", { of: batchMaterials }).limit(1) : await base.limit(1);
  if (!row) throw new DomainError("not_found", "Ingredient line not found on this batch.");
  if (isPackagingKind(row.material.materialKind)) throw new DomainError("validation", `${row.material.name} is packaging: its lot is chosen at the packaging step.`);
  return row;
}

function assertBatchOpen(batch: BatchRow) {
  if (!SWAPPABLE_BATCH.includes(batch.status)) throw new DomainError("state", `Batch ${batch.batchNumber} is past weighing; what it used can no longer change.`);
}

function assertLineOpen(line: Line) {
  if (line.bm.status === "substituted") throw new DomainError("state", `${line.material.name} was already replaced on this batch.`);
  if (!OPEN_LINE.includes(line.bm.status)) throw new DomainError("state", `${line.material.name} is already weighed for this batch.`);
}

function assertNotWeighed(line: Line) {
  assertLineOpen(line);
  if (dec(line.bm.dispensedQtyG).gt(0)) {
    throw new DomainError("state", `Some ${line.material.name} is already weighed. Undo those weighings first (Other ways to weigh), then change the ingredient.`);
  }
}

/** Active set-aside of a material for this batch: staging (demand batch) first, else the order's (demand work order). */
async function lineReservations(q: DbOrTx, batch: BatchRow, materialId: string) {
  const sel = (demandType: "batch" | "work_order", demandId: string) =>
    q
      .select({ r: stockReservations, lotNumber: inventoryLots.lotNumber, expiresOn: inventoryLots.expiresOn })
      .from(stockReservations)
      .innerJoin(inventoryLots, eq(inventoryLots.id, stockReservations.lotId))
      .where(
        and(
          eq(stockReservations.demandType, demandType),
          eq(stockReservations.demandId, demandId),
          eq(stockReservations.status, "active"),
          eq(inventoryLots.materialId, materialId),
          sql`(${stockReservations.expiresAt} is null or ${stockReservations.expiresAt} > now())`,
        ),
      )
      .orderBy(sql`${inventoryLots.expiresOn} asc nulls last`, asc(stockReservations.createdAt));
  const staged = await sel("batch", batch.id);
  if (staged.length) return { demandType: "batch" as const, demandId: batch.id, rows: staged };
  if (batch.workOrderId) return { demandType: "work_order" as const, demandId: batch.workOrderId, rows: await sel("work_order", batch.workOrderId) };
  return { demandType: null, demandId: null, rows: [] as Awaited<ReturnType<typeof sel>> };
}

export type OtherLotOption = {
  lotId: string;
  lotNumber: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  expiresOn: string | null;
  /** Stock at the place minus what is set aside for other work. */
  free: string;
  /** Set aside for this ingredient now (the lot being replaced). */
  setAsideNow: boolean;
  /** The lot to use first among the others (first to expire): no reason needed. */
  useFirst: boolean;
  /** It covers what the line still needs. */
  covers: boolean;
};

/**
 * Released, in-date lots of the same material at the batch site with stock (FEFO, lots without expiry last). Lots on
 * hold, waiting for QA, rejected or expired are never listed. `free` subtracts other demands' active set-asides.
 */
async function otherLotsFor(q: DbOrTx, batch: BatchRow, line: Line): Promise<OtherLotOption[]> {
  const today = manilaToday();
  const rows = await q
    .select({
      lotId: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      expiresOn: inventoryLots.expiresOn,
      locationId: locations.id,
      locationCode: locations.code,
      locationName: locations.name,
      qty: inventoryBalances.qtyBase,
    })
    .from(inventoryLots)
    .innerJoin(inventoryBalances, eq(inventoryBalances.lotId, inventoryLots.id))
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .where(
      and(
        eq(inventoryLots.organizationId, batch.organizationId),
        eq(inventoryLots.siteId, batch.siteId),
        eq(inventoryLots.itemKind, "material"),
        eq(inventoryLots.materialId, line.material.id),
        eq(inventoryLots.qualityStatus, "released"),
        or(isNull(inventoryLots.expiresOn), sql`${inventoryLots.expiresOn} >= ${today}`),
        gt(inventoryBalances.qtyBase, "0"),
      ),
    )
    .orderBy(sql`${inventoryLots.expiresOn} asc nulls last`, asc(inventoryLots.lotNumber), asc(locations.code));
  if (!rows.length) return [];
  const mine = await lineReservations(q, batch, line.material.id);
  const ownDemand = mine.demandId;
  const reserved = await q
    .select({ lotId: stockReservations.lotId, locationId: stockReservations.locationId, qty: sql<string>`sum(${stockReservations.qtyBase})::text` })
    .from(stockReservations)
    .where(
      and(
        inArray(stockReservations.lotId, [...new Set(rows.map((r) => r.lotId))]),
        eq(stockReservations.status, "active"),
        sql`(${stockReservations.expiresAt} is null or ${stockReservations.expiresAt} > now())`,
        ownDemand ? or(isNull(stockReservations.demandId), ne(stockReservations.demandId, ownDemand)) : sql`true`,
      ),
    )
    .groupBy(stockReservations.lotId, stockReservations.locationId);
  const need = Decimal.max(dec(line.bm.theoreticalQtyG).minus(line.bm.dispensedQtyG), 0);
  const setAside = new Set(mine.rows.map((r) => `${r.r.lotId}:${r.r.locationId}`));
  const out: OtherLotOption[] = rows.map((r) => {
    const other = reserved.find((x) => x.lotId === r.lotId && x.locationId === r.locationId);
    const free = Decimal.max(dec(r.qty).minus(other?.qty ?? 0), 0);
    return {
      lotId: r.lotId,
      lotNumber: r.lotNumber,
      locationId: r.locationId,
      locationCode: r.locationCode,
      locationName: r.locationName,
      expiresOn: r.expiresOn,
      free: free.toString(),
      setAsideNow: setAside.has(`${r.lotId}:${r.locationId}`),
      useFirst: false,
      covers: free.gte(need),
    };
  });
  const first = out.find((o) => !o.setAsideNow && o.covers) ?? out.find((o) => !o.setAsideNow);
  if (first) first.useFirst = true;
  // Set-aside lots last (they are what is being replaced); the rest stay first-to-expire first.
  return [...out.filter((o) => !o.setAsideNow), ...out.filter((o) => o.setAsideNow)];
}

/** The lots the weigh card offers under "Use another lot" (production.batch.view at the batch site). */
export async function otherLotOptions(ctx: AuthContext, batch: BatchRow, batchMaterialId: string) {
  ctx.require("production.batch.view");
  ctx.requireSite(batch.siteId);
  return otherLotsFor(db, batch, await loadLine(db, batch, batchMaterialId, false));
}

/* ------------------------------------------------------------------ 1a. same ingredient, another lot */

export type UseAnotherLotInput = {
  batchId: string;
  batchMaterialId: string;
  lotId: string;
  locationId?: string | null;
  reasonCode?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
};

export type UseAnotherLotResult = { substitutionId: string; materialName: string; fromLots: string[]; toLot: string; location: string; qty: string; reason: string; reasonCode: string };

export async function useAnotherLot(ctx: AuthContext, input: UseAnotherLotInput): Promise<UseAnotherLotResult> {
  ctx.require("production.dispense_record.create");
  if (!/^[0-9a-f-]{36}$/i.test(input.lotId ?? "")) throw new DomainError("validation", "Tap or scan the lot you take.", { field: "lotId", fieldErrors: { lotId: "Tap or scan a lot." } });
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    ctx.requireAt("production.dispense_record.create", batch.siteId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.batch_material.lot_change", async () => {
      assertBatchOpen(batch);
      const line = await loadLine(tx, batch, input.batchMaterialId, true);
      return changeLotInTx(tx, ctx, batch, line, { lotId: input.lotId, locationId: input.locationId, reasonCode: input.reasonCode, note: input.note });
    });
    return result;
  });
}

/**
 * The lot change itself (caller holds the batch lock and the line): checks the lot (same ingredient, this site,
 * released, in date, place not held, enough free), asks the reason (A-FD-01), moves the set-aside for what the line
 * still needs (or `atLeast` when only part of it is free, a split weighing), records floor_lot and audits.
 * `offPlan` (ADR-106 §3): the operator scanned at weighing a lot other than the one taken at Get materials; a reason
 * is always needed and the note says so (QA sees it on Check quality and the batch record).
 */
export async function changeLotInTx(
  tx: Tx,
  ctx: AuthContext,
  batch: BatchRow,
  line: Line,
  input: { lotId: string; locationId?: string | null; reasonCode?: string | null; note?: string | null; offPlan?: boolean; atLeast?: Decimal | null },
): Promise<UseAnotherLotResult> {
  assertLineOpen(line);
  const need = dec(line.bm.theoreticalQtyG).minus(line.bm.dispensedQtyG);
  if (need.lte(0)) throw new DomainError("state", `${line.material.name} is already weighed for this batch.`);
  const [found] = await tx.select().from(inventoryLots).where(and(eq(inventoryLots.id, input.lotId), eq(inventoryLots.organizationId, ctx.organizationId))).limit(1);
  if (!found || found.siteId !== batch.siteId) throw new DomainError("not_found", "That lot is not at this batch's site.", { field: "lotId" });
  if (found.itemKind !== "material" || found.materialId !== line.material.id) {
    const [other] = found.materialId ? await tx.select({ name: materials.name }).from(materials).where(eq(materials.id, found.materialId)).limit(1) : [];
    throw new DomainError("blocked_lot", `This is ${other?.name ?? "another item"}, not ${line.material.name}. For another ingredient use "Ask to use something else".`, { rule: "V-MAT", field: "lotId" });
  }
  const mine = await lineReservations(tx, batch, line.material.id);
  await lockLots(tx, [found.id, ...mine.rows.map((r) => r.r.lotId)]);
  const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, found.id)).limit(1);
  assertLotUsable(lot);
  const options = await otherLotsFor(tx, batch, line);
  const atLot = options.filter((o) => o.lotId === lot.id && (!input.locationId || o.locationId === input.locationId));
  if (!atLot.length) throw new DomainError("insufficient_stock", `Lot ${lot.lotNumber} has no stock you may use at this site.`, { field: "lotId" });
  if (atLot.every((o) => o.setAsideNow)) throw new DomainError("validation", `Lot ${lot.lotNumber} is already the lot set aside for ${line.material.name}.`, { field: "lotId" });
  const min = input.atLeast && input.atLeast.lt(need) ? input.atLeast : need;
  const pick = atLot.find((o) => !o.setAsideNow && dec(o.free).gte(need)) ?? atLot.find((o) => !o.setAsideNow && dec(o.free).gte(min)) ?? null;
  if (!pick) {
    const free = atLot.reduce((s, o) => s.plus(o.setAsideNow ? 0 : o.free), new Decimal(0));
    throw new DomainError("insufficient_stock", `Lot ${lot.lotNumber} has only ${fmt(free, line.material.baseUom)} free; ${fmt(min, line.material.baseUom)} is needed. Choose another lot, or weigh from two lots under "Other ways to weigh".`, { field: "lotId" });
  }
  const moveQty = Decimal.min(need, dec(pick.free));
  const [loc] = await tx.select().from(locations).where(eq(locations.id, pick.locationId)).limit(1);
  await assertLocationNotHeld(tx, loc);
  const fromLots = [...new Set(mine.rows.filter((r) => r.r.lotId !== lot.id).map((r) => r.lotNumber))];
  // A-FD-01: a lot that is not the one to use first needs a one-tap reason; off the Get materials plan always.
  const isFirst = pick.useFirst && !input.offPlan;
  const code = (input.reasonCode ?? "").trim();
  const note = (input.note ?? "").trim();
  let reasonCode: string;
  let reason: string;
  if (!code && isFirst) {
    reasonCode = "first_to_expire";
    reason = `Next lot to use first (lot ${lot.lotNumber})${note ? `: ${note}` : ""}`;
  } else {
    if (!(LOT_CHANGE_REASON_CODES as string[]).includes(code)) {
      const first = options.find((o) => o.useFirst);
      const msg = input.offPlan ? offPlanWarning(fromLots) : first ? `Lot ${first.lotNumber} should be used first. Say why you take lot ${lot.lotNumber}.` : `Say why you take lot ${lot.lotNumber}.`;
      throw new DomainError("validation", msg, { field: "reasonCode", fieldErrors: { reasonCode: "Tap a reason." }, offPlan: !!input.offPlan, takenLots: fromLots });
    }
    if (code === "other" && note.length < 3) throw new DomainError("validation", "Write the reason (a few words).", { field: "note", fieldErrors: { note: "Write the reason." } });
    if (note.length > 300) throw new DomainError("validation", "Keep the note under 300 characters.", { field: "note", fieldErrors: { note: "Too long." } });
    reasonCode = code;
    reason = code === "other" ? note : `${LOT_CHANGE_REASONS[code as LotChangeReason]}${note ? `: ${note}` : ""}`;
  }
  if (input.offPlan) reason = `Not the lot taken at Get materials${fromLots.length ? ` (${fromLots.join(", ")})` : ""}: ${reason}`;
  if (reason.length < 5) reason = `${reason} (lot change)`;
  const expectedLotId = mine.rows.find((r) => r.r.lotId !== lot.id)?.r.lotId ?? null;
  let newReservationId: string | null = null;
  let reservationNumber: string | null = null;
  if (mine.demandType && mine.demandId) {
    await convertReservations(tx, ctx, mine.rows.filter((r) => r.r.lotId !== lot.id).map((r) => r.r), moveQty, `Lot changed at weighing to ${lot.lotNumber}: ${reason}`, "released");
    reservationNumber = await nextNumber(tx, ctx.organizationId, "RSV");
    const [rsv] = await tx
      .insert(stockReservations)
      .values({
        organizationId: batch.organizationId,
        siteId: batch.siteId,
        reservationNumber,
        lotId: lot.id,
        locationId: pick.locationId,
        qtyBase: moveQty.toString(),
        baseUom: lot.baseUom,
        demandType: mine.demandType,
        demandId: mine.demandId,
        demandReference: `${batch.batchNumber} · ${line.material.code} (lot changed at weighing)`,
        status: "active",
        expiresAt: mine.rows[0]?.r.expiresAt ?? null,
        createdBy: ctx.userId,
      })
      .returning();
    newReservationId = rsv.id;
  }
  const [sub] = await tx
    .insert(batchMaterialSubstitutions)
    .values({
      organizationId: batch.organizationId,
      siteId: batch.siteId,
      batchId: batch.id,
      batchMaterialId: line.bm.id,
      workOrderId: batch.workOrderId,
      materialId: line.material.id,
      expectedLotId,
      substituteLotId: lot.id,
      substituteLocationId: pick.locationId,
      qtyBase: moveQty.toString(),
      reason,
      newReservationId,
      approvedBy: ctx.userId,
      requestedBy: ctx.userId,
      kind: "floor_lot",
      reasonCode: input.offPlan ? `off_plan:${reasonCode}` : reasonCode,
    })
    .returning();
  await audit(tx, ctx, {
    action: "production.batch_material.lot_changed",
    entityType: "batch",
    entityId: batch.id,
    entityNumber: batch.batchNumber,
    siteId: batch.siteId,
    reason,
    before: { material: line.material.code, lots: fromLots },
    after: { substitutionId: sub.id, material: line.material.code, materialName: line.material.name, lot: lot.lotNumber, location: pick.locationCode, qty: moveQty.toString(), reasonCode, reservation: reservationNumber, firstToExpire: isFirst, offPlan: !!input.offPlan },
  });
  return { substitutionId: sub.id, materialName: line.material.name, fromLots, toLot: lot.lotNumber, location: pick.locationName || pick.locationCode, qty: moveQty.toString(), reason, reasonCode };
}

/** For recordDispense (ADR-106 §3): the open line, loaded under the caller's batch lock. */
export async function lineForLotChange(tx: Tx, batch: BatchRow, batchMaterialId: string) {
  return loadLine(tx, batch, batchMaterialId, false);
}

/* ------------------------------------------------------------------ 1b. another ingredient */

/** The recipe line's approved alternatives (bom_line_alternatives of the frozen recipe line). */
export async function alternativesForLine(q: DbOrTx, line: { bomLineId: string | null; theoreticalQtyG: string }) {
  if (!line.bomLineId) return [];
  const rows = await q
    .select({ a: bomLineAlternatives, name: materials.name, code: materials.code, uom: materials.baseUom, status: materials.status, kind: materials.materialKind })
    .from(bomLineAlternatives)
    .innerJoin(materials, eq(materials.id, bomLineAlternatives.materialId))
    .where(eq(bomLineAlternatives.bomLineId, line.bomLineId))
    .orderBy(asc(materials.name));
  return rows.map((r) => ({ id: r.a.id, materialId: r.a.materialId, materialName: r.name, materialCode: r.code, baseUom: r.uom, ratio: r.a.ratio, notes: r.a.notes, active: r.status === "active", qty: dec(line.theoreticalQtyG).mul(r.a.ratio).toDecimalPlaces(3).toString() }));
}

/** Free, released, in-date lot of a material at the site that covers `qty` (first to expire first), or null. */
async function fefoLotCovering(tx: Tx, batch: BatchRow, materialId: string, qty: Decimal) {
  const today = manilaToday();
  const rows = await tx
    .select({ lotId: inventoryLots.id, lotNumber: inventoryLots.lotNumber, baseUom: inventoryLots.baseUom, locationId: locations.id, locationCode: locations.code, qty: inventoryBalances.qtyBase })
    .from(inventoryLots)
    .innerJoin(inventoryBalances, eq(inventoryBalances.lotId, inventoryLots.id))
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .where(
      and(
        eq(inventoryLots.siteId, batch.siteId),
        eq(inventoryLots.itemKind, "material"),
        eq(inventoryLots.materialId, materialId),
        eq(inventoryLots.qualityStatus, "released"),
        or(isNull(inventoryLots.expiresOn), sql`${inventoryLots.expiresOn} >= ${today}`),
        gt(inventoryBalances.qtyBase, "0"),
      ),
    )
    .orderBy(sql`${inventoryLots.expiresOn} asc nulls last`, asc(inventoryLots.lotNumber), asc(locations.code));
  if (!rows.length) return null;
  await lockLots(tx, rows.map((r) => r.lotId));
  for (const r of rows) {
    const [res] = await tx
      .select({ q: sql<string>`coalesce(sum(${stockReservations.qtyBase}), 0)::text` })
      .from(stockReservations)
      .where(and(eq(stockReservations.lotId, r.lotId), eq(stockReservations.locationId, r.locationId), eq(stockReservations.status, "active"), sql`(${stockReservations.expiresAt} is null or ${stockReservations.expiresAt} > now())`));
    if (dec(r.qty).minus(res?.q ?? 0).gte(qty)) return r;
  }
  return null;
}

type SwapInput = { materialId: string; qty: Decimal; kind: "alternative" | "approved_other"; reason: string; requestId?: string | null; requestedBy?: string | null; idempotencyKey?: string | null };

/**
 * Swaps a batch line to another ingredient for THIS batch only: a new batch line (same line number, recipe line and
 * tolerance; the amount given), the old line marked `substituted` (it keeps its history), the old set-aside ended and
 * the new ingredient set aside first-to-expire-first when a lot covers it. Caller holds the batch lock.
 */
async function swapLineInTx(tx: Tx, ctx: AuthContext, batch: BatchRow, line: Line, s: SwapInput) {
  assertNotWeighed(line);
  const [m] = await tx.select().from(materials).where(and(eq(materials.id, s.materialId), eq(materials.organizationId, ctx.organizationId))).limit(1);
  if (!m) throw new DomainError("not_found", "That ingredient was not found.", { field: "materialId" });
  if (m.id === line.material.id) throw new DomainError("validation", `That is ${m.name} itself. For another lot use "Use another lot".`, { field: "materialId" });
  if (isPackagingKind(m.materialKind)) throw new DomainError("validation", `${m.name} is packaging, not an ingredient.`, { field: "materialId" });
  if (m.status !== "active") throw new DomainError("validation", `${m.name} is not in use any more.`, { field: "materialId" });
  if (m.baseUom !== line.material.baseUom) throw new DomainError("validation", `${m.name} is counted in ${m.baseUom}; ${line.material.name} in ${line.material.baseUom}. Ask QA to set this up in the recipe.`, { field: "materialId" });
  const oldQty = dec(line.bm.theoreticalQtyG);
  const ratio = s.qty.div(oldQty);
  const [nl] = await tx
    .insert(batchMaterials)
    .values({
      batchId: batch.id,
      bomLineId: line.bm.bomLineId,
      lineNo: line.bm.lineNo,
      materialId: m.id,
      theoreticalQtyG: s.qty.toDecimalPlaces(6).toString(),
      tolerancePct: line.bm.tolerancePct,
      toleranceAbsG: line.bm.toleranceAbsG !== null ? dec(line.bm.toleranceAbsG).mul(ratio).toDecimalPlaces(6).toString() : null,
      status: "pending",
    })
    .returning();
  await tx.update(batchMaterials).set({ status: "substituted" }).where(eq(batchMaterials.id, line.bm.id));
  // Set-aside: the old ingredient's for this line ends; the new ingredient is set aside when a lot covers it.
  const mine = await lineReservations(tx, batch, line.material.id);
  if (mine.rows.length) await convertReservations(tx, ctx, mine.rows.map((r) => r.r), oldQty, `${line.material.name} replaced by ${m.name} on batch ${batch.batchNumber}: ${s.reason}`, "released");
  const demandType = mine.demandType ?? (batch.workOrderId ? "work_order" : null);
  const demandId = demandType === "batch" ? batch.id : batch.workOrderId;
  let lotPick: Awaited<ReturnType<typeof fefoLotCovering>> = null;
  let newReservationId: string | null = null;
  if (demandType && demandId) {
    lotPick = await fefoLotCovering(tx, batch, m.id, s.qty);
    if (lotPick) {
      const [rsv] = await tx
        .insert(stockReservations)
        .values({
          organizationId: batch.organizationId,
          siteId: batch.siteId,
          reservationNumber: await nextNumber(tx, ctx.organizationId, "RSV"),
          lotId: lotPick.lotId,
          locationId: lotPick.locationId,
          qtyBase: s.qty.toString(),
          baseUom: lotPick.baseUom,
          demandType,
          demandId,
          demandReference: `${batch.batchNumber} · ${m.code} (instead of ${line.material.code})`,
          status: "active",
          expiresAt: mine.rows[0]?.r.expiresAt ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      newReservationId = rsv.id;
    }
  }
  const [sub] = await tx
    .insert(batchMaterialSubstitutions)
    .values({
      organizationId: batch.organizationId,
      siteId: batch.siteId,
      batchId: batch.id,
      batchMaterialId: line.bm.id,
      workOrderId: batch.workOrderId,
      materialId: line.material.id,
      expectedLotId: mine.rows[0]?.r.lotId ?? null,
      substituteLotId: lotPick?.lotId ?? null,
      substituteLocationId: lotPick?.locationId ?? null,
      qtyBase: s.qty.toString(),
      reason: s.reason,
      newReservationId,
      approvedBy: ctx.userId,
      requestedBy: s.requestedBy ?? ctx.userId,
      kind: s.kind,
      substituteMaterialId: m.id,
      newBatchMaterialId: nl.id,
      requestId: s.requestId ?? null,
    })
    .returning();
  await audit(tx, ctx, {
    action: "production.batch_material.ingredient_swapped",
    entityType: "batch",
    entityId: batch.id,
    entityNumber: batch.batchNumber,
    siteId: batch.siteId,
    reason: s.reason,
    before: { material: line.material.code, materialName: line.material.name, qty: oldQty.toString(), batchMaterialId: line.bm.id },
    after: { substitutionId: sub.id, kind: s.kind, material: m.code, materialName: m.name, qty: s.qty.toString(), batchMaterialId: nl.id, lot: lotPick?.lotNumber ?? null, requestId: s.requestId ?? null },
  });
  const shortage = demandType && !lotPick ? `No released lot of ${m.name} has ${fmt(s.qty, m.baseUom)} free. Ask the storekeeper.` : null;
  return { substitutionId: sub.id, newBatchMaterialId: nl.id, materialName: m.name, replaced: line.material.name, qty: s.qty.toString(), lot: lotPick?.lotNumber ?? null, shortage };
}

/** "Use the approved alternative" (operator): only an alternative the approved recipe lists for this line. */
export async function useApprovedAlternative(ctx: AuthContext, input: { batchId: string; batchMaterialId: string; alternativeId: string; idempotencyKey?: string | null }) {
  ctx.require("production.dispense_record.create");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    ctx.requireAt("production.dispense_record.create", batch.siteId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.batch_material.alternative", async () => {
      assertBatchOpen(batch);
      const line = await loadLine(tx, batch, input.batchMaterialId, true);
      const alt = (await alternativesForLine(tx, line.bm)).find((a) => a.id === input.alternativeId);
      if (!alt) throw new DomainError("validation", `That is not an approved alternative for ${line.material.name} in this recipe. Use "Ask to use something else".`, { field: "alternativeId" });
      if (!alt.active) throw new DomainError("validation", `${alt.materialName} is not in use any more.`, { field: "alternativeId" });
      return swapLineInTx(tx, ctx, batch, line, { materialId: alt.materialId, qty: dec(alt.qty), kind: "alternative", reason: `Approved alternative in the recipe${alt.notes ? ` (${alt.notes})` : ""}` });
    });
    return result;
  });
}

export type RequestSubstitutionInput = { batchId: string; batchMaterialId: string; substituteMaterialId: string; qty?: string | null; reason: string; idempotencyKey?: string | null };

/** "Ask to use something else": a request a QA person decides (A-FD-02). The operator weighs nothing until then. */
export async function requestMaterialSubstitution(ctx: AuthContext, input: RequestSubstitutionInput) {
  ctx.require("production.dispense_record.create");
  const reason = (input.reason ?? "").trim();
  if (reason.length < 5) throw new DomainError("validation", "Say why (at least 5 characters).", { field: "reason", fieldErrors: { reason: "Say why." } });
  if (reason.length > 500) throw new DomainError("validation", "Keep the reason under 500 characters.", { field: "reason", fieldErrors: { reason: "Too long." } });
  if (!/^[0-9a-f-]{36}$/i.test(input.substituteMaterialId ?? "")) throw new DomainError("validation", "Choose what you want to use.", { field: "substituteMaterialId", fieldErrors: { substituteMaterialId: "Choose an ingredient." } });
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    ctx.requireAt("production.dispense_record.create", batch.siteId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.material_substitution.request", async () => {
      assertBatchOpen(batch);
      const line = await loadLine(tx, batch, input.batchMaterialId, true);
      assertNotWeighed(line);
      const [m] = await tx.select().from(materials).where(and(eq(materials.id, input.substituteMaterialId), eq(materials.organizationId, ctx.organizationId))).limit(1);
      if (!m) throw new DomainError("not_found", "That ingredient was not found.", { field: "substituteMaterialId" });
      if (m.id === line.material.id) throw new DomainError("validation", `That is ${m.name} itself. For another lot use "Use another lot".`, { field: "substituteMaterialId", fieldErrors: { substituteMaterialId: "Choose another ingredient." } });
      if (isPackagingKind(m.materialKind) || m.status !== "active") throw new DomainError("validation", `${m.name} cannot be used as an ingredient.`, { field: "substituteMaterialId" });
      if (m.baseUom !== line.material.baseUom) throw new DomainError("validation", `${m.name} is counted in ${m.baseUom}; ${line.material.name} in ${line.material.baseUom}.`, { field: "substituteMaterialId" });
      if ((await alternativesForLine(tx, line.bm)).some((a) => a.materialId === m.id)) {
        throw new DomainError("validation", `${m.name} is an approved alternative in the recipe: tap "Use the approved alternative" instead.`, { field: "substituteMaterialId" });
      }
      let qty: Decimal;
      try {
        qty = new Decimal(((input.qty ?? "").trim() || line.bm.theoreticalQtyG).replace(/,/g, ""));
      } catch {
        throw new DomainError("validation", "Enter the amount as a number.", { field: "qty", fieldErrors: { qty: "A number." } });
      }
      if (!qty.isFinite() || qty.lte(0) || qty.decimalPlaces() > 3) throw new DomainError("validation", `Enter the amount in ${m.baseUom} (more than 0, at most 3 decimals).`, { field: "qty", fieldErrors: { qty: "More than 0." } });
      const [pending] = await tx.select({ id: materialSubstitutionRequests.id }).from(materialSubstitutionRequests).where(and(eq(materialSubstitutionRequests.batchMaterialId, line.bm.id), eq(materialSubstitutionRequests.status, "pending"))).limit(1);
      if (pending) throw new DomainError("conflict", `A request for ${line.material.name} already waits for QA.`);
      const [req] = await tx
        .insert(materialSubstitutionRequests)
        .values({
          organizationId: batch.organizationId,
          siteId: batch.siteId,
          batchId: batch.id,
          batchMaterialId: line.bm.id,
          materialId: line.material.id,
          substituteMaterialId: m.id,
          qtyBase: qty.toString(),
          reason,
          requestedBy: ctx.userId,
          idempotencyKey: input.idempotencyKey ?? null,
        })
        .returning();
      await audit(tx, ctx, {
        action: "production.material_substitution.requested",
        entityType: "material_substitution_request",
        entityId: req.id,
        entityNumber: batch.batchNumber,
        siteId: batch.siteId,
        reason,
        after: { batchId: batch.id, material: line.material.code, materialName: line.material.name, substitute: m.code, substituteName: m.name, qty: qty.toString() },
      });
      const [p] = await tx.select({ name: products.name }).from(products).where(eq(products.id, batch.productId)).limit(1);
      const to = (await usersHoldingPermissionAt(tx, ctx.organizationId, "quality.disposition.approve", batch.siteId)).filter((u) => u !== ctx.userId);
      await notifyUsers(tx, to, {
        organizationId: ctx.organizationId,
        siteId: batch.siteId,
        kind: "production.material_substitution.to_approve",
        severity: "warning",
        title: `${ctx.displayName} asks to use ${m.name} instead of ${line.material.name}`,
        body: `${p?.name ?? "Batch"} ${batch.batchNumber}: ${fmt(qty, m.baseUom)} of ${m.name}. Why: ${reason}. Decide it in To approve.`,
        entityType: "material_substitution_request",
        entityId: req.id,
        link: "/approvals",
        dedupeKey: `material_substitution:${req.id}`,
      });
      return { requestId: req.id, materialName: line.material.name, substituteName: m.name, qty: qty.toString() };
    });
    return result;
  });
}

export type DecideSubstitutionInput = { requestId: string; decision: "approve" | "refuse"; note?: string | null; idempotencyKey?: string | null };

/**
 * QA decides "use something else" (A-FD-02). Only a QA person by their OWN roles (quality.disposition.approve or the
 * QA role at the batch site) and never the person who asked: the owner override (ADR-073) and the top-role
 * self-approval (ADR-091) do not apply here (GMP). Approval swaps the line for this batch only.
 */
export async function decideMaterialSubstitution(ctx: AuthContext, input: DecideSubstitutionInput) {
  if (!["approve", "refuse"].includes(input.decision)) throw new DomainError("validation", "Choose yes or no.", { field: "decision" });
  if (!/^[0-9a-f-]{36}$/i.test(input.requestId ?? "")) throw new DomainError("not_found", "Request not found in your sites.");
  const note = (input.note ?? "").trim() || null;
  if (input.decision === "refuse" && (!note || note.length < 3)) throw new DomainError("validation", "Say why not (at least 3 characters).", { field: "note", fieldErrors: { note: "Say why not." } });
  return db.transaction(async (tx) => {
    const [head] = await tx.select().from(materialSubstitutionRequests).where(and(eq(materialSubstitutionRequests.id, input.requestId), eq(materialSubstitutionRequests.organizationId, ctx.organizationId))).limit(1);
    if (!head || !ctx.allowedSiteIds.includes(head.siteId)) throw new DomainError("not_found", "Request not found in your sites.");
    if (!isQaApproverAt(ctx, head.siteId)) {
      throw new DomainError("forbidden", "Only a QA person can say yes to another ingredient (GMP). The owner and the site manager cannot decide it.", { permission: "quality.disposition.approve", siteId: head.siteId });
    }
    if (head.requestedBy === ctx.userId) throw new DomainError("separation_of_duties", "You asked for this change, so another QA person must decide it.", { permission: "quality.disposition.approve", siteId: head.siteId });
    const batch = await lockBatch(tx, ctx, head.batchId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.material_substitution.decide", async () => {
      const [req] = await tx.select().from(materialSubstitutionRequests).where(eq(materialSubstitutionRequests.id, head.id)).for("update").limit(1);
      if (req.status !== "pending") throw new DomainError("state", `This request is already ${req.status}.`);
      const now = new Date();
      const [sub] = await tx.select({ name: materials.name }).from(materials).where(eq(materials.id, req.substituteMaterialId)).limit(1);
      if (input.decision === "refuse") {
        await tx.update(materialSubstitutionRequests).set({ status: "refused", decidedBy: ctx.userId, decidedAt: now, decisionNote: note }).where(eq(materialSubstitutionRequests.id, req.id));
        await audit(tx, ctx, { action: "production.material_substitution.refused", entityType: "material_substitution_request", entityId: req.id, entityNumber: batch.batchNumber, siteId: batch.siteId, reason: note, before: { status: "pending" }, after: { status: "refused" } });
        await notifyUsers(tx, [req.requestedBy], { organizationId: ctx.organizationId, siteId: batch.siteId, kind: "production.material_substitution.decided", severity: "warning", title: `QA said no to ${sub?.name ?? "the other ingredient"}`, body: `${ctx.displayName}: ${note}`, entityType: "batch", entityId: batch.id, link: `/production/orders/${batch.workOrderId ?? "without-order"}/weigh?batch=${batch.id}` });
        return { status: "refused" as const, requestId: req.id, batchNumber: batch.batchNumber, newBatchMaterialId: null as string | null, shortage: null as string | null };
      }
      assertBatchOpen(batch);
      const line = await loadLine(tx, batch, req.batchMaterialId, true);
      const swap = await swapLineInTx(tx, ctx, batch, line, { materialId: req.substituteMaterialId, qty: dec(req.qtyBase), kind: "approved_other", reason: `${req.reason} (approved by QA${note ? `: ${note}` : ""})`, requestId: req.id, requestedBy: req.requestedBy });
      await tx.update(materialSubstitutionRequests).set({ status: "approved", decidedBy: ctx.userId, decidedAt: now, decisionNote: note }).where(eq(materialSubstitutionRequests.id, req.id));
      await audit(tx, ctx, { action: "production.material_substitution.approved", entityType: "material_substitution_request", entityId: req.id, entityNumber: batch.batchNumber, siteId: batch.siteId, reason: note, before: { status: "pending" }, after: { status: "approved", substitutionId: swap.substitutionId, batchMaterialId: swap.newBatchMaterialId } });
      await notifyUsers(tx, [req.requestedBy], { organizationId: ctx.organizationId, siteId: batch.siteId, kind: "production.material_substitution.decided", severity: "info", title: `QA said yes: use ${swap.materialName}`, body: `Batch ${batch.batchNumber}: weigh ${fmt(swap.qty, line.material.baseUom)} of ${swap.materialName} instead of ${swap.replaced}.`, entityType: "batch", entityId: batch.id, link: `/production/orders/${batch.workOrderId ?? "without-order"}/weigh?batch=${batch.id}` });
      return { status: "approved" as const, requestId: req.id, batchNumber: batch.batchNumber, newBatchMaterialId: swap.newBatchMaterialId as string | null, shortage: swap.shortage };
    });
    return result;
  });
}

/** The person who asked withdraws a request that still waits (or anyone who can weigh at the site, with a reason). */
export async function withdrawMaterialSubstitution(ctx: AuthContext, input: { requestId: string; reason?: string | null }) {
  ctx.require("production.dispense_record.create");
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(materialSubstitutionRequests).where(and(eq(materialSubstitutionRequests.id, input.requestId), eq(materialSubstitutionRequests.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!req || !ctx.allowedSiteIds.includes(req.siteId)) throw new DomainError("not_found", "Request not found in your sites.");
    ctx.requireAt("production.dispense_record.create", req.siteId);
    if (req.status !== "pending") throw new DomainError("state", `This request is already ${req.status}.`);
    const reason = (input.reason ?? "").trim() || "Not needed any more";
    await tx.update(materialSubstitutionRequests).set({ status: "withdrawn", decisionNote: reason }).where(eq(materialSubstitutionRequests.id, req.id));
    await audit(tx, ctx, { action: "production.material_substitution.withdrawn", entityType: "material_substitution_request", entityId: req.id, siteId: req.siteId, reason, before: { status: "pending" }, after: { status: "withdrawn" } });
    return { status: "withdrawn" as const };
  });
}

/* ------------------------------------------------------------------ read models */

/** Ingredients that may be asked for on the floor (raw materials and intermediates in use), by name. */
export async function substituteMaterialOptions(ctx: AuthContext) {
  ctx.require("production.batch.view");
  return db
    .select({ id: materials.id, code: materials.code, name: materials.name, baseUom: materials.baseUom })
    .from(materials)
    .where(and(eq(materials.organizationId, ctx.organizationId), eq(materials.status, "active"), ne(materials.materialKind, "packaging")))
    .orderBy(asc(materials.name));
}

/** Requests of a batch (newest first) with names, for the weigh card and the batch record. */
export async function substitutionRequestsOf(q: DbOrTx, batchId: string) {
  const rows = await q
    .select({ r: materialSubstitutionRequests, substituteName: materials.name, uom: materials.baseUom, by: users.displayName })
    .from(materialSubstitutionRequests)
    .innerJoin(materials, eq(materials.id, materialSubstitutionRequests.substituteMaterialId))
    .innerJoin(users, eq(users.id, materialSubstitutionRequests.requestedBy))
    .where(eq(materialSubstitutionRequests.batchId, batchId))
    .orderBy(desc(materialSubstitutionRequests.requestedAt));
  return rows;
}

export type BatchMaterialChange = {
  id: string;
  kind: string;
  at: Date;
  by: string;
  /** "Lot changed from L-2610-00001 to L-2610-00004 — The first lot is damaged, by Rhea Mendoza, Sat 1 Nov 10:20" */
  sentence: string;
  reason: string;
  materialName: string;
  batchMaterialId: string;
  newBatchMaterialId: string | null;
  /** Lot changes: the lot taken instead. */
  toLot: string | null;
};

const when = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/** Plain sentence for one change (pure; unit-tested). */
export function materialChangeSentence(c: { kind: string; materialName: string; fromLot: string | null; toLot: string | null; substituteName: string | null; qty: string; uom: string; reason: string; by: string; approvedBy?: string | null; at: Date }) {
  const at = when.format(c.at).replace(",", "");
  if (c.kind === "floor_lot" || c.kind === "qa_lot") {
    return `${c.materialName}: lot changed from ${c.fromLot ?? "the set-aside lot"} to ${c.toLot ?? "—"} — ${c.reason}, by ${c.by}, ${at}`;
  }
  const how = c.kind === "alternative" ? "the recipe's approved alternative" : `approved by QA${c.approvedBy ? ` (${c.approvedBy})` : ""}`;
  return `${c.materialName} replaced by ${c.substituteName ?? "another ingredient"} (${fmt(c.qty, c.uom)}, ${how}) for this batch only — ${c.reason}, asked by ${c.by}, ${at}`;
}

/** Every change of what the batch's lines use, oldest first, in words (batch record, Check quality). */
export async function batchMaterialChanges(q: DbOrTx, batchId: string): Promise<BatchMaterialChange[]> {
  const rows = await q.select().from(batchMaterialSubstitutions).where(eq(batchMaterialSubstitutions.batchId, batchId)).orderBy(asc(batchMaterialSubstitutions.approvedAt));
  if (!rows.length) return [];
  const lotIds = [...new Set(rows.flatMap((r) => [r.expectedLotId, r.substituteLotId]).filter((x): x is string => !!x))];
  const matIds = [...new Set(rows.flatMap((r) => [r.materialId, r.substituteMaterialId]).filter((x): x is string => !!x))];
  const userIds = [...new Set(rows.flatMap((r) => [r.approvedBy, r.requestedBy]).filter((x): x is string => !!x))];
  const lots = new Map((lotIds.length ? await q.select({ id: inventoryLots.id, n: inventoryLots.lotNumber }).from(inventoryLots).where(inArray(inventoryLots.id, lotIds)) : []).map((l) => [l.id, l.n]));
  const mats = new Map((matIds.length ? await q.select({ id: materials.id, n: materials.name, u: materials.baseUom }).from(materials).where(inArray(materials.id, matIds)) : []).map((m) => [m.id, m]));
  const names = new Map((userIds.length ? await q.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, userIds)) : []).map((u) => [u.id, u.n]));
  return rows.map((r) => {
    const by = names.get(r.requestedBy ?? r.approvedBy) ?? "someone";
    const m = mats.get(r.materialId);
    return {
      id: r.id,
      kind: r.kind,
      at: r.approvedAt,
      by,
      reason: r.reason,
      materialName: m?.n ?? "Ingredient",
      batchMaterialId: r.batchMaterialId,
      newBatchMaterialId: r.newBatchMaterialId,
      toLot: r.substituteLotId ? (lots.get(r.substituteLotId) ?? null) : null,
      sentence: materialChangeSentence({
        kind: r.kind,
        materialName: m?.n ?? "Ingredient",
        fromLot: r.expectedLotId ? (lots.get(r.expectedLotId) ?? null) : null,
        toLot: r.substituteLotId ? (lots.get(r.substituteLotId) ?? null) : null,
        substituteName: r.substituteMaterialId ? (mats.get(r.substituteMaterialId)?.n ?? null) : null,
        qty: r.qtyBase,
        uom: m?.u ?? "g",
        reason: r.reason,
        by,
        approvedBy: r.kind === "approved_other" ? (names.get(r.approvedBy) ?? null) : null,
        at: r.approvedAt,
      }),
    };
  });
}

/* ------------------------------------------------------------------ To approve */

/** Action-centre source: requests waiting for QA (`approval.material_substitution`). */
export async function materialSubstitutionCandidates(organizationId: string) {
  const rows = await db
    .select({ r: materialSubstitutionRequests, batchNumber: sql<string>`(select b.batch_number from batches b where b.id = ${materialSubstitutionRequests.batchId})`, product: sql<string>`(select p.name from batches b join products p on p.id = b.product_id where b.id = ${materialSubstitutionRequests.batchId})`, from: sql<string>`(select m.name from materials m where m.id = ${materialSubstitutionRequests.materialId})`, to: sql<string>`(select m.name from materials m where m.id = ${materialSubstitutionRequests.substituteMaterialId})` })
    .from(materialSubstitutionRequests)
    .where(and(eq(materialSubstitutionRequests.organizationId, organizationId), eq(materialSubstitutionRequests.status, "pending")));
  return rows.map((x) => ({
    kind: MATERIAL_SUBSTITUTION_APPROVAL_KIND,
    siteId: x.r.siteId,
    entityType: "material_substitution_request",
    entityId: x.r.id,
    recordNumber: x.batchNumber,
    title: `Use ${x.to} instead of ${x.from} in ${x.product} ${x.batchNumber}?`,
    detail: null, // the verdict's `why` shows the reason once
    link: `/production/${x.r.batchId}`,
    openedAt: x.r.requestedAt,
  }));
}

/** "To approve" verdicts with the rules of decideMaterialSubstitution (QA by own roles, never the requester). */
export async function materialSubstitutionApprovalVerdicts(ctx: AuthContext, ids: string[]): Promise<Map<string, ApprovalVerdict>> {
  const out = new Map<string, ApprovalVerdict>();
  if (!ids.length || !ctx.allowedSiteIds.length) return out;
  const rows = await db
    .select({ r: materialSubstitutionRequests, by: users.displayName, batchNumber: sql<string>`(select b.batch_number from batches b where b.id = ${materialSubstitutionRequests.batchId})`, product: sql<string>`(select p.name from batches b join products p on p.id = b.product_id where b.id = ${materialSubstitutionRequests.batchId})`, from: sql<string>`(select m.name from materials m where m.id = ${materialSubstitutionRequests.materialId})`, to: sql<string>`(select m.name from materials m where m.id = ${materialSubstitutionRequests.substituteMaterialId})`, uom: sql<string>`(select m.base_uom from materials m where m.id = ${materialSubstitutionRequests.substituteMaterialId})` })
    .from(materialSubstitutionRequests)
    .innerJoin(users, eq(users.id, materialSubstitutionRequests.requestedBy))
    .where(and(eq(materialSubstitutionRequests.organizationId, ctx.organizationId), inArray(materialSubstitutionRequests.id, ids), inArray(materialSubstitutionRequests.siteId, ctx.allowedSiteIds), eq(materialSubstitutionRequests.status, "pending")));
  for (const x of rows) {
    const qa = isQaApproverAt(ctx, x.r.siteId);
    const mine = x.r.requestedBy === ctx.userId;
    out.set(x.r.id, {
      canDecide: qa && !mine,
      waitingForRoles: ["qa_qc"],
      stepLabel: "QA approval (GMP)",
      blockedReason: qa && mine ? "You asked for this change, so another QA person must decide it." : null,
      requestedById: x.r.requestedBy,
      requestedByName: x.by,
      title: `Use ${x.to} instead of ${x.from} · ${x.product} ${x.batchNumber} · ${fmt(x.r.qtyBase, x.uom)}`,
      why: x.r.reason,
    });
  }
  return out;
}

/** First names of the QA people who can decide at the site ("Nina", "Nina or Leo"), for "Waiting for QA (Nina)". */
export async function qaDeciderNames(q: DbOrTx, organizationId: string, siteId: string, exceptUserId: string) {
  const ids = (await usersHoldingPermissionAt(q, organizationId, "quality.disposition.approve", siteId)).filter((u) => u !== exceptUserId);
  if (!ids.length) return null;
  const rows = await q.select({ n: users.displayName }).from(users).where(and(inArray(users.id, ids), eq(users.status, "active")));
  const first = [...new Set(rows.map((r) => r.n.trim().split(/\s+/)[0]))].slice(0, 3);
  return first.length ? (first.length === 1 ? first[0] : `${first.slice(0, -1).join(", ")} or ${first.at(-1)}`) : null;
}

