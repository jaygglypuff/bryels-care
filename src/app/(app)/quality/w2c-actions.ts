"use server";
import { revalidatePath } from "next/cache";

/*
 * Response note (Wave 2 integration): actions that answer in place (no redirect) do not call
 * revalidatePath; the forms refresh the router after a success (ActionForm, BulkForm, VerifyScanForm).
 * With revalidatePath, under the pages' loading.tsx boundaries, the response never committed in
 * production builds and the form stayed on "Recording…" although the change was saved (a redirect
 * back to the same page hung the same way). The pages are dynamic, so a refresh is enough. Actions
 * that move to another page (start inspection, raise deviation) keep revalidate + redirect.
 */
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
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
 * disposition, label verification). Thin adapters: parse the form, call the service, revalidate.
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

function refreshInspection(_id: string) {
  // No revalidatePath in place: see the note at the top of this file (the forms refresh the router).
}

export async function recordSampleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const inspectionId = str(fd, "inspectionId");
  try {
    const ctx = await requireContext();
    const r = await recordSample(ctx, { inspectionId, fromLocationId: str(fd, "fromLocationId"), qty: str(fd, "qty"), containerRef: opt(fd, "containerRef"), note: opt(fd, "note"), idempotencyKey: str(fd, "idempotencyKey") });
    refreshInspection(inspectionId);
    return { ok: true, message: r.replayed ? `Sample ${r.sampleNo} was already recorded.` : `Sample ${r.sampleNo} recorded; the quantity was posted as a sample consumption.` };
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
    refreshInspection(inspectionId);
    return { ok: true, message: `${r.testName}: ${r.result} — ${r.passed ? "within specification" : "OUT OF SPECIFICATION"}.` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function correctResultAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const inspectionId = str(fd, "inspectionId");
  try {
    const ctx = await requireContext();
    const r = await correctInspectionResult(ctx, { resultId: str(fd, "resultId"), value: opt(fd, "value"), uom: opt(fd, "uom"), conforms: bool(fd, "conforms"), reason: str(fd, "reason") });
    refreshInspection(inspectionId);
    return { ok: true, message: `Correction recorded: ${r.result}. The original entry stays visible, struck through.` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function submitInspectionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const inspectionId = str(fd, "inspectionId");
  try {
    const ctx = await requireContext();
    await submitInspection(ctx, { inspectionId });
    refreshInspection(inspectionId);
    return { ok: true, message: "Submitted for review by a second QA user." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function reviewInspectionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const inspectionId = str(fd, "inspectionId");
  try {
    const ctx = await requireContext();
    const r = await reviewInspection(ctx, { inspectionId, decision: str(fd, "decision") as ReviewDecision, note: opt(fd, "note") });
    refreshInspection(inspectionId);
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
    refreshInspection(inspectionId);
    return { ok: true, message: "Inspection cancelled." };
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

function refreshDeviation(_id: string) {
  // No revalidatePath in place: see the note at the top of this file (the forms refresh the router).
}

export async function startInvestigationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const deviationId = str(fd, "deviationId");
  try {
    const ctx = await requireContext();
    await startInvestigation(ctx, { deviationId, severity: str(fd, "severity"), investigation: str(fd, "investigation"), impactAssessment: opt(fd, "impactAssessment") });
    refreshDeviation(deviationId);
    return { ok: true, message: "Severity recorded; the deviation is under investigation." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function updateInvestigationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const deviationId = str(fd, "deviationId");
  try {
    const ctx = await requireContext();
    await updateInvestigation(ctx, { deviationId, severity: opt(fd, "severity"), investigation: opt(fd, "investigation"), impactAssessment: opt(fd, "impactAssessment"), rootCause: opt(fd, "rootCause") });
    refreshDeviation(deviationId);
    return { ok: true, message: "Investigation record updated." };
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
    refreshDeviation(deviationId);
    return { ok: true, message: `Containment hold ${r.holdNumber} placed and linked.` };
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
    refreshDeviation(deviationId);
    return { ok: true, message: "Deviation closed." };
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
    return { ok: true, message: "Conditional release requested. A second approver must decide it." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function decideConditionalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const batchId = str(fd, "batchId");
  try {
    const ctx = await requireContext();
    const r = await decideConditionalRelease(ctx, { requestId: str(fd, "requestId"), decision: str(fd, "decision") === "approve" ? "approve" : "reject", note: str(fd, "note") });
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
    return {
      ok: true,
      message: r.status === "verified" ? `${r.kind === "box" ? "Box" : "Lot"} ${r.number} verified.` : `${r.kind === "box" ? "Box" : "Lot"} ${r.number} was already verified${r.verifiedByName ? ` by ${r.verifiedByName}` : ""}.`,
      last: { status: r.status, kind: r.kind, number: r.number },
    };
  } catch (e) {
    return toActionState(e);
  }
}
