import "server-only";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { containerContents, containers, locations, shelfChecks } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { assertReasonCode } from "@/modules/masterdata";
import { createAdjustment, submitAdjustment } from "./adjustments";
import { claimIdempotencyKey, storeIdempotentResult } from "./command-kit";
import { lockLots } from "./ledger";
import { isUuid } from "./lots";
import { looseQty } from "./moves";

/**
 * ADR-138 §3 "Count what's left": the quick count that catches missed take-outs. Count the pieces in an open box (or
 * the loose pieces of one lot on a shelf); the app shows the difference. The same number = a check (restarts the
 * reminder clock). A difference needs a reason from the shared list (category `adjustment`, e.g. "Taken out but not
 * written down") and becomes a stock fix sent for approval through the EXISTING adjustment flow (createAdjustment +
 * submitAdjustment, the `stock_adjustment` approval rules, then "Save to stock"). Nothing here changes stock itself.
 *
 * Who: anyone who may take pieces out or fix stock may record a check; a difference needs `inventory.adjustment.create`
 * and `.submit` (people without them are told to ask the warehouse).
 */

export type CountLeftInput = {
  containerId?: string | null;
  /** Loose pieces: the lot and the shelf. In a box with several lots: the lot. */
  lotId?: string | null;
  locationId?: string | null;
  counted: string;
  reasonCode?: string | null;
  note?: string | null;
  idempotencyKey: string;
};

export type CountLeftResult = { id: string; expected: string; counted: string; difference: string; uom: string; adjustmentId: string | null; adjustmentNumber: string | null; replayed: boolean };

const WHOLE = /^\d{1,9}$/;
const DEC = /^\d{1,12}(\.\d{1,6})?$/;

export async function countWhatIsLeft(ctx: AuthContext, input: CountLeftInput): Promise<CountLeftResult> {
  if (!ctx.can("inventory.takeout.create") && !ctx.can("inventory.adjustment.create")) ctx.require("inventory.takeout.create");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);
  if (!input.idempotencyKey?.trim()) throw new DomainError("validation", "The form is not ready yet. Wait a moment and try again.");
  const counted = String(input.counted ?? "").trim();
  if (!DEC.test(counted)) throw new DomainError("validation", "Enter how many you counted (0 or more).", { field: "counted", fieldErrors: { counted: "Enter a number, 0 or more." } });
  const key = `shelf_check:${input.idempotencyKey}`;
  const body = { ...input, idempotencyKey: undefined, siteId };
  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<Omit<CountLeftResult, "replayed">>(tx, ctx.organizationId, key, "inventory.shelf_check.create", body);
    if (claimed) return { ...claimed.replay, replayed: true };
    let box: typeof containers.$inferSelect | null = null;
    let lotId = input.lotId ?? null;
    let locationId = input.locationId ?? null;
    if (input.containerId) {
      if (!isUuid(input.containerId)) throw new DomainError("not_found", "Box not found in your sites.");
      const [b] = await tx.select().from(containers).where(eq(containers.id, input.containerId)).for("update").limit(1);
      if (!b || b.organizationId !== ctx.organizationId || !ctx.allowedSiteIds.includes(b.siteId) || b.siteId !== siteId) throw new DomainError("not_found", `Box not found at ${ctx.currentSite.name}.`);
      if (!["open", "sealed"].includes(b.status) || !b.currentLocationId) throw new DomainError("state", `Box ${b.containerNumber} is not on a shelf (it is ${b.status}).`);
      const contents = await tx.select().from(containerContents).where(eq(containerContents.containerId, b.id));
      const live = contents.filter((c) => new Decimal(c.qtyBase).gt(0));
      lotId ??= live.length === 1 ? live[0].lotId : contents.length === 1 ? contents[0].lotId : null;
      if (!lotId) throw new DomainError("validation", `Box ${b.containerNumber} holds several lots; choose the lot you count.`, { field: "lotId" });
      box = b;
      locationId = b.currentLocationId;
    }
    if (!lotId || !isUuid(lotId) || !locationId || !isUuid(locationId)) throw new DomainError("validation", "Scan the box, or choose the lot and the shelf you count.");
    const [lot] = await lockLots(tx, [lotId]);
    if (!lot || lot.organizationId !== ctx.organizationId || lot.siteId !== siteId) throw new DomainError("not_found", `Lot not found at ${ctx.currentSite.name}.`);
    const [loc] = await tx.select().from(locations).where(eq(locations.id, locationId)).limit(1);
    if (!loc || loc.siteId !== siteId) throw new DomainError("not_found", `Shelf not found at ${ctx.currentSite.name}.`);
    if (lot.baseUom === "pcs" && !WHOLE.test(counted)) throw new DomainError("validation", "Count whole pieces.", { field: "counted", fieldErrors: { counted: "Whole pieces only." } });
    let expected: Decimal;
    if (box) {
      const [c] = await tx.select().from(containerContents).where(and(eq(containerContents.containerId, box.id), eq(containerContents.lotId, lot.id)));
      expected = new Decimal(c?.qtyBase ?? 0);
    } else expected = await looseQty(tx, lot.id, loc.id);
    const got = new Decimal(counted);
    const diff = got.minus(expected);
    let adjustmentId: string | null = null;
    let adjustmentNumber: string | null = null;
    let reasonCode: string | null = null;
    const note = input.note?.trim() || null;
    if (!diff.isZero()) {
      if (!ctx.can("inventory.adjustment.create") || !ctx.can("inventory.adjustment.submit")) {
        throw new DomainError("forbidden", `You counted ${got.toString()}, the app expects ${expected.toString()}. Ask the warehouse or the site manager to count it and fix the stock.`, { permission: "inventory.adjustment.create", siteId });
      }
      const r = await assertReasonCode(tx, ctx.organizationId, "adjustment", input.reasonCode, note).catch((e) => {
        if (e instanceof DomainError) throw new DomainError("validation", e.message === "Choose a reason." ? "The count is different. Choose why." : e.message, { field: e.details?.field ?? "reasonCode", fieldErrors: { [String(e.details?.field ?? "reasonCode")]: e.message } });
        throw e;
      });
      reasonCode = r.code;
      const what = box ? `box ${box.containerNumber}` : `loose pieces at ${loc.code}`;
      const a = await createAdjustment(
        ctx,
        {
          reasonCode: r.code,
          reasonNote: [note, `Counted ${got.toString()} in ${what}; the app expected ${expected.toString()} (Count what's left).`].filter(Boolean).join(" "),
          lines: [{ lotId: lot.id, locationId: loc.id, containerId: box?.id ?? null, direction: diff.lt(0) ? "decrease" : "increase", qty: diff.abs().toString(), note: `Count what's left: ${what}` }],
          idempotencyKey: `${input.idempotencyKey}:fix`,
        },
        { tx },
      );
      await submitAdjustment(ctx, a.id, { tx });
      adjustmentId = a.id;
      adjustmentNumber = a.adjustmentNumber;
    }
    const [row] = await tx
      .insert(shelfChecks)
      .values({ organizationId: ctx.organizationId, siteId, locationId: loc.id, containerId: box?.id ?? null, lotId: lot.id, expectedQty: expected.toString(), countedQty: got.toString(), baseUom: lot.baseUom, reasonCode, note, stockAdjustmentId: adjustmentId, countedBy: ctx.userId, idempotencyKey: key })
      .returning();
    await audit(tx, ctx, {
      action: "inventory.shelf_check.recorded",
      entityType: box ? "container" : "inventory_lot",
      entityId: box?.id ?? lot.id,
      entityNumber: box?.containerNumber ?? lot.lotNumber,
      siteId,
      reason: reasonCode,
      after: { place: loc.code, lot: lot.lotNumber, expected: expected.toString(), counted: got.toString(), difference: diff.toString(), adjustment: adjustmentNumber },
    });
    const result = { id: row.id, expected: expected.toString(), counted: got.toString(), difference: diff.toString(), uom: lot.baseUom, adjustmentId, adjustmentNumber };
    await storeIdempotentResult(tx, ctx.organizationId, key, body, result);
    return { ...result, replayed: false };
  });
}
