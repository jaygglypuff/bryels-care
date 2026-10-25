"use server";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { type ResolveInput, resolveConflict } from "@/lib/offline/server/conflicts";

/**
 * Conflict resolution (US-7-05): one in-place action for the four choices. The service checks the
 * permission at the conflict's site, the separation from the person who queued it, the note, and
 * that the conflict is still open; a re-apply that fails again leaves it open and says why.
 */
export async function resolveConflictAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    const conflictId = String(fd.get("conflictId") ?? "");
    const note = String(fd.get("note") ?? "");
    const choice = String(fd.get("choice") ?? "");
    let input: ResolveInput;
    if (choice === "reapply") {
      const overrides: Record<string, string> = {};
      for (const [k, v] of fd.entries()) if (k.startsWith("override.") && typeof v === "string") overrides[k.slice("override.".length)] = v;
      input = { conflictId, action: "reapply", note, overrides };
    } else if (choice === "escalate_adjustment") {
      const direction = String(fd.get("direction") ?? "") === "increase" ? "increase" : "decrease";
      input = { conflictId, action: "escalate_adjustment", note, direction, qty: String(fd.get("qty") ?? ""), reasonCode: String(fd.get("reasonCode") ?? "") };
    } else if (choice === "escalate_deviation") {
      input = { conflictId, action: "escalate_deviation", note };
    } else {
      input = { conflictId, action: "discard", note };
    }
    const r = await resolveConflict(ctx, input);
    refreshCurrentPage();
    return { ok: r.ok, message: r.message };
  } catch (e) {
    return toActionState(e);
  }
}
