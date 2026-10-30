"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { coSign } from "@/lib/auth/co-sign";
import { toActionState, type ActionState } from "@/lib/errors";
import { batchSiteId, finishBatch, type FinishPackaging, type FinishReject } from "@/modules/production";
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
    const packaging: FinishPackaging[] = materials.map((m) => ({ materialId: m, damaged: str(fd, `pkg-${m}-damaged`) || "0", leftOver: str(fd, `pkg-${m}-leftOver`) || "0", used: str(fd, `pkg-${m}-used`) || null }));
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
