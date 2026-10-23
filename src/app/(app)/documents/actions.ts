"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError, toActionState, type ActionState } from "@/lib/errors";
import { reprintDocument, requestPdfDownload, voidDocument } from "@/modules/documents";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
function withField(e: unknown): ActionState {
  const s = toActionState(e);
  if (e instanceof DomainError && typeof e.details?.field === "string" && s) return { ...s, fieldErrors: { [e.details.field]: e.message } };
  return s;
}

export async function reprintDocumentAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const r = await reprintDocument(ctx, str(f, "id"), { reasonCode: str(f, "reasonCode"), note: str(f, "note") || null, idempotencyKey: str(f, "idempotencyKey") });
    id = r.id;
  } catch (e) {
    return withField(e);
  }
  redirect(`/documents/${id}?reprinted=1`);
}

export async function voidDocumentAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await voidDocument(ctx, str(f, "id"), str(f, "reason"));
  } catch (e) {
    return withField(e);
  }
  revalidatePath(`/documents/${str(f, "id")}`);
  return { ok: true, message: "Document voided. The record and its content are kept." };
}

/** Always answers with the setup-required state until PDF files exist; never a fake file. */
export async function downloadPdfAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await requestPdfDownload(ctx, str(f, "id"));
    return { ok: false, message: "Download is not available." };
  } catch (e) {
    return toActionState(e);
  }
}
