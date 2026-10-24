"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { DomainError, type ActionState, toActionState } from "@/lib/errors";
import { approveNumberingRuleVersion, rejectNumberingRuleVersion, submitNumberingRuleVersion } from "@/modules/governance";

/** Thin adapters over the governance numbering service (restricted; a second administrator approves). */
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function withField(e: unknown): ActionState {
  const s = toActionState(e);
  if (e instanceof DomainError && typeof e.details?.field === "string" && s) return { ...s, fieldErrors: { ...(s.fieldErrors ?? {}), [e.details.field]: e.message } };
  return s;
}

export async function submitNumberingAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    const v = await submitNumberingRuleVersion(
      ctx,
      {
        documentType: str(f, "documentType"),
        prefix: str(f, "prefix"),
        pattern: str(f, "pattern"),
        resetPeriod: str(f, "resetPeriod") as "yearly",
        sequenceWidth: Number(str(f, "sequenceWidth")),
        isGapless: f.get("isGapless") === "on",
        effectiveFrom: str(f, "effectiveFrom"),
        changeSummary: str(f, "changeSummary"),
      },
      String(f.get("password") ?? ""),
    );
    revalidatePath("/admin/numbering");
    return { ok: true, message: `Version ${v.versionNo} submitted. A different administrator must approve it.` };
  } catch (e) {
    return withField(e);
  }
}

export async function approveNumberingAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    const v = await approveNumberingRuleVersion(ctx, str(f, "id"), String(f.get("password") ?? ""));
    revalidatePath("/admin/numbering");
    return { ok: true, message: `Version ${v.versionNo} approved; numbers issued from ${v.effectiveFrom} use it.` };
  } catch (e) {
    return withField(e);
  }
}

export async function rejectNumberingAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    await rejectNumberingRuleVersion(ctx, str(f, "id"), str(f, "reason"));
    revalidatePath("/admin/numbering");
    return { ok: true, message: "Version closed without changing the numbering." };
  } catch (e) {
    return withField(e);
  }
}
