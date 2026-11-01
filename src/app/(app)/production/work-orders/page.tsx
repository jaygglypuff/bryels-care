import { redirect } from "next/navigation";

/**
 * Superseded (one path for production work, 2026-10-31; ADR-080 §7.1 "work orders pages: hide"): the
 * production orders list is /production/orders. Kept as a server redirect so bookmarks and old links
 * work. One order (/production/work-orders/<id>) also redirects to /production/orders/<id> (ADR-105).
 */
export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const sp = await searchParams;
  const q = sp.q ? `?q=${encodeURIComponent(sp.q)}` : "";
  redirect(`/production/orders${q}`);
}
