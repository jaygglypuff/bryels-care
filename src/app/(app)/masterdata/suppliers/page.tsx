import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Superseded (docs/LEGACY_SCREENS.md): there is one supplier list, Purchasing → "Suppliers we may buy from"
 * (/procurement/suppliers). It has what this list had (search by name, add a supplier, download the CSV,
 * suppliers we stopped using) plus the items QA allows from each supplier. One supplier's contact details
 * are still changed on /masterdata/suppliers/[id], opened from the supplier page. Old links keep working.
 */
export default async function SuppliersRedirect({ searchParams }: { searchParams: Promise<{ q?: string; all?: string; deleted?: string }> }) {
  const sp = await searchParams;
  const p = new URLSearchParams();
  if (sp.q) p.set("q", sp.q);
  if (sp.all === "1") p.set("all", "1");
  if (sp.deleted) p.set("deleted", "1");
  const qs = p.toString();
  redirect(`/procurement/suppliers${qs ? `?${qs}` : ""}`);
}
