"use server";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { decideQualityCheck, recordInspectionResults, type QualityCheckDecision } from "@/modules/quality";
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

/**
 * Saves every test result typed on the check page with one button (consultant review). Thin adapter:
 * a test counts as filled when it has a value or a yes/no; all filled tests go to recordInspectionResults
 * in one transaction (same rules as one result at a time; one wrong entry saves nothing).
 */
export async function saveTestResultsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const ids = str(fd, "testIds").split(",").filter(Boolean);
    const results = ids
      .map((id) => {
        const conforms = str(fd, `r-${id}-conforms`);
        return { planTestId: id, value: str(fd, `r-${id}-value`) || null, uom: str(fd, `r-${id}-uom`) || null, conforms: conforms === "yes" ? true : conforms === "no" ? false : null };
      })
      .filter((r) => r.value !== null || r.conforms !== null);
    if (results.length === 0) return { ok: false, message: "Enter at least one result, then save." };
    const r = await recordInspectionResults(ctx, { inspectionId: str(fd, "inspectionId"), results, idempotencyKey: str(fd, "idempotencyKey") || null });
    refreshCurrentPage();
    const n = r.saved.length;
    return { ok: true, message: `${n} ${n === 1 ? "result" : "results"} saved.${r.failed.length ? ` Not OK: ${r.failed.join(", ")}.` : ""}` };
  } catch (e) {
    return toActionState(e);
  }
}
