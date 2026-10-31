"use server";
import { refreshCurrentPage } from "@/lib/in-place";
import { z } from "zod";
import { type AuthContext, requireContext } from "@/lib/auth/context";
import { coSign } from "@/lib/auth/co-sign";
import { type ActionState, DomainError, toActionState } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { approveYield, checkDispense, checkStep, decideScrapRework, recordDispense, returnStep, startStep, voidDispense, batchSiteId } from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";

// Execution ↔ QA hooks (idempotent; also registered at server start in src/instrumentation.ts).
registerAppHooks();

/**
 * Server actions kept from the old batch workspace (W2B, US-3-09..13) after the one-path change of
 * 2026-10-31: advanced weighing, checks, voids and legacy approvals. Step, packaging, yield and transfer
 * actions moved to the flow screens (orders/[workOrderId]/flow-actions.ts, finish/actions.ts).
 * Batch workspace server actions (W2B, US-3-09..13). Thin adapters: parse the form, build the
 * co-signer context when a second person signs on this device (their own password, coSign), call the
 * service, revalidate. All rules live in src/modules/production.
 */

const uuid = z.string().uuid("Choose a valid option.");
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const opt = (fd: FormData, k: string) => {
  const v = str(fd, k)?.trim();
  return v ? v : null;
};
const num = (fd: FormData, k: string) => z.coerce.number().int().min(1).max(999).parse(str(fd, k));

/** The second person who signed on this device, or null when nobody was chosen. */
async function signer(ctx: AuthContext, fd: FormData, prefix: "checker" | "approver", permission: Permission, batchId: string): Promise<AuthContext | null> {
  const id = opt(fd, `${prefix}Id`);
  if (!id) return null;
  const siteId = await batchSiteId(ctx, batchId);
  return coSign(ctx, { userId: id, password: str(fd, `${prefix}Password`) ?? "", role: prefix === "checker" ? "checker" : "exception_approver", permission, siteId });
}

function done(batchId: string, message: string): ActionState {
  refreshCurrentPage();
  return { ok: true, message };
}

export async function dispenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const checker = await signer(ctx, fd, "checker", "production.dispense_record.approve", batchId);
    const approver = await signer(ctx, fd, "approver", "production.over_tolerance_dispense.approve", batchId);
    const r = await recordDispense(
      ctx,
      {
        batchId,
        batchMaterialId: uuid.parse(str(fd, "batchMaterialId")),
        lotRef: z.string().trim().min(1, "Scan the lot label on the container.").max(200).parse(str(fd, "lotRef") ?? ""),
        locationRef: opt(fd, "locationRef"),
        qty: opt(fd, "qty"),
        uom: opt(fd, "uom") ?? undefined,
        tare: opt(fd, "tare"),
        gross: opt(fd, "gross"),
        equipmentRef: opt(fd, "equipmentRef"),
        partial: str(fd, "partial") === "on",
        supersedesId: opt(fd, "supersedesId"),
        correctionReason: opt(fd, "correctionReason"),
        exceptionReason: opt(fd, "exceptionReason"),
        idempotencyKey: opt(fd, "idempotencyKey"),
      },
      { checker, exceptionApprover: approver },
    );
    const what = r.status === "partial" ? `${r.materialName}: part weighed (line total ${r.lineTotalG} g). Weigh the next lot.` : r.status === "exception" ? `${r.materialName} recorded under an approved exception.` : `${r.materialName} weighed.`;
    return done(batchId, `${what}${r.checked ? " Checked." : " Waiting for the checker."}`);
  } catch (e) {
    return toActionState(e);
  }
}

export async function checkDispenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const r = await checkDispense(ctx, { dispenseRecordId: uuid.parse(str(fd, "dispenseRecordId")), idempotencyKey: opt(fd, "idempotencyKey") });
    return done(batchId, `${r.materialName} weighing checked.`);
  } catch (e) {
    return toActionState(e);
  }
}

export async function voidDispenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    await voidDispense(ctx, { dispenseRecordId: uuid.parse(str(fd, "dispenseRecordId")), reason: str(fd, "reason") ?? "" });
    return done(batchId, "Weighing voided. Weigh again; the new row will replace it.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function startStepAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const r = await startStep(ctx, { batchId, stepNo: num(fd, "stepNo") });
    return done(batchId, `Step ${r.stepNo} started.`);
  } catch (e) {
    return toActionState(e);
  }
}

export async function checkStepAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const r = await checkStep(ctx, { batchId, stepNo: num(fd, "stepNo"), idempotencyKey: opt(fd, "idempotencyKey") });
    return done(batchId, `Step ${r.stepNo} (${r.name}) checked.`);
  } catch (e) {
    return toActionState(e);
  }
}

export async function returnStepAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const r = await returnStep(ctx, { batchId, stepNo: num(fd, "stepNo"), reason: str(fd, "reason") ?? "" });
    return done(batchId, `Step ${r.stepNo} returned to the operator.`);
  } catch (e) {
    return toActionState(e);
  }
}

export async function approveYieldAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    await approveYield(ctx, { yieldRecordId: uuid.parse(str(fd, "yieldRecordId")), reason: str(fd, "reason") ?? "" });
    return done(batchId, "Yield approved; deviation opened.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function decideScrapAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const decision = z.enum(["approve", "reject"]).parse(str(fd, "decision"));
    await decideScrapRework(ctx, { scrapReworkRecordId: uuid.parse(str(fd, "scrapReworkRecordId")), decision, note: str(fd, "note") ?? "" });
    return done(batchId, decision === "approve" ? "Approved." : "Rejected.");
  } catch (e) {
    return toActionState(e);
  }
}
