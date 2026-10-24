"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { DomainError, type ActionState, toActionState } from "@/lib/errors";
import { createApprovalRule, removeApprovalRule, updateApprovalRule } from "@/modules/governance";

/** Thin adapters over the governance service (owner-only, restricted, re-authentication). */
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const opt = (f: FormData, k: string) => str(f, k) || null;
const roles = (f: FormData, k: string) => f.getAll(k).map(String).filter(Boolean);

function ruleFromForm(f: FormData) {
  const esc = roles(f, "escalationRoleCodes");
  const hours = str(f, "escalationAfterHours");
  return {
    documentType: str(f, "documentType"),
    siteId: opt(f, "siteId"),
    label: str(f, "label"),
    thresholdBasis: str(f, "thresholdBasis"),
    minValue: opt(f, "minValue"),
    maxValue: opt(f, "maxValue"),
    currency: opt(f, "currency"),
    step: Number(str(f, "step") || "1"),
    requiredCount: Number(str(f, "requiredCount") || "1"),
    requiredRoleCodes: roles(f, "requiredRoleCodes"),
    requiredPermissionCode: opt(f, "requiredPermissionCode"),
    posterMayEqualApprover: f.get("posterMayEqualApprover") === "on",
    escalationRoleCodes: esc.length ? esc : null,
    escalationAfterHours: hours ? Number(hours) : null,
    effectiveFrom: str(f, "effectiveFrom"),
    effectiveTo: opt(f, "effectiveTo"),
    source: opt(f, "source"),
  };
}

function withField(e: unknown): ActionState {
  const s = toActionState(e);
  if (e instanceof DomainError && typeof e.details?.field === "string" && s) return { ...s, fieldErrors: { ...(s.fieldErrors ?? {}), [e.details.field]: e.message } };
  return s;
}

const reauth = (f: FormData) => ({ password: String(f.get("password") ?? ""), reason: str(f, "reason") });

export async function saveApprovalRuleAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    const id = str(f, "id");
    if (id) await updateApprovalRule(ctx, id, ruleFromForm(f), Number(str(f, "version")), reauth(f));
    else await createApprovalRule(ctx, ruleFromForm(f), reauth(f));
    revalidatePath("/admin/approval-rules");
    return { ok: true, message: id ? "Rule updated. New approvals use it from now on." : "Rule added. New approvals use it from now on." };
  } catch (e) {
    return withField(e);
  }
}

export async function removeApprovalRuleAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    await removeApprovalRule(ctx, str(f, "id"), reauth(f));
    revalidatePath("/admin/approval-rules");
    return { ok: true, message: "Rule removed (kept in the history)." };
  } catch (e) {
    return withField(e);
  }
}
