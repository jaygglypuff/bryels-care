"use server";
import { requireContext } from "@/lib/auth/context";
import { DomainError, type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { acknowledgeActionItem, saveNotificationRule } from "@/modules/action-centre";

/** Thin adapters over the action-centre service (US-5-06, US-5-07). */
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function withField(e: unknown): ActionState {
  const s = toActionState(e);
  if (e instanceof DomainError && typeof e.details?.field === "string" && s) return { ...s, fieldErrors: { ...(s.fieldErrors ?? {}), [e.details.field]: e.message } };
  return s;
}

export async function acknowledgeItemAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    await acknowledgeActionItem(ctx, str(f, "id"), str(f, "note") || null);
    refreshCurrentPage();
    return { ok: true, message: "Acknowledged. The item clears when its record is resolved." };
  } catch (e) {
    return withField(e);
  }
}

export async function saveNotificationRuleAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const hours = str(f, "escalateAfterHours");
  const esc = f.getAll("escalationRoleCodes").map(String).filter(Boolean);
  try {
    await saveNotificationRule(
      ctx,
      {
        itemKind: str(f, "itemKind"),
        siteId: str(f, "siteId") || null,
        name: str(f, "name"),
        severity: str(f, "severity"),
        ownerRoleCodes: f.getAll("ownerRoleCodes").map(String).filter(Boolean),
        escalateAfterHours: hours ? Number(hours) : null,
        escalationRoleCodes: esc,
        emailOnOpen: f.get("emailOnOpen") === "on",
        emailOnEscalation: f.get("emailOnEscalation") === "on",
        isActive: f.get("isActive") === "on",
      },
      { id: str(f, "id") || null, expectedVersion: str(f, "version") ? Number(str(f, "version")) : null, reason: str(f, "reason") },
    );
    refreshCurrentPage();
    return { ok: true, message: "Rule saved. It applies from the next refresh of the action centre." };
  } catch (e) {
    return withField(e);
  }
}
