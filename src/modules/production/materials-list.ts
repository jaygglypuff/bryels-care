import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type Tx } from "@/db/client";
import { batchMaterialPicks, batchMaterials, batches, inventoryLots, locations, materials, products, users, warehouses, workOrders, type BatchMaterialPickAction } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { SECTION_LABELS, sectionOf, type LocationSection } from "@/lib/location-sections";
import { parseScan } from "@/lib/scan";
import { getSetting } from "@/lib/settings";
import { assertLotUsable, lockLots } from "@/modules/inventory";
import { heldLocations } from "@/modules/inventory/holds";
import { currentPicks, pickProgress, type PickProgress } from "./flow-facts";
import { type FormulaSnapshot, idempotent, lockBatch } from "./shared";
import { expectedLots, stageInTx } from "./staging";
import { transitionBatch } from "./state";
import { stagingKinds } from "./work-orders-reserve";

/**
 * Production flow v2, slice V2-3 (ADR-080 §2): the Materials list ("Get materials"). One line per
 * formula ingredient with how much, the set-aside lot and where it is, and a Taken tick.
 *
 *   - `production.prepare.move_stock` off (default): a tick records who brought it; no stock moves.
 *   - on: a tick also posts the staging transfer of the set-aside lot (same rules as staging by scan).
 *   - `production.prepare.scan_lots` on: a tick needs the lot label scanned, matching the set-aside lot.
 *
 * A lot that cannot be used now (QA hold, quarantine, expired, rejected, in a held location) is
 * refused. "Not needed" (already in the room) completes the line on the list only: the weighing
 * line stays and must still be weighed. When every line is Taken or Not needed the batch moves
 * planned → materials_staged ("Materials ready"). Every tick writes an audit event; a command key
 * makes a repeat (double tap, retry) return the first result.
 */

const STAGEABLE_WO = ["released", "in_progress"];
const heldMap = (rows: { locationId: string | null; holdNumber: string }[]) => new Map(rows.filter((h) => h.locationId).map((h) => [h.locationId as string, h.holdNumber]));

/** People who may tick the list: production (production.batch.edit) or the storekeeper (inventory.movement.post). */
export function canTickMaterials(ctx: AuthContext) {
  return ctx.can("production.batch.edit") || ctx.can("inventory.movement.post");
}

export type MaterialsListLot = {
  lotId: string;
  lotNumber: string;
  expiresOn: string | null;
  locationId: string;
  locationCode: string;
  locationName: string;
  section: LocationSection;
  sectionLabel: string;
  qtySetAside: string;
  usable: boolean;
  /** Plain words: "On QA hold", "Expired 3 Mar 2027", "Place blocked by QA hold H-0003". */
  problem: string | null;
};

export type MaterialsListLine = {
  batchMaterialId: string;
  lineNo: number;
  materialId: string;
  materialCode: string;
  materialName: string;
  materialKind: string;
  qty: string;
  baseUom: string;
  /** The lots set aside for this ingredient (use first = first). Empty: nothing set aside (batch without an order). */
  lots: MaterialsListLot[];
  state: "open" | BatchMaterialPickAction;
  by: string | null;
  at: Date | null;
  reason: string | null;
  /** The weighing still has to be done (always true until weighed; "Not needed" never changes it). */
  weighingOpen: boolean;
  /** Formula line marked "needs a check" at weighing (snapshot). */
  needsCheck: boolean;
};

async function loadLines(q: Tx | typeof db, b: typeof batches.$inferSelect) {
  return q
    .select({ bm: batchMaterials, material: materials })
    .from(batchMaterials)
    .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
    .where(eq(batchMaterials.batchId, b.id))
    .orderBy(asc(batchMaterials.lineNo));
}

/** The set-aside lots of an ingredient with their place and whether they can be used now. */
async function lotsFor(q: Tx | typeof db, b: typeof batches.$inferSelect, workOrderId: string | null, materialId: string, held: Map<string, string>): Promise<MaterialsListLot[]> {
  if (!workOrderId) return [];
  const exp = await expectedLots(q, workOrderId, materialId);
  if (!exp.length) return [];
  const lotIds = [...new Set(exp.map((x) => x.r.lotId))];
  const lots = await q.select().from(inventoryLots).where(inArray(inventoryLots.id, lotIds));
  const locIds = [...new Set(exp.map((x) => x.r.locationId))];
  const locs = await q
    .select({ id: locations.id, code: locations.code, name: locations.name, kind: locations.kind, section: locations.section, warehouseKind: warehouses.warehouseKind })
    .from(locations)
    .innerJoin(warehouses, eq(warehouses.id, locations.warehouseId))
    .where(inArray(locations.id, locIds));
  return exp.map((x) => {
    const lot = lots.find((l) => l.id === x.r.lotId)!;
    const loc = locs.find((l) => l.id === x.r.locationId)!;
    let problem: string | null = null;
    try {
      assertLotUsable(lot);
    } catch (e) {
      problem = lot.qualityStatus === "on_hold" ? "On QA hold" : lot.qualityStatus === "quarantine" ? "Waiting for QA" : lot.qualityStatus === "rejected" ? "Rejected by QA" : lot.qualityStatus === "recalled" ? "Recalled" : e instanceof DomainError && /expired/.test(e.message) ? `Expired ${lot.expiresOn}` : "Cannot be used";
    }
    const hold = held.get(loc.id);
    if (!problem && hold) problem = `Place blocked by QA hold ${hold}`;
    const section = sectionOf({ section: loc.section, kind: loc.kind }, loc.warehouseKind);
    return {
      lotId: lot.id,
      lotNumber: lot.lotNumber,
      expiresOn: lot.expiresOn,
      locationId: loc.id,
      locationCode: loc.code,
      locationName: loc.name,
      section,
      sectionLabel: SECTION_LABELS[section],
      qtySetAside: new Decimal(x.r.qtyBase).toString(),
      usable: !problem,
      problem,
    };
  });
}

/** The Materials list of a batch (S3). Readable by production and warehouse people at the batch's site. */
export async function getMaterialsList(ctx: AuthContext, batchId: string) {
  if (!canTickMaterials(ctx) && !ctx.can("production.batch.view")) ctx.require("production.batch.view");
  const [row] = await db
    .select({ b: batches, productName: products.name })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId), inArray(batches.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Batch not found in your sites.");
  ctx.requireSite(row.b.siteId);
  const b = row.b;
  const [wo] = b.workOrderId ? await db.select().from(workOrders).where(eq(workOrders.id, b.workOrderId)).limit(1) : [];
  const lines = await loadLines(db, b);
  const picks = await db
    .select({ p: batchMaterialPicks, by: users.displayName })
    .from(batchMaterialPicks)
    .innerJoin(users, eq(users.id, batchMaterialPicks.pickedBy))
    .where(eq(batchMaterialPicks.batchId, b.id));
  const current = currentPicks(picks.map((x) => ({ ...x.p, by: x.by })));
  const held = heldMap(await heldLocations(db, b.siteId));
  const snap = b.formulaSnapshot as FormulaSnapshot;
  const out: MaterialsListLine[] = [];
  for (const l of lines) {
    const c = current.get(l.bm.id);
    const state = !c || c.action === "untaken" ? "open" : (c.action as BatchMaterialPickAction);
    out.push({
      batchMaterialId: l.bm.id,
      lineNo: l.bm.lineNo,
      materialId: l.material.id,
      materialCode: l.material.code,
      materialName: l.material.name,
      materialKind: l.material.materialKind,
      qty: l.bm.theoreticalQtyG,
      baseUom: l.material.baseUom,
      lots: await lotsFor(db, b, wo?.id ?? null, l.material.id, held),
      state,
      by: c && state !== "open" ? c.by : null,
      at: c && state !== "open" ? c.pickedAt : null,
      reason: c?.reason ?? null,
      weighingOpen: l.bm.status === "pending" || l.bm.status === "partial",
      needsCheck: l.material.materialKind !== "packaging" && snap.lines.find((x) => x.bomLineId === l.bm.bomLineId)?.requiresChecker !== false,
    });
  }
  const moveStock = await getSetting(db, ctx.organizationId, "production.prepare.move_stock", b.siteId);
  const scanLots = await getSetting(db, ctx.organizationId, "production.prepare.scan_lots", b.siteId);
  const progress: PickProgress = pickProgress(out.map((l) => l.batchMaterialId), new Map(out.map((l) => [l.batchMaterialId, { action: l.state }])));
  const woOk = !wo || STAGEABLE_WO.includes(wo.status);
  const blockedReason =
    b.status !== "planned"
      ? b.status === "materials_staged"
        ? null
        : `Batch ${b.batchNumber} has started. The materials list is closed.`
      : !woOk
        ? `The order is ${wo!.status.replace(/_/g, " ")}. Materials are set aside when the order is approved.`
        : null;
  const canTick = canTickMaterials(ctx) && b.status === "planned" && woOk && (!moveStock || ctx.can("inventory.movement.post"));
  return {
    batch: b,
    productName: row.productName,
    workOrder: wo ?? null,
    lines: out,
    progress,
    ready: b.status !== "planned" && b.status !== "draft",
    settings: { moveStock, scanLots },
    canTick,
    blockedReason,
    /** Why ticking is not offered to this person (permission), for the lock state. */
    tickDeniedReason: !canTickMaterials(ctx) ? "You can see the list but not tick it." : moveStock && !ctx.can("inventory.movement.post") ? "This site moves stock with each tick. Ask the storekeeper." : null,
  };
}
export type MaterialsListView = Awaited<ReturnType<typeof getMaterialsList>>;

export type PickInput = {
  batchId: string;
  /** One tick per line. With `all: true` every open line is ticked Taken and `lines` may be empty. */
  lines?: { batchMaterialId: string; action: BatchMaterialPickAction; reason?: string | null; lotCode?: string | null }[];
  all?: boolean;
  /** Production place the stock moves to when `production.prepare.move_stock` is on (default: the first one). */
  toLocationCode?: string | null;
  idempotencyKey?: string | null;
};

export type PickResult = { batchNumber: string; changed: number; progress: PickProgress; status: string; ready: boolean };

/**
 * Records Materials list ticks (Appendix A row 3, `confirmPicked`). See the module comment for the rules.
 */
export async function confirmPicked(ctx: AuthContext, input: PickInput): Promise<PickResult> {
  if (!canTickMaterials(ctx)) ctx.require("production.batch.edit");
  const wanted = input.lines ?? [];
  if (!input.all && !wanted.length) throw new DomainError("validation", "Tick at least one line.");
  for (const l of wanted) {
    if (!["taken", "not_needed", "untaken"].includes(l.action)) throw new DomainError("validation", "Choose Taken, Not needed or Undo.");
    if (l.action === "not_needed" && (l.reason?.trim().length ?? 0) < 3) {
      throw new DomainError("validation", "Say why it is not needed (for example: already in the room).", { fieldErrors: { [`reason-${l.batchMaterialId}`]: "Say why." } });
    }
  }
  return db.transaction(async (tx) => {
    const b = await lockBatch(tx, ctx, input.batchId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.pick_line.confirm", async () => {
      if (b.status !== "planned") {
        throw new DomainError("state", b.status === "materials_staged" ? `The materials of batch ${b.batchNumber} are ready. Start the batch.` : `Batch ${b.batchNumber} has started; the materials list is closed.`);
      }
      const [wo] = b.workOrderId ? await tx.select().from(workOrders).where(eq(workOrders.id, b.workOrderId)).for("update").limit(1) : [];
      if (wo && !STAGEABLE_WO.includes(wo.status)) throw new DomainError("state", `Order ${wo.workOrderNumber} is ${wo.status.replace(/_/g, " ")}. Materials are taken after the order is approved.`);
      const moveStock = await getSetting(tx, ctx.organizationId, "production.prepare.move_stock", b.siteId);
      const scanLots = await getSetting(tx, ctx.organizationId, "production.prepare.scan_lots", b.siteId);
      if (moveStock) ctx.require("inventory.movement.post");

      const lines = await loadLines(tx, b);
      const pickRowsNow = await tx.select().from(batchMaterialPicks).where(eq(batchMaterialPicks.batchId, b.id));
      const current = currentPicks(pickRowsNow);
      const stateOf = (id: string) => {
        const a = current.get(id)?.action;
        return !a || a === "untaken" ? "open" : a;
      };
      const todo = input.all
        ? lines.filter((l) => stateOf(l.bm.id) === "open").map((l) => ({ batchMaterialId: l.bm.id, action: "taken" as const, reason: null, lotCode: null }))
        : wanted;
      const held = heldMap(await heldLocations(tx, b.siteId));
      let changed = 0;
      for (const t of todo) {
        const line = lines.find((l) => l.bm.id === t.batchMaterialId);
        if (!line) throw new DomainError("not_found", "That line is not on this batch's materials list.");
        const now = stateOf(line.bm.id);
        if (now === t.action || (t.action === "untaken" && now === "open")) continue; // already so: nothing to record
        let lotId: string | null = null;
        let stagingId: string | null = null;
        let scanned: string | null = null;
        if (t.action === "taken") {
          const lots = await lotsFor(tx, b, wo?.id ?? null, line.material.id, held);
          if (wo && !lots.length) {
            throw new DomainError("state", `Nothing is set aside for ${line.material.name} any more (the set-aside time ended or it was used). Ask the planner to set it aside again.`, { batchMaterialId: line.bm.id });
          }
          if (lots.length) {
            await lockLots(tx, lots.map((l) => l.lotId));
            const reread = await lotsFor(tx, b, wo?.id ?? null, line.material.id, held);
            const bad = reread.find((l) => !l.usable);
            if (bad) {
              throw new DomainError("blocked_lot", `${line.material.name}: lot ${bad.lotNumber} cannot be used (${bad.problem}). Use another lot: ask QA to choose a replacement lot.`, {
                rule: "V-HOLD",
                batchMaterialId: line.bm.id,
                lotNumber: bad.lotNumber,
              });
            }
            lotId = reread[0].lotId;
            if (scanLots) {
              const p = parseScan(t.lotCode ?? "");
              const code = p.kind === "typed" && p.type === "LOT" ? p.value : p.kind === "untyped" ? p.value : null;
              if (!code) throw new DomainError("validation", `Scan the lot label of ${line.material.name}.`, { fieldErrors: { [`lot-${line.bm.id}`]: "Scan the lot label." } });
              const match = reread.find((l) => l.lotNumber.toUpperCase() === code.toUpperCase());
              if (!match) {
                throw new DomainError("blocked_lot", `This label says ${code.toUpperCase()}. Take lot ${reread.map((l) => l.lotNumber).join(" or ")} for ${line.material.name}.`, {
                  rule: "V-MAT",
                  fieldErrors: { [`lot-${line.bm.id}`]: "Wrong lot." },
                });
              }
              lotId = match.lotId;
              scanned = code.toUpperCase();
            }
          }
          if (moveStock && lots.length) {
            const kinds = await stagingKinds(tx, ctx.organizationId, b.siteId);
            const [to] = input.toLocationCode?.trim()
              ? await tx.select().from(locations).where(and(eq(locations.siteId, b.siteId), eq(locations.code, input.toLocationCode.trim().toUpperCase().replace(/^BC:LOC:/, "")))).limit(1)
              : await tx.select().from(locations).where(and(eq(locations.siteId, b.siteId), eq(locations.isActive, true), inArray(locations.kind, kinds))).orderBy(asc(locations.code)).limit(1);
            if (!to) throw new DomainError("validation", "No production area is set up at this site to move the materials to. Ask the site manager.", { field: "toLocationCode" });
            // One staging transfer per set-aside lot until the ingredient is covered (same rules as staging by scan).
            for (const lot of await lotsFor(tx, b, wo!.id, line.material.id, held)) {
              const r = await stageInTx(tx, ctx, b, { lotNumber: lot.lotNumber, locCode: to.code, fromLocationId: lot.locationId });
              stagingId = r.stagingId;
              if (new Decimal(r.remaining).lte(0)) break;
            }
          }
        }
        if (t.action === "untaken" && current.get(line.bm.id)?.stagingId) {
          throw new DomainError("state", `${line.material.name} was moved to the production area in the stock ledger. Ask the storekeeper to move it back; the tick stays.`);
        }
        const reason = t.reason?.trim() || null;
        const [row] = await tx
          .insert(batchMaterialPicks)
          .values({
            organizationId: b.organizationId,
            siteId: b.siteId,
            batchId: b.id,
            batchMaterialId: line.bm.id,
            action: t.action,
            lotId,
            scannedLotCode: scanned,
            stagingId,
            reason,
            pickedBy: ctx.userId,
          })
          .returning();
        current.set(line.bm.id, row);
        changed += 1;
        const lotNumber = lotId ? (await tx.select({ n: inventoryLots.lotNumber }).from(inventoryLots).where(eq(inventoryLots.id, lotId)).limit(1))[0]?.n : null;
        await audit(tx, ctx, {
          action: t.action === "taken" ? "production.pick_line.confirmed" : t.action === "not_needed" ? "production.pick_line.not_needed" : "production.pick_line.withdrawn",
          entityType: "batch",
          entityId: b.id,
          entityNumber: b.batchNumber,
          siteId: b.siteId,
          reason,
          before: { state: now },
          after: { pickId: row.id, material: line.material.code, materialName: line.material.name, state: t.action, lot: lotNumber ?? null, scanned, stockMoved: !!stagingId, moveStock },
        });
      }
      const progress = pickProgress(lines.map((l) => l.bm.id), current);
      // All lines Taken / Not needed → planned → materials_staged (data-model §6.2). With move_stock on
      // the staging transfer of the last line may already have moved the batch (stageInTx).
      if (progress.complete && b.status === "planned") {
        await transitionBatch(tx, ctx, b, "materials_staged", { reason: moveStock ? "Materials list complete (stock moved to the production area)" : "Materials list complete (no stock move)" });
        await audit(tx, ctx, {
          action: "production.batch.state_changed",
          entityType: "batch",
          entityId: b.id,
          entityNumber: b.batchNumber,
          siteId: b.siteId,
          before: { status: "planned" },
          after: { status: "materials_staged", trigger: "materials_list", taken: progress.taken, notNeeded: progress.notNeeded },
        });
      }
      const status: string = b.status;
      return { batchNumber: b.batchNumber, changed, progress, status, ready: status === "materials_staged" };
    });
    return result;
  });
}

/** Pick progress of a batch in the caller's transaction (startBatch fallback). */
export async function pickProgressInTx(tx: Tx, batchId: string): Promise<PickProgress> {
  const lines = await tx.select({ id: batchMaterials.id }).from(batchMaterials).where(eq(batchMaterials.batchId, batchId));
  const rows = await tx.select().from(batchMaterialPicks).where(eq(batchMaterialPicks.batchId, batchId));
  return pickProgress(lines.map((l) => l.id), currentPicks(rows));
}
