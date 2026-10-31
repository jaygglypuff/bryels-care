"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { inventoryBalances, inventoryLots, locations, materials, products } from "@/db/schema";
import { requireContext } from "@/lib/auth/context";
import type { ActionState } from "@/lib/errors";
import { fmtFriendly } from "@/lib/units";
import { approveAdjustment, cancelAdjustment, createAdjustment, postAdjustment, rejectAdjustment, submitAdjustment } from "@/modules/inventory/adjustments";
import { keywordMatches } from "@/modules/scan";
import { actionError, str } from "../_kit/action-state";

const Line = z
  .object({
    lotId: z.uuid({ message: "Scan or type the lot, then pick it." }),
    locationId: z.uuid({ message: "Choose the shelf." }),
    direction: z.enum(["increase", "decrease"], { message: "Choose Take away or Add." }),
    // The amount as typed ("2", "2.5 kg"); the unit picker sends qtyUom. The service converts (decimal.js).
    qty: z.string().trim().min(1, { message: "Enter how much, like 2 or 2.5." }).max(40),
    qtyUom: z.string().trim().max(8),
    unitCost: z.union([z.literal(""), z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, { message: "Enter the cost as a number." })]),
    note: z.string().max(300),
  })
  .strict();

const Draft = z
  .object({
    reasonCode: z.string().trim().min(1, { message: "Choose what happened." }).max(40),
    reasonNote: z.string().max(500),
    lines: z.array(Line).min(1, { message: "Add at least one lot." }).max(100),
    idempotencyKey: z.uuid(),
  })
  .strict();

/**
 * Saves the adjustment and, with intent "send" (the main button, "Send to manager"), submits it in the
 * same request: createAdjustment then submitAdjustment, the existing services in order (usability test
 * 2026-10-30). "Save for later" only saves. If the save works but sending is refused, the saved draft
 * opens with the reason so nothing typed is lost.
 */
export async function createAdjustmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const n = Number(str(fd, "lineCount") || "0");
    const lines = [];
    for (let i = 0; i < Math.min(n, 100); i++) {
      if (!str(fd, `lotId_${i}`) && !str(fd, `qty_${i}`)) continue;
      lines.push({
        lotId: str(fd, `lotId_${i}`),
        locationId: str(fd, `locationId_${i}`),
        direction: str(fd, `direction_${i}`),
        qty: str(fd, `qty_${i}`),
        qtyUom: str(fd, `qtyUom_${i}`),
        unitCost: str(fd, `unitCost_${i}`),
        note: str(fd, `note_${i}`),
      });
    }
    const parsed = Draft.safeParse({ reasonCode: str(fd, "reasonCode"), reasonNote: str(fd, "reasonNote"), lines, idempotencyKey: str(fd, "idempotencyKey") });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const i of parsed.error.issues) fieldErrors[i.path.length > 2 ? `${String(i.path[2])}_${String(i.path[1])}` : String(i.path[0] ?? "form")] ??= i.message;
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the highlighted fields.", fieldErrors };
    }
    const input = parsed.data;
    const a = await createAdjustment(ctx, { ...input, lines: input.lines.map((l) => ({ ...l, qtyUom: l.qtyUom || null, unitCost: l.unitCost || null, note: l.note || null })) });
    target = `/inventory/adjustments/${a.id}`;
    if (str(fd, "intent") === "send") {
      try {
        await submitAdjustment(ctx, a.id);
        target += "?sent=1";
      } catch (e) {
        target += `?notSent=${encodeURIComponent((actionError(e)?.message ?? "It could not be sent.").slice(0, 300))}`;
      }
    } else {
      target += "?saved=1";
    }
  } catch (e) {
    return actionError(e);
  }
  revalidatePath("/inventory/adjustments");
  redirect(target);
}

export type AdjustmentLotOption = { id: string; lotNumber: string; itemName: string; baseUom: string; detail: string; shelves: { id: string; code: string; qtyBase: string; text: string }[] };

/**
 * "Scan or type the lot" (usability test 2026-10-30): a scanned label (BC:LOT:…), a lot number, its last
 * digits or words of the item name (keywordMatches, ADR-085). Only lots of the current site, each with
 * the shelves that hold it now.
 */
export async function findLotsForAdjustmentAction(raw: string): Promise<{ ok: true; lots: AdjustmentLotOption[] } | { ok: false; message: string }> {
  try {
    const ctx = await requireContext();
    ctx.require("inventory.adjustment.create");
    const text = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100);
    if (text.length < 2) return { ok: false, message: "Scan the lot label, or type at least 2 letters or digits." };
    const code = text.toUpperCase().replace(/^BC:LOT:/, "");
    const exact = await db.select({ id: inventoryLots.id }).from(inventoryLots).where(and(eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.siteId, ctx.currentSiteId), eq(inventoryLots.lotNumber, code))).limit(1);
    const ids = exact.length
      ? [exact[0].id]
      : (await keywordMatches(ctx, text.replace(/^BC:LOT:/i, "")))
          .map((m) => m.href.split("/").pop() ?? "")
          .filter((x) => /^[0-9a-f-]{36}$/i.test(x))
          .slice(0, 12);
    if (ids.length === 0) return { ok: false, message: `Nothing matches "${text}" at ${ctx.currentSite.code}. Try the last 4 digits of the lot number, or the item name.` };
    const lots = await db
      .select({ id: inventoryLots.id, lotNumber: inventoryLots.lotNumber, baseUom: inventoryLots.baseUom, expiresOn: inventoryLots.expiresOn, mName: materials.name, pName: products.name })
      .from(inventoryLots)
      .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
      .leftJoin(products, eq(products.id, inventoryLots.productId))
      .where(and(inArray(inventoryLots.id, ids), eq(inventoryLots.siteId, ctx.currentSiteId)));
    if (lots.length === 0) return { ok: false, message: `Nothing matches "${text}" at ${ctx.currentSite.code}.` };
    const bals = await db
      .select({ lotId: inventoryBalances.lotId, id: locations.id, code: locations.code, qty: inventoryBalances.qtyBase })
      .from(inventoryBalances)
      .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
      .where(and(inArray(inventoryBalances.lotId, lots.map((l) => l.id)), gt(inventoryBalances.qtyBase, "0"), eq(locations.siteId, ctx.currentSiteId)));
    const out: AdjustmentLotOption[] = lots
      .map((l) => {
        const shelves = bals
          .filter((b) => b.lotId === l.id)
          .sort((a, b) => a.code.localeCompare(b.code))
          .map((b) => ({ id: b.id, code: b.code, qtyBase: String(b.qty), text: fmtFriendly(b.qty, l.baseUom) }));
        return {
          id: l.id,
          lotNumber: l.lotNumber,
          itemName: l.mName ?? l.pName ?? "",
          baseUom: l.baseUom,
          shelves,
          detail: shelves.length ? shelves.map((s) => `${s.text} on ${s.code}`).join(" · ") : "none left on any shelf",
        };
      })
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    return { ok: true, lots: out };
  } catch (e) {
    return { ok: false, message: actionError(e)?.message ?? "The look-up failed." };
  }
}

const done = (id: string, message: string): ActionState => {
  revalidatePath(`/inventory/adjustments/${id}`);
  revalidatePath("/inventory/adjustments");
  return { ok: true, message };
};

export async function submitAdjustmentAction(id: string): Promise<ActionState> {
  try {
    const r = await submitAdjustment(await requireContext(), id);
    return done(id, r.requiresSecondApproval ? "Sent. It is a large change: a site manager and then the owner must approve it." : "Sent to the manager.");
  } catch (e) {
    return actionError(e);
  }
}

export async function approveAdjustmentAction(id: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const r = await approveAdjustment(await requireContext(), id, str(fd, "reason") || null);
    return done(id, r.awaitingSecondStep ? "Approved (step 1). Waiting for the second approval." : "Approved. It can now be saved to stock.");
  } catch (e) {
    return actionError(e);
  }
}

export async function rejectAdjustmentAction(id: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await rejectAdjustment(await requireContext(), id, str(fd, "reason"));
    return done(id, "Not accepted.");
  } catch (e) {
    return actionError(e);
  }
}

export async function cancelAdjustmentAction(id: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await cancelAdjustment(await requireContext(), id, str(fd, "reason"));
    return done(id, "Cancelled.");
  } catch (e) {
    return actionError(e);
  }
}

export async function postAdjustmentAction(id: string, key: string): Promise<ActionState> {
  try {
    const r = await postAdjustment(await requireContext(), id, key);
    revalidatePath("/inventory");
    return done(id, `Saved to stock: ${r.movements.length} ${r.movements.length === 1 ? "change" : "changes"}.`);
  } catch (e) {
    return actionError(e);
  }
}
