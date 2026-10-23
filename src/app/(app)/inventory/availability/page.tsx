import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDate } from "@/lib/qty";
import { availabilityRows, availabilityTotals, manilaToday } from "@/modules/inventory";
import { Card, CardTitle, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, buttonClass } from "@/ui/core";
import { fmtLotQty } from "@/ui/inventory/bits";
import { Banner, StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Stock availability" };

type Search = { asOf?: string; q?: string; itemKind?: string };

export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.balance.view")) return <Forbidden what="stock availability" />;
  const sp = await searchParams;
  const asOf = sp.asOf && /^\d{4}-\d{2}-\d{2}$/.test(sp.asOf) ? sp.asOf : manilaToday();
  const itemKind = sp.itemKind === "material" || sp.itemKind === "product" ? sp.itemKind : undefined;
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const rows = await availabilityRows(ctx, { siteId: ctx.currentSiteId, asOf, itemKind, q });
  const totals = availabilityTotals(rows, asOf);
  const blockedAlloc = rows.filter((r) => D(r.allocatedBlocked).gt(0));
  const exportQs = new URLSearchParams({ siteId: ctx.currentSiteId, asOf, ...(itemKind ? { itemKind } : {}), ...(q ? { q } : {}) });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stock availability"
        subtitle={`${ctx.currentSite.code} · on hand, allocated, blocked and available per lot and location, as of ${fmtDate(asOf)} (expiry is judged on this date).`}
        actions={
          ctx.can("inventory.balance.export") && rows.length > 0 ? (
            <>
              <a className={buttonClass("secondary", "sm")} href={`/api/v1/inventory/availability/export?${exportQs}&format=csv`}>Export CSV</a>
              <a className={buttonClass("secondary", "sm")} href={`/api/v1/inventory/availability/export?${exportQs}&format=xlsx`}>Export XLSX</a>
            </>
          ) : undefined
        }
      />
      <form className="grid gap-3 rounded-[20px] bg-surface p-4 shadow-[var(--shadow-card)] sm:grid-cols-[1fr_180px_180px_auto]" role="search">
        <label className="sr-only" htmlFor="q">Search lot or item</label>
        <Input id="q" name="q" defaultValue={q} placeholder="Lot number, item code or name" />
        <label className="sr-only" htmlFor="itemKind">Item kind</label>
        <Select id="itemKind" name="itemKind" defaultValue={itemKind ?? ""}>
          <option value="">Materials and products</option>
          <option value="material">Materials</option>
          <option value="product">Finished products</option>
        </Select>
        <label className="sr-only" htmlFor="asOf">As of</label>
        <Input id="asOf" name="asOf" type="date" defaultValue={asOf} />
        <button className={buttonClass("primary")}>Apply</button>
      </form>

      {blockedAlloc.length > 0 && (
        <Banner tone="warn" title={`${blockedAlloc.length} allocation(s) sit on blocked stock`}>
          These orders cannot ship from the allocated lots until QA releases them or the order is re-allocated:{" "}
          {blockedAlloc.map((r) => `${r.lotNumber} at ${r.locationCode}`).join(", ")}.
        </Banner>
      )}

      {totals.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {totals.map((t) => (
            <Card key={t.uom}>
              <CardTitle>Totals in {t.uom}</CardTitle>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] tabular">
                <dt className="text-muted">On hand</dt><dd className="text-right">{fmtLotQty(t.onHand, t.uom)}</dd>
                <dt className="text-muted">Allocated</dt><dd className="text-right">− {fmtLotQty(t.allocated, t.uom)}</dd>
                <dt className="text-muted">Quarantined</dt><dd className="text-right">− {fmtLotQty(t.quarantined, t.uom)}</dd>
                <dt className="text-muted">On hold</dt><dd className="text-right">− {fmtLotQty(t.onHold, t.uom)}</dd>
                <dt className="text-muted">Expired</dt><dd className="text-right">− {fmtLotQty(t.expired, t.uom)}</dd>
                <dt className="text-muted">Recalled / rejected</dt><dd className="text-right">− {fmtLotQty(D(t.recalled).plus(t.rejected).toString(), t.uom)}</dd>
                <dt className="font-semibold">Available</dt><dd className="text-right font-semibold">{fmtLotQty(t.available, t.uom)}</dd>
              </dl>
            </Card>
          ))}
        </div>
      )}

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No stock matches" action={q || itemKind ? <LinkButton href="/inventory/availability" variant="secondary">Clear filters</LinkButton> : undefined}>
            Balances appear here once stock is received or produced at {ctx.currentSite.code}.
          </EmptyState>
        ) : (
          <>
            <div className="hidden md:block">
              <Table head={["Lot", "Item", "Status", "Location", "On hand", "Allocated", "Blocked", "Available", ""]}>
                {rows.map((r) => {
                  const blocked = D(r.quarantined).plus(r.onHold).plus(r.expired).plus(r.recalled).plus(r.rejected);
                  return (
                    <tr key={`${r.lotId}:${r.locationId}`} className="hover:bg-surface-2">
                      <Td><Link href={`/inventory/${r.lotId}`} className="font-mono font-semibold text-primary-text hover:underline">{r.lotNumber}</Link><div className="text-[12px] text-muted">{r.expiresOn ? `exp. ${fmtDate(r.expiresOn)}` : "no expiry"}</div></Td>
                      <Td>{r.itemName}<div className="text-[12px] text-muted">{r.itemCode}</div></Td>
                      <Td><StatusChip status={r.bucket === "released" ? "released" : r.bucket} /></Td>
                      <Td className="font-mono text-[12px]">{r.locationCode}</Td>
                      <Td className="text-right">{fmtLotQty(r.onHand, r.baseUom)}</Td>
                      <Td className="text-right">{D(r.allocated).isZero() ? "—" : fmtLotQty(r.allocated, r.baseUom)}</Td>
                      <Td className="text-right">{blocked.isZero() ? "—" : fmtLotQty(blocked.toString(), r.baseUom)}</Td>
                      <Td className="text-right font-semibold">{fmtLotQty(r.available, r.baseUom)}</Td>
                      <Td>{ctx.can("inventory.movement.view") && <Link className="text-[12px] text-primary-text hover:underline" href={`/inventory/stock-card/${r.lotId}?location=${r.locationId}`}>Stock card</Link>}</Td>
                    </tr>
                  );
                })}
              </Table>
            </div>
            <ul className="space-y-3 md:hidden">
              {rows.map((r) => (
                <li key={`${r.lotId}:${r.locationId}`} className="rounded-[16px] border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/inventory/${r.lotId}`} className="font-mono font-semibold text-primary-text">{r.lotNumber}</Link>
                    <StatusChip status={r.bucket} />
                  </div>
                  <p className="mt-1 text-[13px]">{r.itemName} · <span className="font-mono">{r.locationCode}</span></p>
                  <p className="mt-1 text-[13px] tabular">On hand {fmtLotQty(r.onHand, r.baseUom)} · <strong>available {fmtLotQty(r.available, r.baseUom)}</strong></p>
                  {ctx.can("inventory.movement.view") && <Link className="mt-1 inline-block text-[12px] text-primary-text" href={`/inventory/stock-card/${r.lotId}?location=${r.locationId}`}>Stock card</Link>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
