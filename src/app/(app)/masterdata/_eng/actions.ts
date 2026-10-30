"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError, type ActionState, toActionState } from "@/lib/errors";
import {
  changeEquipmentStatus,
  createEquipment,
  createFormula,
  createFormulaRevision,
  createInspectionPlan,
  createInspectionPlanRevision,
  createRouting,
  createRoutingRevision,
  createWorkInstruction,
  createWorkInstructionRevision,
  decideEquipmentOverride,
  decideFormulaRevision,
  decideInspectionPlan,
  decideRoutingRevision,
  decideWorkInstructionRevision,
  discardFormulaDraft,
  recordServiceRecord,
  requestEquipmentOverride,
  retireFormulaRevision,
  retireRoutingRevision,
  reviewServiceRecord,
  saveFormulaRevisionDraft,
  saveInspectionPlanDraft,
  saveRoutingRevisionDraft,
  saveWorkInstructionDraft,
  submitFormulaRevision,
  submitInspectionPlan,
  submitRoutingRevision,
  submitWorkInstructionRevision,
  withdrawFormulaRevision,
  withdrawRoutingRevision,
} from "@/modules/masterdata";

/**
 * Server actions for production engineering master data: thin adapters that read the form,
 * call the masterdata service (which validates, authorizes, transacts and audits) and map
 * errors to ActionState. No business rules here.
 */
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const opt = (fd: FormData, k: string) => {
  const v = str(fd, k)?.trim();
  return v ? v : null;
};
const id = (fd: FormData, k = "id") => {
  const v = str(fd, k) ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(v)) throw new DomainError("validation", "The record reference is missing. Reload the page.");
  return v;
};
const json = (fd: FormData) => {
  try {
    return JSON.parse(str(fd, "payload") ?? "null");
  } catch {
    throw new DomainError("validation", "The form could not be read. Reload the page and try again.");
  }
};
const intOrNull = (fd: FormData, k: string) => {
  const v = opt(fd, k);
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new DomainError("validation", "Enter whole days.", { fieldErrors: { [k]: "Whole number." } });
  return n;
};

async function run(fn: (ctx: AuthContext) => Promise<string | void>, paths: string[]): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const message = await fn(ctx);
    for (const p of paths) revalidatePath(p);
    return { ok: true, message: message || "Saved." };
  } catch (e) {
    return toActionState(e);
  }
}

const DECISION_MSG = (r: { status: string; effectiveFrom?: string }) =>
  r.status === "approved" ? `Approved${r.effectiveFrom ? `, effective ${r.effectiveFrom}` : ""}.` : r.status === "rejected" ? "Rejected. The author can start a new revision." : "Step approved. Waiting for the next approver.";
const decisionInput = (fd: FormData) => ({ id: id(fd), decision: str(fd, "decision"), note: opt(fd, "note"), effectiveFrom: opt(fd, "effectiveFrom") });

/* ------------------------------------------------------------------ formulas */

export async function createFormulaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const r = await createFormula(ctx, {
      productId: str(fd, "productId"),
      code: str(fd, "code"),
      name: str(fd, "name"),
      referenceBatchSizeG: str(fd, "referenceBatchSizeG"),
      theoreticalYieldPct: str(fd, "theoreticalYieldPct"),
      changeSummary: opt(fd, "changeSummary"),
    });
    target = `/masterdata/formulas/${r.formulaId}/revisions/${r.revisionId}`;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/masterdata/formulas");
  redirect(target);
}

export async function newFormulaRevisionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const formulaId = id(fd, "formulaId");
    const r = await createFormulaRevision(ctx, { formulaId, baseRevisionId: opt(fd, "baseRevisionId") });
    target = `/masterdata/formulas/${formulaId}/revisions/${r.revisionId}`;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/masterdata/formulas");
  redirect(target);
}

export async function saveFormulaDraftAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    const r = await saveFormulaRevisionDraft(ctx, json(fd));
    return `Draft saved (${r.lineCount} lines).`;
  }, ["/masterdata/formulas"]);
}
export async function submitFormulaAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    await submitFormulaRevision(ctx, id(fd));
    return "Submitted for approval.";
  }, ["/masterdata/formulas"]);
}
export async function withdrawFormulaAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    await withdrawFormulaRevision(ctx, id(fd));
    return "Withdrawn to draft.";
  }, ["/masterdata/formulas"]);
}
export async function decideFormulaAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => DECISION_MSG(await decideFormulaRevision(ctx, decisionInput(fd))), ["/masterdata/formulas", "/production/new"]);
}
export async function retireFormulaAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    await retireFormulaRevision(ctx, { id: id(fd), reason: str(fd, "reason") ?? "" });
    return "Revision retired. It can no longer be used for new batches.";
  }, ["/masterdata/formulas", "/production/new"]);
}
export async function discardFormulaDraftAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const r = await discardFormulaDraft(ctx, id(fd));
    target = r.formulaId ? `/masterdata/formulas/${r.formulaId}` : "/masterdata/formulas";
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/masterdata/formulas");
  redirect(target);
}

/* ------------------------------------------------------------------ routings */

export async function createRoutingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const r = await createRouting(ctx, { productId: str(fd, "productId"), code: str(fd, "code"), name: str(fd, "name"), changeSummary: opt(fd, "changeSummary") });
    target = `/masterdata/routings/${r.routingId}/revisions/${r.revisionId}`;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/masterdata/routings");
  redirect(target);
}
export async function newRoutingRevisionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const routingId = id(fd, "routingId");
    const r = await createRoutingRevision(ctx, { routingId });
    target = `/masterdata/routings/${routingId}/revisions/${r.revisionId}`;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/masterdata/routings");
  redirect(target);
}
export async function saveRoutingDraftAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    const r = await saveRoutingRevisionDraft(ctx, json(fd));
    return `Draft saved (${r.stepCount} steps).`;
  }, ["/masterdata/routings"]);
}
export async function submitRoutingAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    const r = await submitRoutingRevision(ctx, id(fd));
    return r.changeScope === "sequencing_only" ? "Submitted as a sequencing-only change (one site manager approval)." : "Submitted for QA and manager approval.";
  }, ["/masterdata/routings"]);
}
export async function withdrawRoutingAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    await withdrawRoutingRevision(ctx, id(fd));
    return "Withdrawn to draft.";
  }, ["/masterdata/routings"]);
}
export async function decideRoutingAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => DECISION_MSG(await decideRoutingRevision(ctx, decisionInput(fd))), ["/masterdata/routings", "/production/new"]);
}
export async function retireRoutingAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    await retireRoutingRevision(ctx, { id: id(fd), reason: str(fd, "reason") ?? "" });
    return "Revision retired.";
  }, ["/masterdata/routings"]);
}

/* ------------------------------------------------------------------ work instructions */

export async function createWorkInstructionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const r = await createWorkInstruction(ctx, { code: str(fd, "code"), name: str(fd, "name"), bodyMarkdown: str(fd, "bodyMarkdown") });
    target = `/masterdata/work-instructions/${r.workInstructionId}`;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/masterdata/work-instructions");
  redirect(target);
}
export async function newWorkInstructionRevisionAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    await createWorkInstructionRevision(ctx, id(fd, "workInstructionId"));
    return "New draft revision started.";
  }, ["/masterdata/work-instructions"]);
}
export async function saveWorkInstructionAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    await saveWorkInstructionDraft(ctx, { revisionId: id(fd), bodyMarkdown: str(fd, "bodyMarkdown"), changeSummary: opt(fd, "changeSummary") });
    return "Draft saved.";
  }, ["/masterdata/work-instructions"]);
}
export async function submitWorkInstructionAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    await submitWorkInstructionRevision(ctx, id(fd));
    return "Submitted for approval.";
  }, ["/masterdata/work-instructions"]);
}
export async function decideWorkInstructionAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => DECISION_MSG(await decideWorkInstructionRevision(ctx, decisionInput(fd))), ["/masterdata/work-instructions"]);
}

/* ------------------------------------------------------------------ inspection plans */

export async function createInspectionPlanAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const r = await createInspectionPlan(ctx, { code: str(fd, "code"), name: str(fd, "name"), planKind: str(fd, "planKind"), productId: opt(fd, "productId"), materialId: opt(fd, "materialId") });
    target = `/masterdata/inspection-plans/${r.planId}`;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/masterdata/inspection-plans");
  redirect(target);
}
export async function newInspectionPlanRevisionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const r = await createInspectionPlanRevision(ctx, id(fd));
    target = `/masterdata/inspection-plans/${r.planId}`;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/masterdata/inspection-plans");
  redirect(target);
}
export async function saveInspectionPlanAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    await saveInspectionPlanDraft(ctx, json(fd));
    return "Draft saved.";
  }, ["/masterdata/inspection-plans"]);
}
export async function submitInspectionPlanAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    await submitInspectionPlan(ctx, id(fd));
    return "Submitted for approval by a second QA reviewer.";
  }, ["/masterdata/inspection-plans"]);
}
export async function decideInspectionPlanAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => DECISION_MSG(await decideInspectionPlan(ctx, decisionInput(fd))), ["/masterdata/inspection-plans"]);
}

/* ------------------------------------------------------------------ equipment */

export async function createEquipmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const r = await createEquipment(ctx, {
      siteId: str(fd, "siteId"),
      code: str(fd, "code"),
      name: str(fd, "name"),
      equipmentKind: str(fd, "equipmentKind"),
      lineLabel: opt(fd, "lineLabel"),
      calibrationIntervalDays: intOrNull(fd, "calibrationIntervalDays"),
      calibrationDueDate: opt(fd, "calibrationDueDate"),
      maintenanceIntervalDays: intOrNull(fd, "maintenanceIntervalDays"),
      maintenanceDueDate: opt(fd, "maintenanceDueDate"),
      cleaningRule: str(fd, "cleaningRule"),
      qualificationStatus: str(fd, "qualificationStatus"),
      blockingRule: str(fd, "blockingRule"),
      capacityMin: opt(fd, "capacityMin"),
      capacityMax: opt(fd, "capacityMax"),
      capacityUom: opt(fd, "capacityUom"),
    });
    target = `/masterdata/equipment/${r.equipmentId}`;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/masterdata/equipment");
  redirect(target);
}
export async function recordServiceAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    const r = await recordServiceRecord(ctx, {
      equipmentId: id(fd, "equipmentId"),
      serviceKind: str(fd, "serviceKind"),
      result: str(fd, "result"),
      performedByExternal: opt(fd, "performedByExternal"),
      nextDueDate: opt(fd, "nextDueDate"),
      referenceNumber: opt(fd, "referenceNumber"),
      notes: opt(fd, "notes"),
      idempotencyKey: opt(fd, "idempotencyKey"),
    });
    return r.statusChange ? `Recorded. Status changed to ${r.statusChange.to.replace(/_/g, " ")}.` : "Service record saved.";
  }, ["/masterdata/equipment"]);
}
export async function reviewServiceAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    const r = await reviewServiceRecord(ctx, { recordId: id(fd), note: str(fd, "note") ?? "" });
    return r.statusChange ? "Reviewed. The equipment is back in service." : "Reviewed. The equipment stays blocked until a passing calibration is recorded.";
  }, ["/masterdata/equipment"]);
}
export async function changeEquipmentStatusAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    const r = await changeEquipmentStatus(ctx, { equipmentId: id(fd, "equipmentId"), toStatus: str(fd, "toStatus"), reason: str(fd, "reason") ?? "" });
    return `Status changed to ${r.to.replace(/_/g, " ")}.`;
  }, ["/masterdata/equipment"]);
}
export async function requestOverrideAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    await requestEquipmentOverride(ctx, { equipmentId: id(fd, "equipmentId"), reason: str(fd, "reason") ?? "", workReference: opt(fd, "workReference"), validHours: Number(str(fd, "validHours") ?? 8) });
    return "Override requested. A site manager and QA must both approve it.";
  }, ["/masterdata/equipment"]);
}
export async function decideOverrideAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => DECISION_MSG(await decideEquipmentOverride(ctx, decisionInput(fd))), ["/masterdata/equipment"]);
}
