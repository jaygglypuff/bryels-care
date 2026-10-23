import { redirect } from "next/navigation";

/**
 * Lot labels are label jobs (US-2-12): every print is recorded, and a second copy is a reprint
 * with a reason. This legacy URL (lot page "Print label") opens the label request.
 */
export default async function LotLabelPage({ params }: { params: Promise<{ lotId: string }> }) {
  const { lotId } = await params;
  redirect(`/labels/new?entityType=inventory_lot&entityId=${encodeURIComponent(lotId)}`);
}
