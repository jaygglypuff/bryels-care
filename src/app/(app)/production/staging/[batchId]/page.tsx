import { redirect } from "next/navigation";

/**
 * Superseded (ADR-115 §1): "Lots and sheets" of a batch is retired. The batch record (/production/<batch>) shows the
 * lots and every lot or material change, and its ⋯ More menu prints the weighing sheet and the batch traveler. Another
 * lot or another material is decided on the weigh card (ADR-104 §1). Kept as a server redirect so old links work.
 */
export default async function StagingBatchRedirect({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  redirect(`/production/${encodeURIComponent(batchId)}`);
}
