import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getCount, type CountDetail } from "@/modules/inventory/counts";
import { LinkButton } from "@/ui/core";
import { PrintButton } from "@/app/print/lot-label/print-button";
import { Forbidden } from "../../../../forbidden";

export const metadata = { title: "Count sheet" };

/** Blind count sheet (US-2-17): locations and items without quantities, a blank column to write in. */
export default async function CountSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.stock_count.view")) return <Forbidden what="stock counts" />;
  const { id } = await params;
  let c: CountDetail;
  try {
    c = await getCount(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4 bg-white p-4 text-black">
      <style>{`@media print { nav, header, aside, .no-print { display: none !important; } body { background: #fff; } }`}</style>
      <div className="no-print flex flex-wrap justify-between gap-2">
        <LinkButton href={`/inventory/counts/${c.id}`} variant="secondary">Back</LinkButton>
        <PrintButton label="Print count sheet" />
      </div>
      <header>
        <h1 className="text-[20px] font-semibold">Count sheet {c.countNumber} {c.isBlind ? "(blind)" : ""}</h1>
        <p className="text-[12px]">{ctx.allowedSites.find((s) => s.id === c.siteId)?.name} · {c.countKind} count · scheduled {fmtDate(c.scheduledFor)} · printed {fmtDateTime(new Date())}</p>
        <p className="text-[12px]">Count every item at each location. Write items not on this list on the blank lines. Do not write expected quantities.</p>
      </header>
      {c.scope.map((s) => {
        const lines = c.lines.filter((l) => l.locationId === s.id);
        return (
          <section key={s.id} className="break-inside-avoid">
            <h2 className="mt-3 border-b border-black text-[15px] font-semibold">{s.code} · {s.name}</h2>
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr><th className="border border-black px-2 py-1 text-left">Lot</th><th className="border border-black px-2 py-1 text-left">Item</th><th className="w-28 border border-black px-2 py-1 text-left">Counted</th><th className="w-24 border border-black px-2 py-1 text-left">Initials</th></tr>
              </thead>
              <tbody>
                {lines.filter((l) => !l.isUnexpected).map((l) => (
                  <tr key={l.id}><td className="border border-black px-2 py-2 font-mono">{l.lotNumber}</td><td className="border border-black px-2 py-2">{l.itemName}</td><td className="border border-black" /><td className="border border-black" /></tr>
                ))}
                {[0, 1, 2].map((i) => (
                  <tr key={`blank-${i}`}><td className="border border-black px-2 py-3" /><td className="border border-black" /><td className="border border-black" /><td className="border border-black" /></tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      {c.lines.length === 0 && <p className="text-[13px]">Lines are listed once the count is released.</p>}
    </div>
  );
}
