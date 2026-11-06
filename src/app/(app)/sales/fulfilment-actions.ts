"use server";
import { plural } from "@/lib/plural";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { DomainError, type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import {
  acknowledgeDeliveryReceipt,
  addBox,
  approvePack,
  approveShipmentException,
  cancelPack,
  cancelPick,
  cancelShipment,
  completePacking,
  completePick,
  dispatchShipment,
  generateBoxingNote,
  generateDeliveryReceipt,
  generateDraftDeliveryReceipt,
  generatePickList,
  printPackLabels,
  releaseAllocations,
  removeBox,
  removeShipmentLine,
  repackForCustomer,
  reverseShipment,
  scanPackVerification,
  scanPick,
  startPack,
  startPick,
  submitPack,
  verifyPackScan,
  voidPickLine,
} from "@/modules/sales";
import { findContainerByNumber } from "@/modules/inventory";
import { askPlannerToMake } from "@/modules/production";

/**
 * Server actions of the W3E fulfilment screens (thin adapters: parse, call the service, return
 * ActionState). In-place actions call refreshCurrentPage() (ADR-043); actions that open another
 * page revalidate and redirect. Business rules live in src/modules/sales.
 */

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const uuid = z.string().uuid("Choose a valid option.");
const idem = (fd: FormData) => {
  const k = str(fd, "idempotencyKey");
  if (k.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  return k;
};

/** Result of a scan action, shown on the scanner card (and the page re-renders with fresh progress). */
export type ScanActionResult = { ok: boolean; message: string; tone: "ok" | "warn" | "bad"; code?: string };

function scanError(e: unknown): ScanActionResult {
  const s = toActionState(e);
  const code = e instanceof DomainError ? ((e.details?.code as string | undefined) ?? e.code) : undefined;
  return { ok: false, message: s?.message ?? "Something went wrong.", tone: "bad", code };
}

/* ------------------------------------------------------------------ allocation and picking */

export async function releaseAllocationsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await releaseAllocations(ctx, uuid.parse(str(fd, "orderId")), { reason: str(fd, "reason") });
    refreshCurrentPage();
    return { ok: true, message: `${plural(r.released, "set-aside place")} let go.` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function startPickAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    id = (await startPick(ctx, uuid.parse(str(fd, "orderId")), { idempotencyKey: idem(fd) })).pickId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales/picking");
  redirect(`/sales/picking/${id}`);
}

export type ScanOptions = { qty?: string | null; manualEntryReason?: string | null; labelOk?: boolean };

export async function pickScanAction(pickId: string, payload: string, opts: ScanOptions, idempotencyKey: string): Promise<ScanActionResult> {
  try {
    const ctx = await requireContext();
    const r = await scanPick(ctx, pickId, { payload, qty: opts.qty ?? null, manualEntryReason: opts.manualEntryReason ?? null, idempotencyKey });
    refreshCurrentPage();
    return { ok: true, message: r.message, tone: r.outcome === "duplicate" ? "warn" : "ok" };
  } catch (e) {
    return scanError(e);
  }
}

export async function voidPickLineAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await voidPickLine(ctx, uuid.parse(str(fd, "pickLineId")), str(fd, "reason"));
    refreshCurrentPage();
    return { ok: true, message: "Scan undone." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function completePickAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let shipmentId: string;
  try {
    const ctx = await requireContext();
    await completePick(ctx, uuid.parse(str(fd, "pickId")), { shortPickReason: str(fd, "shortPickReason") || null });
    shipmentId = uuid.parse(str(fd, "shipmentId"));
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales/picking");
  redirect(`/sales/shipments/${shipmentId}?done=picked`);
}

export async function cancelPickAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await cancelPick(ctx, uuid.parse(str(fd, "pickId")), str(fd, "reason"));
    refreshCurrentPage();
    return { ok: true, message: "Stopped. The stock stays set aside for the order." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function generatePickListAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await generatePickList(ctx, uuid.parse(str(fd, "pickId")), { idempotencyKey: idem(fd) });
    refreshCurrentPage();
    return { ok: true, message: `List ${r.documentNumber} saved. Use Print the list.` };
  } catch (e) {
    return toActionState(e);
  }
}

/* ------------------------------------------------------------------ pack verification and dispatch */

export async function verifyScanAction(shipmentId: string, payload: string, opts: ScanOptions, idempotencyKey: string): Promise<ScanActionResult> {
  try {
    const ctx = await requireContext();
    const r = await scanPackVerification(ctx, shipmentId, { payload, qty: opts.qty ?? null, idempotencyKey });
    refreshCurrentPage();
    return { ok: true, message: r.message, tone: r.outcome === "duplicate" ? "warn" : "ok" };
  } catch (e) {
    refreshCurrentPage();
    return scanError(e);
  }
}

export async function removeShipmentLineAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await removeShipmentLine(ctx, uuid.parse(str(fd, "shipmentLineId")), str(fd, "reason"));
    refreshCurrentPage();
    return { ok: true, message: "Taken off." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function approveExceptionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const kind = z.enum(["over_shipment", "partial_shipment"]).parse(str(fd, "kind"));
    await approveShipmentException(ctx, uuid.parse(str(fd, "shipmentId")), {
      kind,
      salesOrderLineId: str(fd, "salesOrderLineId") || null,
      extraQty: str(fd, "extraQty") || null,
      reason: str(fd, "reason"),
      customerReference: str(fd, "customerReference"),
      password: str(fd, "password") || null,
    });
    refreshCurrentPage();
    return { ok: true, message: kind === "over_shipment" ? "Allowed: more than ordered. Scan the extra box again." : "Allowed: send only part." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function completePackingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let shipmentId: string;
  try {
    const ctx = await requireContext();
    shipmentId = uuid.parse(str(fd, "shipmentId"));
    const pc = str(fd, "packageCount");
    if (pc && !/^\d{1,5}$/.test(pc)) return { ok: false, message: "Boxes on the truck: a whole number.", fieldErrors: { packageCount: "Whole number." } };
    await completePacking(ctx, shipmentId, { carrierName: str(fd, "carrierName"), trackingNumber: str(fd, "trackingNumber") || null, grossWeightKg: str(fd, "grossWeightKg") || null, packageCount: pc ? Number(pc) : null, idempotencyKey: idem(fd) });
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales/shipments");
  redirect(`/sales/shipments/${shipmentId}?done=packed`);
}

export async function draftDeliveryReceiptAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await generateDraftDeliveryReceipt(ctx, uuid.parse(str(fd, "shipmentId")), { idempotencyKey: idem(fd) });
    refreshCurrentPage();
    return { ok: true, message: `Draft delivery receipt ${r.documentNumber} saved (no stock moved). Use Print delivery receipt.` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function generateDeliveryReceiptAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await generateDeliveryReceipt(ctx, uuid.parse(str(fd, "shipmentId")), { idempotencyKey: idem(fd) });
    refreshCurrentPage();
    return { ok: true, message: `Delivery receipt ${r.documentNumber} made.` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function dispatchShipmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let shipmentId: string;
  try {
    const ctx = await requireContext();
    shipmentId = uuid.parse(str(fd, "shipmentId"));
    await dispatchShipment(ctx, shipmentId, { driverName: str(fd, "driverName"), vehiclePlate: str(fd, "vehiclePlate"), carrierName: str(fd, "carrierName") || null, idempotencyKey: idem(fd) });
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales");
  redirect(`/sales/shipments/${shipmentId}?done=dispatched`);
}

export async function reverseShipmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await reverseShipment(ctx, uuid.parse(str(fd, "shipmentId")), { reason: str(fd, "reason"), idempotencyKey: idem(fd) });
    refreshCurrentPage();
    return { ok: true, message: `Sending out undone: the stock is back on its shelves (${plural(r.movements, "movement")}).` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function cancelShipmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await cancelShipment(ctx, uuid.parse(str(fd, "shipmentId")), str(fd, "reason"));
    refreshCurrentPage();
    return { ok: true, message: "Delivery cancelled. The stock stays set aside for the order." };
  } catch (e) {
    return toActionState(e);
  }
}

/** DR acknowledgment: a drawn signature arrives as a PNG file from the canvas, a photo as an image file. */
export async function acknowledgeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const kind = z.enum(["drawn", "photo", "name_only"], { message: "Choose the proof." }).parse(str(fd, "kind"));
    const at = str(fd, "receivedAt");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) return { ok: false, message: "Enter the date and time.", fieldErrors: { receivedAt: "Enter the date and time." } };
    const f = fd.get("file");
    const file = f instanceof File && f.size > 0 ? { fileName: f.name || (kind === "drawn" ? "signature.png" : "photo.jpg"), declaredType: f.type, bytes: new Uint8Array(await f.arrayBuffer()) } : null;
    await acknowledgeDeliveryReceipt(ctx, uuid.parse(str(fd, "shipmentId")), {
      receivedByName: str(fd, "receivedByName"),
      receivedByPosition: str(fd, "receivedByPosition") || null,
      receivedAt: new Date(`${at}:00+08:00`),
      remarks: str(fd, "remarks") || null,
      kind,
      file,
      idempotencyKey: idem(fd),
    });
    refreshCurrentPage();
    return { ok: true, message: "Proof of delivery saved; the delivery receipt now shows it was received." };
  } catch (e) {
    return toActionState(e);
  }
}

/* ------------------------------------------------------------------ boxing and repack */

export async function startPackAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    id = (await startPack(ctx, { sourceKind: "batch_output", batchOutputId: uuid.parse(str(fd, "batchOutputId")), idempotencyKey: idem(fd) })).packId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/warehouse/packs");
  redirect(`/warehouse/packs/${id}`);
}

export async function addBoxAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target: string | null = null;
  try {
    const ctx = await requireContext();
    const packId = uuid.parse(str(fd, "packId"));
    const r = await addBox(ctx, packId, { lotPayload: str(fd, "lotPayload") || null, qty: str(fd, "qty") || null, idempotencyKey: idem(fd) });
    const packed = `Box ${r.boxNo}${r.partial ? " (part box)" : ""} packed and sealed.`;
    let label = "";
    if (ctx.can("inventory.label_job.create")) {
      // ADR-099 (re-audit B N9): the label is printed here, now: open the print page of this boxing's labels.
      try {
        const jobs = await printPackLabels(ctx, packId, { keyBase: `box-label:${r.containerId}` });
        const bad = jobs.find((j) => j.error);
        if (jobs.some((j) => j.jobId)) target = `/print/labels/pack/${packId}?auto=1`;
        else if (bad) label = ` Its label could not be made: ${bad.error}`;
      } catch (e) {
        label = ` Its label could not be made: ${toActionState(e)?.message ?? ""}`;
      }
    }
    if (!target) {
      refreshCurrentPage();
      return { ok: true, message: `${packed}${label}` };
    }
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/labels");
  redirect(target);
}

export async function removeBoxAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await removeBox(ctx, uuid.parse(str(fd, "packId")), uuid.parse(str(fd, "containerId")), str(fd, "reason"));
    refreshCurrentPage();
    return { ok: true, message: "Box removed; its units are loose again and its label is void." };
  } catch (e) {
    return toActionState(e);
  }
}

/** Box labels card: makes the missing box labels (one per box, recorded label jobs) and opens their print page (ADR-099). */
export async function packLabelsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let packId: string;
  try {
    const ctx = await requireContext();
    packId = uuid.parse(str(fd, "packId"));
    const r = await printPackLabels(ctx, packId, { keyBase: idem(fd) });
    const bad = r.filter((j) => j.error);
    if (bad.length && !r.some((j) => j.jobId)) return { ok: false, message: `The box labels could not be made: ${bad.map((b) => `${b.boxNumber}: ${b.error}`).join("; ")}` };
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/labels");
  redirect(`/print/labels/pack/${packId}?auto=1`);
}

export async function submitPackAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await submitPack(ctx, uuid.parse(str(fd, "packId")));
    refreshCurrentPage();
    return { ok: true, message: r.verificationMode === "all" ? `Submitted. First pack of this SKU: the checker scans all ${r.sampleSize} boxes.` : `Submitted. The checker scans a sample of ${plural(r.sampleSize, "box", "boxes")}.` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function packCheckScanAction(packId: string, payload: string, opts: ScanOptions, idempotencyKey: string): Promise<ScanActionResult> {
  try {
    const ctx = await requireContext();
    const r = await verifyPackScan(ctx, packId, { payload, labelOk: opts.labelOk !== false, idempotencyKey });
    refreshCurrentPage();
    return { ok: r.result === "ok" || r.result === "duplicate", message: `${r.message} (${r.scanned} of ${r.required} checked)`, tone: r.result === "ok" ? "ok" : r.result === "duplicate" ? "warn" : "bad" };
  } catch (e) {
    return scanError(e);
  }
}

export async function approvePackAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await approvePack(ctx, uuid.parse(str(fd, "packId")));
    refreshCurrentPage();
    return { ok: true, message: `Pack ${r.packNumber} verified.${r.boxingNoteNumber ? ` Boxing note ${r.boxingNoteNumber} recorded.` : " The boxing note template isn't set up yet."}` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function cancelPackAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await cancelPack(ctx, uuid.parse(str(fd, "packId")), str(fd, "reason"));
    refreshCurrentPage();
    return { ok: true, message: "Pack cancelled." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function boxingNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await generateBoxingNote(ctx, uuid.parse(str(fd, "packId")), { idempotencyKey: idem(fd) });
    refreshCurrentPage();
    return { ok: true, message: `Boxing note ${r.documentNumber} recorded.` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function repackAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    // One hidden input per box chosen in ScanOrPick (tapped, scanned or found); older clients sent one text.
    const codes = fd.getAll("boxes").map(String).join(" ").split(/[\s,]+/).filter(Boolean);
    if (codes.length === 0) return { ok: false, message: "Scan the boxes to repack.", fieldErrors: { boxes: "Scan at least one box." } };
    const ids: string[] = [];
    for (const c of codes) {
      const hit = await findContainerByNumber(ctx, c);
      if (!hit) return { ok: false, message: `No box ${c} in your sites.`, fieldErrors: { boxes: `No box ${c}.` } };
      ids.push(hit.id);
    }
    const u = str(fd, "unitsPerBox");
    if (u && !/^\d{1,6}$/.test(u)) return { ok: false, message: "Units per box: a whole number.", fieldErrors: { unitsPerBox: "Whole number." } };
    id = (await repackForCustomer(ctx, { containerIds: ids, customerId: str(fd, "customerId") || null, unitsPerBox: u ? Number(u) : null, reason: str(fd, "reason"), idempotencyKey: idem(fd) })).packId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/warehouse/packs");
  redirect(`/warehouse/packs/${id}?done=repacked`);
}

/* ------------------------------------------------------------------ ADR-110 C4: ask the planner to make it */

export async function askPlannerToMakeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await askPlannerToMake(ctx, uuid.parse(str(fd, "salesOrderLineId")));
    refreshCurrentPage();
    if (r.planners === 0) return { ok: false, message: "Nobody at this site can make production orders yet. Ask the site manager." };
    return {
      ok: true,
      message: r.alreadyAsked
        ? `The planner was already told that ${r.salesOrderNumber} needs ${r.missing} ${r.productName}. They see it on their Home.`
        : `Asked: ${plural(r.told, "planner")} told that ${r.salesOrderNumber} needs ${r.missing} ${r.productName}. Next: the planner makes a production order for it; it shows here when it starts.`,
    };
  } catch (e) {
    return toActionState(e);
  }
}
