"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { DomainError, type ActionState, toActionState } from "@/lib/errors";
import { approveSettingChange, cancelSettingChange, changeSetting, rejectSettingChange } from "@/modules/governance";

/** Thin adapters: parse the form, call the governance service, map the outcome (no rules here). */
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function withField(e: unknown): ActionState {
  const s = toActionState(e);
  if (e instanceof DomainError && typeof e.details?.field === "string" && s) return { ...s, fieldErrors: { ...(s.fieldErrors ?? {}), [e.details.field]: e.message } };
  return s;
}

/** Form value → typed value per the registry kind; `reset` removes the stored row. */
function parseValue(kind: string, raw: string): unknown {
  if (kind === "number") {
    if (raw === "" || !Number.isFinite(Number(raw))) throw new DomainError("validation", "Enter a number.", { field: "value" });
    return Number(raw);
  }
  if (kind === "boolean") return raw === "true";
  if (kind === "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new DomainError("validation", "Enter valid JSON (as shown in the current value).", { field: "value" });
  }
}

export async function changeSettingAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    // Not named "reset": a control with that name shadows HTMLFormElement.reset(), which React calls after the action.
    const reset = f.get("clearValue") === "on";
    const value = reset ? null : parseValue(str(f, "kind"), String(f.get("value") ?? ""));
    const r = await changeSetting(ctx, { key: str(f, "key"), siteId: str(f, "siteId") || null, value, reason: str(f, "reason") }, String(f.get("password") ?? ""));
    revalidatePath("/admin/settings");
    return { ok: true, message: r.status === "submitted" ? "Submitted for approval. A second administrator or the owner must approve it before it applies." : `Saved. The change applies from the next request.${r.status === "applied" && r.auditEventId ? ` Audit event ${r.auditEventId}.` : ""}` };
  } catch (e) {
    return withField(e);
  }
}

export async function approveSettingChangeAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    const r = await approveSettingChange(ctx, str(f, "id"), { note: str(f, "note") || null, password: String(f.get("password") ?? "") });
    revalidatePath("/admin/settings");
    return { ok: true, message: `Approved and applied.${r.auditEventId ? ` Audit event ${r.auditEventId}.` : ""}` };
  } catch (e) {
    return withField(e);
  }
}

export async function rejectSettingChangeAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    await rejectSettingChange(ctx, str(f, "id"), str(f, "reason"));
    revalidatePath("/admin/settings");
    return { ok: true, message: "Rejected. The setting is unchanged." };
  } catch (e) {
    return withField(e);
  }
}

export async function cancelSettingChangeAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    await cancelSettingChange(ctx, str(f, "id"));
    revalidatePath("/admin/settings");
    return { ok: true, message: "Request withdrawn." };
  } catch (e) {
    return withField(e);
  }
}
