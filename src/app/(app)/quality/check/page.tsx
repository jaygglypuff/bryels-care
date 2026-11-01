import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Superseded (docs/LEGACY_SCREENS.md): "Batches waiting for QA check" listed only finished batches, while the QA
 * queue (/quality) lists the same batches (oldest first, same "Check this batch" next step, failed tests and open
 * problem reports) plus the deliveries waiting for QA check and the lots stopped by QA. One list for QA; this old
 * address keeps working. One batch's check is still /quality/check/[batchId].
 */
export default function WaitingForCheckRedirect() {
  redirect("/quality");
}
