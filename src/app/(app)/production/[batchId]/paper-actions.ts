"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { enterStepFromPaper, enterWeighingFromPaper, issuePaperPack, voidUnusedPackPages } from "@/modules/production";

/**
 * ADR-134 thin adapters: make the paper batch record pack, say it was not used, and type lines in from paper. The
 * services check permissions, sites, the page, the time on the paper and the people named on it.
 */
const uuid = z.string().uuid("Choose a valid option.");
const key = () => z.string().min(8, "The form is missing its submission key. Reload the page and try again.").max(100);
const opt = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

/** `datetime-local` from the form is Manila wall time (ADR-019); the service gets an exact instant. */
function manilaInstant(v: string | null): string | null {
  if (!v) return null;
  return /[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : `${v.length === 16 ? `${v}:00` : v}+08:00`;
}

export async function makePaperPackAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(fd.get("batchId"));
    const r = await issuePaperPack(ctx, { batchId, idempotencyKey: key().parse(fd.get("idempotencyKey")) });
    revalidatePath(`/production/${batchId}`);
    return { ok: true, message: r.replayed ? "The paper record was already made. It is the same pages." : `The paper record is ready: ${r.pages.length} pages. It is being saved on this device for printing without internet.` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function paperNotUsedAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(fd.get("batchId"));
    const r = await voidUnusedPackPages(ctx, { batchId, reason: String(fd.get("reason") ?? "") });
    revalidatePath(`/production/${batchId}`);
    return { ok: true, message: r.kept.length ? `${r.voided} blank pages closed. Kept (lines were typed from them): ${r.kept.join(", ")}.` : `${r.voided} blank pages closed.` };
  } catch (e) {
    return toActionState(e);
  }
}

function paperFacts(fd: FormData) {
  return {
    paperRecordId: String(fd.get("paperRecordId") ?? ""),
    occurredAt: manilaInstant(opt(fd, "occurredAt")) ?? "",
    startedAt: manilaInstant(opt(fd, "startedAt")),
    doneById: String(fd.get("doneById") ?? ""),
    checkedById: opt(fd, "checkedById"),
    outageReason: opt(fd, "outageReason"),
    outageNote: opt(fd, "outageNote"),
  };
}

export async function enterWeighingFromPaperAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(fd.get("batchId"));
    const r = await enterWeighingFromPaper(ctx, {
      batchId,
      batchMaterialId: uuid.parse(fd.get("batchMaterialId")),
      lotRef: String(fd.get("lotRef") ?? "").trim(),
      qty: opt(fd, "qty"),
      uom: opt(fd, "uom") ?? undefined,
      equipmentRef: opt(fd, "equipmentRef"),
      offPlanReasonCode: opt(fd, "offPlanReasonCode"),
      offPlanNote: opt(fd, "offPlanNote"),
      paper: paperFacts(fd),
      idempotencyKey: key().parse(fd.get("idempotencyKey")),
    });
    revalidatePath(`/production/${batchId}/from-paper`);
    return r.withinTolerance
      ? { ok: true, message: `${r.materialName} typed in from paper.` }
      : { ok: true, tone: "warn", message: `${r.materialName} typed in from paper. It is outside the allowed range: QA was told and decides.` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function enterStepFromPaperAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(fd.get("batchId"));
    const answers = [...fd.entries()]
      .filter(([k]) => k.startsWith("answer-"))
      .map(([k, v]) => ({ itemId: k.slice(7), answer: String(v) as "yes" | "no" | "na", note: opt(fd, `note-${k.slice(7)}`) }));
    const readings = [...fd.entries()].filter(([k]) => k.startsWith("reading-")).map(([k, v]) => ({ parameterId: k.slice(8), value: String(v) }));
    const r = await enterStepFromPaper(ctx, {
      batchId,
      stepNo: z.coerce.number().int().min(1).parse(fd.get("stepNo")),
      answers,
      readings,
      equipmentRef: opt(fd, "equipmentRef"),
      notes: opt(fd, "notes"),
      paper: paperFacts(fd),
      idempotencyKey: key().parse(fd.get("idempotencyKey")),
    });
    revalidatePath(`/production/${batchId}/from-paper`);
    if (r.deviationId) return { ok: true, tone: "warn", message: `Step ${r.stepNo} typed in from paper. Something was outside its limits: QA was told and decides.` };
    return { ok: true, message: r.status === "completed" ? `Step ${r.stepNo} typed in from paper.` : `Step ${r.stepNo} typed in from paper. It waits for the checker.` };
  } catch (e) {
    return toActionState(e);
  }
}
