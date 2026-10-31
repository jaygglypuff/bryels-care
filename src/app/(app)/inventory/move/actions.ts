"use server";
import { revalidatePath } from "next/cache";
import { and, eq, gt, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import { db } from "@/db/client";
import { inventoryBalances, inventoryLots, locations, materials, products } from "@/db/schema";
import { requireContext } from "@/lib/auth/context";
import { readSession } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors";
import { allowedDestinationKinds } from "@/modules/inventory/lots";
import { boxedQty, scanMove, undoMove, type MoveResult } from "@/modules/inventory/moves";
import { findContainerByNumber, getContainer } from "@/modules/inventory/containers";
import { keywordMatches } from "@/modules/scan";
import { actionError } from "../_kit/action-state";

export type SourceInfo =
  | {
      kind: "box";
      id: string;
      number: string;
      location: { id: string; code: string } | null;
      contents: { lotNumber: string; itemName: string; qty: string; uom: string; status: string }[];
      allowedKinds: string[];
      blockedReason: string | null;
    }
  | {
      kind: "lot";
      id: string;
      lotNumber: string;
      itemName: string;
      baseUom: string;
      status: string;
      allowedKinds: string[];
      locations: { id: string; code: string; loose: string; boxed: string }[];
    };

export type LotMatch = { lotNumber: string; title: string; detail: string };
type Lookup<T> = { ok: true; data: T } | { ok: false; message: string; matches?: LotMatch[] };

const clean = (raw: string) => raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().toUpperCase().slice(0, 100);

/** Step 1: resolve a scanned box or lot (BC:BOX / BC:LOT or typed number) in the user's current site. */
export async function lookupSourceAction(raw: string): Promise<Lookup<SourceInfo>> {
  try {
    const ctx = await requireContext();
    ctx.require("inventory.movement.post");
    const code = clean(raw);
    if (!code) return { ok: false, message: "Scan a box or lot label, or type the item name." };
    if (code.startsWith("BC:BOX:") || /^BX-/.test(code)) {
      if (!ctx.can("inventory.container.view")) return { ok: false, message: "Your role cannot open boxes." };
      const hit = await findContainerByNumber(ctx, code);
      if (!hit || hit.siteId !== ctx.currentSiteId) return { ok: false, message: `No box matches ${code.replace("BC:BOX:", "")} at ${ctx.currentSite.code}.` };
      const box = await getContainer(ctx, hit.id);
      const kinds = [...new Set(box.contents.flatMap((c) => allowedDestinationKinds(c.qualityStatus, c.expiresOn)))];
      const move = box.allowedActions.find((a) => a.key === "move");
      return {
        ok: true,
        data: {
          kind: "box",
          id: box.id,
          number: box.containerNumber,
          location: box.currentLocationId ? { id: box.currentLocationId, code: box.locationCode ?? "" } : null,
          contents: box.contents.map((c) => ({ lotNumber: c.lotNumber, itemName: c.itemName, qty: new Decimal(c.qtyBase).toString(), uom: c.baseUom, status: c.qualityStatus })),
          allowedKinds: kinds,
          blockedReason: move && !move.allowed ? (move.reason ?? "This box cannot be moved.") : null,
        },
      };
    }
    const number = code.replace(/^BC:LOT:/, "");
    const [lot] = await db
      .select({ lot: inventoryLots, mName: materials.name, pName: products.name })
      .from(inventoryLots)
      .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
      .leftJoin(products, eq(products.id, inventoryLots.productId))
      .where(and(eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.lotNumber, number), eq(inventoryLots.siteId, ctx.currentSiteId)))
      .limit(1);
    if (!lot) {
      // Grade-5 (ADR-088): never type a code. Words ("coconut oil") find lots by name (keywordMatches, ADR-085).
      const words = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100);
      const matches = ctx.can("inventory.lot.view")
        ? (await keywordMatches(ctx, words))
            .map((m) => ({ lotNumber: m.title.split(" · lot ").pop() ?? "", title: m.title.split(" · lot ")[0], detail: m.detail }))
            .filter((m) => m.lotNumber && !m.detail.startsWith("none left"))
            .slice(0, 8)
        : [];
      if (matches.length) return { ok: false, message: matches.length === 1 ? "Is this the one? Tap it." : `${matches.length} lots match. Tap the right one.`, matches };
      return { ok: false, message: `Nothing matches "${words}" at ${ctx.currentSite.name}. Scan the label, or try another word.` };
    }
    return { ok: true, data: await lotSource(lot.lot, lot.mName ?? lot.pName ?? "") };
  } catch (e) {
    return { ok: false, message: actionError(e)?.message ?? "Lookup failed." };
  }
}

async function lotSource(lot: typeof inventoryLots.$inferSelect, itemName: string): Promise<SourceInfo> {
  const bals = await db
    .select({ id: locations.id, code: locations.code, qty: inventoryBalances.qtyBase })
    .from(inventoryBalances)
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .where(and(eq(inventoryBalances.lotId, lot.id), gt(inventoryBalances.qtyBase, "0")));
  const rows = [];
  for (const b of bals) {
    const boxed = await boxedQty(db, lot.id, b.id);
    rows.push({ id: b.id, code: b.code, boxed: boxed.toString(), loose: Decimal.max(new Decimal(b.qty).minus(boxed), 0).toString() });
  }
  return {
    kind: "lot",
    id: lot.id,
    lotNumber: lot.lotNumber,
    itemName,
    baseUom: lot.baseUom,
    status: lot.qualityStatus,
    allowedKinds: allowedDestinationKinds(lot.qualityStatus, lot.expiresOn),
    locations: rows.sort((a, b) => a.code.localeCompare(b.code)),
  };
}

/** Prefill from ?lot=<id> (lot page "Move stock"). */
export async function lotSourceById(lotId: string): Promise<SourceInfo | null> {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view") || !/^[0-9a-f-]{36}$/i.test(lotId)) return null;
  const [lot] = await db
    .select({ lot: inventoryLots, mName: materials.name, pName: products.name })
    .from(inventoryLots)
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .where(and(eq(inventoryLots.id, lotId), inArray(inventoryLots.siteId, [ctx.currentSiteId])))
    .limit(1);
  return lot ? lotSource(lot.lot, lot.mName ?? lot.pName ?? "") : null;
}

/** Step 3: resolve a scanned destination location (BC:LOC:<code> or typed code) at the current site. */
export async function lookupDestinationAction(raw: string): Promise<Lookup<{ id: string; code: string; name: string; kind: string }>> {
  try {
    const ctx = await requireContext();
    ctx.require("inventory.movement.post");
    const code = clean(raw).replace(/^BC:LOC:/, "");
    if (!code) return { ok: false, message: "Scan the destination location label, or choose it from the list." };
    const [loc] = await db.select().from(locations).where(and(eq(locations.siteId, ctx.currentSiteId), eq(locations.code, code))).limit(1);
    if (!loc) return { ok: false, message: `No location ${code} at ${ctx.currentSite.code}.` };
    if (!loc.isActive) return { ok: false, message: `Location ${code} is inactive.` };
    return { ok: true, data: { id: loc.id, code: loc.code, name: loc.name, kind: loc.kind } };
  } catch (e) {
    return { ok: false, message: actionError(e)?.message ?? "Lookup failed." };
  }
}

const MoveSchema = z.object({
  idempotencyKey: z.uuid(),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("box"), containerId: z.uuid() }).strict(),
    // The amount may carry its unit ("20 kg"); the unit picker sends qtyUom. The server converts (decimal.js).
    z.object({ kind: z.literal("lot"), lotId: z.uuid(), fromLocationId: z.uuid(), qty: z.string().trim().min(1, { message: "Enter how much to move, like 20 or 12.5." }).max(40), qtyUom: z.string().trim().max(8).optional() }).strict(),
  ]),
  toLocationId: z.uuid({ message: "Scan or choose the destination." }),
  reason: z.string().trim().max(500).optional(),
}).strict();

export type MoveOutcome = { ok: true; result: MoveResult } | { ok: false; message: string; fieldErrors?: Record<string, string> };

/** Confirm: posts the scan-move (idempotent on the client's key). */
export async function postMoveAction(input: z.input<typeof MoveSchema>): Promise<MoveOutcome> {
  try {
    const ctx = await requireContext();
    const parsed = MoveSchema.parse(input);
    const session = await readSession();
    const result = await scanMove(ctx, { ...parsed, sessionId: session?.sessionId ?? null });
    revalidatePath("/inventory");
    return { ok: true, result };
  } catch (e) {
    const s = actionError(e);
    return { ok: false, message: s?.message ?? "The move was not posted.", fieldErrors: s?.fieldErrors };
  }
}

/** Undo within the window (same actor and session). */
export async function undoMoveAction(transferId: string): Promise<{ ok: boolean; message: string; offerReversalRequest?: boolean }> {
  try {
    const ctx = await requireContext();
    const session = await readSession();
    const r = await undoMove(ctx, { transferId, sessionId: session?.sessionId ?? null });
    revalidatePath("/inventory");
    return { ok: true, message: r.message };
  } catch (e) {
    return { ok: false, message: actionError(e)?.message ?? "Undo failed.", offerReversalRequest: e instanceof DomainError && !!e.details?.offerReversalRequest };
  }
}
