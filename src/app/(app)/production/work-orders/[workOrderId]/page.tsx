import { redirect } from "next/navigation";

/**
 * Superseded (UX re-audit 2026-11-01, ADR-105; ADR-102 pattern): the older view of one production order. Everything it
 * offered now lives on the production order page /production/orders/<id>: Approve (which chooses the recipe and steps
 * versions, "resolve revisions", and sets the materials aside), "Plan the batch" / "Plan batch n of N", "Set aside new
 * stock" (was "Reserve again"), cancel, "Change this draft", the versions, people, use-first lots and the order history
 * in words (More details). Kept as a server redirect so bookmarks, stored messages and old links still work
 * (currentHref() in src/lib/record-links.ts already rewrites stored links). Listed in docs/LEGACY_SCREENS.md.
 */
export default async function WorkOrderPage({ params, searchParams }: { params: Promise<{ workOrderId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { workOrderId } = await params;
  const sp = await searchParams;
  // The old "materials" and "batches" tabs have a twin on the order page; the others land on Today.
  const tab = sp.tab === "materials" ? "?tab=materials" : sp.tab === "batches" ? "?tab=output" : "";
  redirect(`/production/orders/${encodeURIComponent(workOrderId)}${tab}`);
}
