"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError, toActionState, type ActionState } from "@/lib/errors";
import {
  approveLabelTemplate,
  approveVersion,
  createDraftVersion,
  createLabelTemplate,
  createStation,
  createTemplate,
  generateTemplateTestPage,
  retireLabelTemplate,
  retireVersion,
  returnVersionToDraft,
  submitVersion,
  updateDraftDefinition,
  updateLabelTemplate,
  updateStation,
} from "@/modules/documents";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
function withField(e: unknown): ActionState {
  const s = toActionState(e);
  if (e instanceof DomainError && typeof e.details?.field === "string" && s) return { ...s, fieldErrors: { [e.details.field]: e.message } };
  return s;
}
async function run(fn: () => Promise<unknown>, ok: string, path: string): Promise<ActionState> {
  try {
    await fn();
  } catch (e) {
    return withField(e);
  }
  revalidatePath(path);
  return { ok: true, message: ok };
}

export async function createTemplateAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const r = await createTemplate(ctx, { code: str(f, "code"), name: str(f, "name"), templateKind: str(f, "templateKind"), pageSize: str(f, "pageSize") || undefined, orientation: str(f, "orientation") || undefined }, { dataset: str(f, "dataset") || undefined });
    id = r.templateId;
  } catch (e) {
    return withField(e);
  }
  redirect(`/admin/templates/${id}`);
}

export async function versionAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const templateId = str(f, "templateId");
  const versionId = str(f, "versionId");
  const path = `/admin/templates/${templateId}`;
  switch (str(f, "op")) {
    case "new_draft":
      return run(() => createDraftVersion(ctx, templateId, str(f, "changeNote") || null), "New draft created from the latest version.", path);
    case "save":
      return run(() => updateDraftDefinition(ctx, versionId, str(f, "definition"), str(f, "changeNote") || null), "Draft saved and validated.", path);
    case "submit":
      return run(() => submitVersion(ctx, versionId), "Submitted for approval. Someone else must approve it.", path);
    case "approve":
      return run(() => approveVersion(ctx, versionId), "Approved. This version is now effective.", path);
    case "return":
      return run(() => returnVersionToDraft(ctx, versionId, str(f, "reason")), "Sent back to draft.", path);
    case "retire":
      return run(() => retireVersion(ctx, versionId, str(f, "reason")), "Version retired.", path);
    default:
      return { ok: false, message: "Unknown action." };
  }
}

export async function testPageAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const r = await generateTemplateTestPage(ctx, str(f, "versionId"), str(f, "idempotencyKey"));
    id = r.id;
  } catch (e) {
    return withField(e);
  }
  redirect(`/documents/${id}`);
}

function labelInput(f: FormData) {
  return {
    code: str(f, "code"),
    name: str(f, "name"),
    documentTemplateId: str(f, "documentTemplateId"),
    appliesTo: str(f, "appliesTo"),
    symbology: str(f, "symbology"),
    copiesDefault: str(f, "copiesDefault"),
    mediaWidthMm: str(f, "mediaWidthMm"),
    mediaHeightMm: str(f, "mediaHeightMm"),
    dpi: str(f, "dpi"),
    fields: f.getAll("fields").map(String),
  };
}

export async function createLabelTemplateAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    id = (await createLabelTemplate(ctx, labelInput(f))).id;
  } catch (e) {
    return withField(e);
  }
  redirect(`/admin/templates/labels/${id}`);
}

export async function updateLabelTemplateAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const id = str(f, "id");
  return run(() => updateLabelTemplate(ctx, id, labelInput(f)), "Saved. The template is back in draft and needs approval before it prints.", `/admin/templates/labels/${id}`);
}

export async function labelTemplateStatusAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const id = str(f, "id");
  if (str(f, "op") === "approve") return run(() => approveLabelTemplate(ctx, id), "Approved for printing.", `/admin/templates/labels/${id}`);
  return run(() => retireLabelTemplate(ctx, id, str(f, "reason")), "Label template retired.", `/admin/templates/labels/${id}`);
}

export async function stationAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const input = { code: str(f, "code"), name: str(f, "name"), printerName: str(f, "printerName"), notes: str(f, "notes") || null, isActive: str(f, "isActive") !== "false" };
  const id = str(f, "id");
  return id
    ? run(() => updateStation(ctx, id, input), "Station saved.", "/admin/templates/stations")
    : run(() => createStation(ctx, input), `Station added at ${ctx.currentSite.code}.`, "/admin/templates/stations");
}
