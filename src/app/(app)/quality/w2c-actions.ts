"use server";
import { revalidatePath } from "next/cache";

/*
 * In-place actions (the user stays on the inspection, deviation, batch or bulk page) end with
 * refreshCurrentPage() on success: the action response carries the re-rendered page, so the result
 * and the fresh data commit together (ADR-043). Actions that move to another page (start
 * inspection, raise deviation) revalidate and redirect.
 */
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import {
  applyBulkDisposition,
  cancelConditionalRelease,
  cancelInspection,
  closeDeviation,
  containDeviation,
  correctInspectionResult,
  createInspection,
  decideConditionalRelease,
  openDeviation,
  recordInspectionResult,
  recordSample,
  requestConditionalRelease,
  reviewInspection,
  startInvestigation,
  submitInspection,
  updateInvestigation,
  verifyLabelScan,
  type ReviewDecision,
} from "@/modules/quality";
import { registerAppHooks } from "@/modules/wiring";

// Execution ↔ QA hooks (idempotent; also registered at server start in src/instrumentation.ts).
registerAppHooks();

/**
 * Server actions for Wave 2 W2C quality screens (inspections, deviations, conditional release, bulk
 * disposition, label verification). Thin adapters: parse the form, call the service, refresh.
 */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const opt = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v === null || v === "" ? null : String(v);
};
const bool = (fd: FormData, k: string) => (fd.get(k) === "yes" ? true : fd.get(k) === "no" ? false : null);

/* ------------------------------------------------------------------ inspections */

export async function startInspectionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const r = await createInspection(ctx, { batchId: opt(fd, "batchId"), lotId: opt(fd, "lotId"), processStepRecordId: opt(fd, "processStepRecordId"), idempotencyKey: opt(fd, "idempotencyKey") });
    id = r.inspectionId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/quality");
  redirect(`/quality/inspections/${id}`);
}

export async function recordSampleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const inspectionId = str(fd, "inspectionId");
  try {
    const ctx = await requireContext();
    const r = await recordSample(ctx, { inspectionId, fromLocationId: str(fd, "fromLocationId"), qty: str(fd, "qty"), containerRef: opt(fd, "containerRef"), note: opt(fd, "note"), idempotencyKey: str(fd, "idempotencyKey") });
    refreshCurrentPage();
    return { ok: true, message: r.replayed ? `Sample ${r.sampleNo} was already saved.` : `Sample ${r.sampleNo} saved; that amount was taken out of stock.` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function recordResultAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const inspectionId = str(fd, "inspectionId");
  try {
    const ctx = await requireContext();
    const r = await recordInspectionResult(ctx, {
      inspectionId,
      planTestId: str(fd, "planTestId"),
      value: opt(fd, "value"),
      uom: opt(fd, "uom"),
      conforms: bool(fd, "conforms"),
      instrumentEquipmentId: opt(fd, "instrumentEquipmentId"),
      idempotencyKey: opt(fd, "idempotencyKey"),
    });
    refreshCurrentPage();
    return { ok: true, message: `${r.testName}: ${r.result} — ${r.passed ? "OK" : "NOT OK"}.` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function correctResultAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const inspectionId = str(fd, "inspectionId");
  try {
    const ctx = await requireContext();
    const r = await correctInspectionResult(ctx, { resultId: str(fd, "resultId"), value: opt(fd, "value"), uom: opt(fd, "uom"), conforms: bool(fd, "conforms"), reason: str(fd, "reason") });
    refreshCurrentPage();
    return { ok: true, message: `Correction saved: ${r.result}. The first result stays visible, crossed out.` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function submitInspectionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const inspectionId = str(fd, "inspectionId");
  try {
    const ctx = await requireContext();
    await submitInspection(ctx, { inspectionId });
    refreshCurrentPage();
    return { ok: true, message: "Sent: a second QA person checks the results." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function reviewInspectionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const inspectionId = str(fd, "inspectionId");
  try {
    const ctx = await requireContext();
    const r = await reviewInspection(ctx, { inspectionId, decision: str(fd, "decision") as ReviewDecision, note: opt(fd, "note") });
    refreshCurrentPage();
    return { ok: true, message: `Inspection ${r.status === "in_progress" ? "returned for testing" : r.status}.${r.batchStatus ? " The batch is now quarantined and ready for its disposition." : ""}` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function cancelInspectionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const inspectionId = str(fd, "inspectionId");
  try {
    const ctx = await requireContext();
    await cancelInspection(ctx, { inspectionId, reason: str(fd, "reason") });
    refreshCurrentPage();
    return { ok: true, message: "Quality check cancelled." };
  } catch (e) {
    return toActionState(e);
  }
}

/* ------------------------------------------------------------------ deviations */

export async function openDeviationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const r = await openDeviation(ctx, {
      batchId: opt(fd, "batchId"),
      lotId: opt(fd, "lotId"),
      stepRef: opt(fd, "stepRef"),
      inspectionId: opt(fd, "inspectionId"),
      testResultId: opt(fd, "testResultId"),
      description: str(fd, "description"),
      idempotencyKey: opt(fd, "idempotencyKey"),
    });
    id = r.deviationId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/quality/deviations");
  revalidatePath("/quality");
  redirect(`/quality/deviations/${id}?opened=1`);
}

export async function startInvestigationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const deviationId = str(fd, "deviationId");
  try {
    const ctx = await requireContext();
    await startInvestigation(ctx, { deviationId, severity: str(fd, "severity"), investigation: str(fd, "investigation"), impactAssessment: opt(fd, "impactAssessment") });
    refreshCurrentPage();
    return { ok: true, message: "Saved: QA is looking into it." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function updateInvestigationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const deviationId = str(fd, "deviationId");
  try {
    const ctx = await requireContext();
    await updateInvestigation(ctx, { deviationId, severity: opt(fd, "severity"), investigation: opt(fd, "investigation"), impactAssessment: opt(fd, "impactAssessment"), rootCause: opt(fd, "rootCause") });
    refreshCurrentPage();
    return { ok: true, message: "Saved." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function containDeviationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const deviationId = str(fd, "deviationId");
  try {
    const ctx = await requireContext();
    const r = await containDeviation(ctx, {
      deviationId,
      scope: str(fd, "scope") === "location" ? "location" : "lot",
      lotRef: opt(fd, "lotRef"),
      locationId: opt(fd, "locationId"),
      reasonCode: opt(fd, "reasonCode"),
      reason: str(fd, "reason"),
      idempotencyKey: str(fd, "idempotencyKey"),
    });
    refreshCurrentPage();
    return { ok: true, message: `Stopped by QA (${r.holdNumber}).` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function closeDeviationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const deviationId = str(fd, "deviationId");
  try {
    const ctx = await requireContext();
    const permitted = bool(fd, "releasePermitted");
    await closeDeviation(ctx, { deviationId, rootCause: str(fd, "rootCause"), resolution: str(fd, "resolution"), releasePermitted: permitted as boolean, effectivenessCheckOn: opt(fd, "effectivenessCheckOn") });
    refreshCurrentPage();
    return { ok: true, message: "Problem report closed." };
  } catch (e) {
    return toActionState(e);
  }
}

/* ------------------------------------------------------------------ conditional release */

export async function requestConditionalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const batchId = str(fd, "batchId");
  try {
    const ctx = await requireContext();
    await requestConditionalRelease(ctx, { batchId, conditions: str(fd, "conditions"), reviewDate: str(fd, "reviewDate"), reason: str(fd, "reason") });
    refreshCurrentPage();
    return { ok: true, message: "Asked for “OK with conditions”. A second QA person decides." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function decideConditionalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const batchId = str(fd, "batchId");
  try {
    const ctx = await requireContext();
    const r = await decideConditionalRelease(ctx, { requestId: str(fd, "requestId"), decision: str(fd, "decision") === "approve" ? "approve" : "reject", note: str(fd, "note") });
    refreshCurrentPage();
    return { ok: true, message: r.status === "approved" ? `Conditional release approved; the batch and lot ${r.release?.lotNumber ?? ""} are released with conditions.` : "Conditional release rejected." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function cancelConditionalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const batchId = str(fd, "batchId");
  try {
    const ctx = await requireContext();
    await cancelConditionalRelease(ctx, { requestId: str(fd, "requestId"), reason: str(fd, "reason") });
    refreshCurrentPage();
    return { ok: true, message: "Request cancelled." };
  } catch (e) {
    return toActionState(e);
  }
}

/* ------------------------------------------------------------------ bulk disposition */

export type BulkState = (NonNullable<ActionState> & { outcomes?: { lotId: string; lotNumber: string; ok: boolean; toStatus?: string; message?: string; labelNote?: string | null }[]; correlationId?: string }) | null;

export async function bulkDispositionAction(_p: BulkState, fd: FormData): Promise<BulkState> {
  try {
    const ctx = await requireContext();
    const r = await applyBulkDisposition(ctx, {
      lotIds: fd.getAll("lotIds").map(String),
      decision: str(fd, "decision") === "reject" ? "reject" : "release",
      reasonCode: str(fd, "reasonCode"),
      note: opt(fd, "note"),
      password: str(fd, "password"),
    });
    // Lots are decided one by one; refresh whenever at least one decision was recorded.
    if (r.done > 0) refreshCurrentPage();
    return { ok: r.failed === 0, message: `${r.done} of ${r.total} lot(s) decided${r.failed ? `; ${r.failed} refused (see the list)` : ""}. Reference ${r.correlationId}.`, outcomes: r.outcomes, correlationId: r.correlationId };
  } catch (e) {
    return toActionState(e);
  }
}

/* ------------------------------------------------------------------ label verification */

export type VerifyState = (NonNullable<ActionState> & { last?: { status: string; kind: string; number: string } }) | null;

export async function verifyLabelAction(_p: VerifyState, fd: FormData): Promise<VerifyState> {
  const locationId = str(fd, "locationId");
  try {
    const ctx = await requireContext();
    const r = await verifyLabelScan(ctx, { locationId, scan: str(fd, "scan") });
    refreshCurrentPage();
    return {
      ok: true,
      message: r.status === "verified" ? `${r.kind === "box" ? "Box" : "Lot"} ${r.number} verified.` : `${r.kind === "box" ? "Box" : "Lot"} ${r.number} was already verified${r.verifiedByName ? ` by ${r.verifiedByName}` : ""}.`,
      last: { status: r.status, kind: r.kind, number: r.number },
    };
  } catch (e) {
    return toActionState(e);
  }
}
