"use server";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { decideQualityCheck, type QualityCheckDecision } from "@/modules/quality";
import { registerAppHooks } from "@/modules/wiring";

// Quality ↔ production hooks (idempotent; also registered at server start): the pass closes the batch through them.
registerAppHooks();

/**
 * Check quality (ADR-080 §8–9). Thin adapter: the decision is taken with the signed-in person's own
 * session (requireContext); there is no co-signer. Every rule is in src/modules/quality/check-quality.ts.
 */
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

export async function decideQualityCheckAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const decision = str(fd, "decision") as QualityCheckDecision;
    const r = await decideQualityCheck(ctx, {
      batchId: str(fd, "batchId"),
      decision,
      recordReviewed: fd.get("recordReviewed") === "yes",
      reason: str(fd, "reason") || null,
      checkAgainOn: str(fd, "checkAgainOn") || null,
      overrideReason: str(fd, "overrideReason") || null,
      idempotencyKey: str(fd, "idempotencyKey"),
    });
    refreshCurrentPage();
    const message =
      r.decision === "pass"
        ? `Batch ${r.batchNumber} passed. ${r.closed ? "The batch is closed and the batch record is made." : `The batch stays open: ${r.closeBlockers.join(" ")}`}${r.notified ? " The customer order was told." : ""}`
        : r.decision === "not_yet"
          ? `Batch ${r.batchNumber} is on hold. Check again on ${r.checkAgainOn}.`
          : `Batch ${r.batchNumber} failed. The stock was moved to the rejected area.`;
    return { ok: true, message };
  } catch (e) {
    return toActionState(e);
  }
}
