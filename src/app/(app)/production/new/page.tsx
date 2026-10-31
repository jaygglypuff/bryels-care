import { redirect } from "next/navigation";

/**
 * Superseded (ADR-080 §7.1, one path 2026-10-31): batches are made by approving a production order
 * (approval creates the batches); "Plan the batch" of an approved order is on its full order record.
 * Kept as a server redirect so bookmarks and old links work.
 */
export default function NewBatchPage() {
  redirect("/production/orders/new");
}
