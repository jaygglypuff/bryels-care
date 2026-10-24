"use server";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import {
  IMPORT_STATUS_LABELS,
  approveImport,
  decideRow,
  getImportJob,
  postImport,
  rejectImport,
  returnImport,
  saveJobMapping,
  startValidation,
  submitImport,
  verifyLegacyDocument,
  voidImport,
  type ImportJobStatus,
  type MappingInput,
} from "@/modules/imports";

/** Thin adapters over the imports service (in-place actions, ADR-043): every rule is checked in the service. */
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function statusMessage(jobId: string, done: string): Promise<string> {
  const ctx = await requireContext();
  const d = await getImportJob(ctx, jobId);
  const s = d.job.status as ImportJobStatus;
  if (s === "validating" || s === "posting") return `${done} The file is large, so it runs in the background; you get a notification when it is finished.`;
  return `${done} Status: ${IMPORT_STATUS_LABELS[s].toLowerCase()}.`;
}

async function run(fn: () => Promise<string>): Promise<ActionState> {
  try {
    const message = await fn();
    refreshCurrentPage();
    return { ok: true, message };
  } catch (e) {
    return toActionState(e);
  }
}

export async function saveMappingAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const jobId = str(f, "jobId");
  const columns: Record<string, string | null> = {};
  for (const [k, v] of f.entries()) if (k.startsWith("col_")) columns[k.slice(4)] = String(v) || null;
  const profileCode = str(f, "profileCode");
  const input: MappingInput = {
    columns,
    dateFormat: str(f, "dateFormat") as MappingInput["dateFormat"],
    decimalSeparator: str(f, "decimalSeparator") as MappingInput["decimalSeparator"],
    thousandsSeparator: str(f, "thousandsSeparator") as MappingInput["thousandsSeparator"],
    profile: profileCode ? { code: profileCode, name: str(f, "profileName") } : null,
  };
  return run(async () => {
    await saveJobMapping(ctx, jobId, input);
    return profileCode ? `Mapping saved, also as profile ${profileCode.toUpperCase()}. Validate the file next.` : "Mapping saved. Validate the file next.";
  });
}

export async function validateAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const jobId = str(f, "jobId");
  return run(async () => {
    await startValidation(ctx, jobId);
    return statusMessage(jobId, "Validation started.");
  });
}

export async function decideAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return run(async () => {
    const r = await decideRow(ctx, str(f, "jobId"), { rowId: str(f, "rowId"), decision: str(f, "decision") as "new_record", note: str(f, "note") || null });
    return `Decision saved: the row is now ${r.result.replace("_", " ")}.`;
  });
}

export async function submitAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return run(async () => {
    await submitImport(ctx, str(f, "jobId"));
    return "Submitted. A different person with import approval must approve it.";
  });
}

export async function approveAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return run(async () => {
    await approveImport(ctx, str(f, "jobId"), str(f, "note") || null);
    return "Approved. It can be posted now.";
  });
}

export async function returnAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return run(async () => {
    await returnImport(ctx, str(f, "jobId"), str(f, "reason"));
    return "Returned for changes.";
  });
}

export async function rejectAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return run(async () => {
    await rejectImport(ctx, str(f, "jobId"), str(f, "reason"));
    return "Import closed without posting.";
  });
}

export async function postAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const jobId = str(f, "jobId");
  return run(async () => {
    await postImport(ctx, jobId);
    return statusMessage(jobId, "Posting started.");
  });
}

export async function voidAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return run(async () => {
    const r = await voidImport(ctx, str(f, "jobId"), str(f, "reason"));
    return `Import voided${"reversedLines" in r ? `: ${r.reversedLines} opening lines reversed` : ""}.`;
  });
}

export async function verifyLegacyAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return run(async () => {
    await verifyLegacyDocument(ctx, str(f, "documentId"), str(f, "note") || null);
    return "Index verified against the scan.";
  });
}
