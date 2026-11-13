"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { coSign } from "@/lib/auth/co-sign";
import { toActionState, type ActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { askFinishCheck, batchSiteId, finishBatch, withdrawFinishCheck, type FinishPackaging, type FinishReject } from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";

// Execution ↔ QA hooks (idempotent; also registered at server start): Finish opens problem reports through them.
registerAppHooks();

/**
 * Finish batch (ADR-080 §6, V2-6). Thin adapter: reads the form, builds the checker's co-signature
 * when the routing asks for one (the checker picks their name; password only when the setting asks),
 * calls finishBatch and goes back to the order. Every rule is in src/modules/production/finish.ts.
 */
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

export async function finishBatchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let back: string;
  try {
    const ctx = await requireContext();
    const batchId = str(fd, "batchId");
    const changed = str(fd, "changeCounts") === "yes" || str(fd, "countsFromLog") !== "yes";
    const types = str(fd, "rejectTypes").split("|").filter(Boolean);
    const rejects: FinishReject[] = types.map((type, i) => ({ type, qty: str(fd, `reject-${i}`) || "0" })).filter((r) => r.qty !== "0");
    const materials = str(fd, "materialIds").split(",").filter(Boolean);
    // Round 5 B2: empty stays empty (the server refuses it); "All used, none broken" sends 0 and 0 on purpose.
    const packaging: FinishPackaging[] = materials.map((m) => ({ materialId: m, damaged: str(fd, `pkg-${m}-damaged`), leftOver: str(fd, `pkg-${m}-leftOver`), used: str(fd, `pkg-${m}-used`) || null }));
    // ADR-133: "Send the counts to be checked" — the checker confirms on their own phone; nothing is posted now.
    if (str(fd, "checkMode") === "phone") {
      const sent = await askFinishCheck(ctx, {
        batchId,
        goodUnits: changed ? str(fd, "goodUnits") || null : null,
        rejects: changed ? rejects : null,
        rejectsWrapped: str(fd, "rejectsWrapped") || null,
        samplesKept: str(fd, "samplesKept") || null,
        packaging,
        locationRef: str(fd, "locationRef") || null,
        problemReason: str(fd, "problemReason") || null,
        idempotencyKey: str(fd, "idempotencyKey"),
      });
      refreshCurrentPage();
      return { ok: true, message: `Sent. Batch ${sent.batchNumber} goes to QA when the second person says "Looks right".` };
    }
    const checkerId = str(fd, "checkerId");
    const checker = checkerId
      ? await coSign(ctx, { userId: checkerId, password: str(fd, "checkerPassword"), role: "checker", permission: "production.process_step_record.approve", siteId: await batchSiteId(ctx, batchId) })
      : null;
    const r = await finishBatch(
      ctx,
      {
        batchId,
        goodUnits: changed ? str(fd, "goodUnits") || null : null,
        rejects: changed ? rejects : null,
        rejectsWrapped: str(fd, "rejectsWrapped") || null,
        samplesKept: str(fd, "samplesKept") || null,
        packaging,
        locationRef: str(fd, "locationRef") || null,
        problemReason: str(fd, "problemReason") || null,
        idempotencyKey: str(fd, "idempotencyKey"),
      },
      { checker },
    );
    const orderId = str(fd, "orderId");
    back = orderId ? `/production/orders/${orderId}?finished=${encodeURIComponent(r.batchNumber)}` : `/production/${batchId}`;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/production");
  redirect(back);
}

/** ADR-133: take the counts back while they wait for the check (to change them). */
export async function withdrawFinishCheckAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await withdrawFinishCheck(ctx, { batchId: str(fd, "batchId") });
    refreshCurrentPage();
    return { ok: true, message: "Taken back. Change the counts and send them again." };
  } catch (e) {
    return toActionState(e);
  }
}
