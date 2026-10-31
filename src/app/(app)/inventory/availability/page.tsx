import Link from "next/link";
import { ChevronDown, Search } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDate } from "@/lib/qty";
import { availabilityRows, availabilityTotals, manilaToday, type AvailabilityRow } from "@/modules/inventory";
import { EmptyState, Input, LinkButton, PageHeader, buttonClass } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { FilterTabs } from "@/ui/plain-list";
import { LotStatusChip, fmtLotQty } from "@/ui/inventory/bits";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Can we deliver?" };

type Search = { asOf?: string; q?: string; itemKind?: string };

/** One item with its lots (rows are lot × shelf), summed in decimals (never floating point). */
function byItem(rows: AvailabilityRow[]) {
  const m = new Map<string, { name: string; code: string; uom: string; rows: AvailabilityRow[] }>();
  for (const r of rows) {
    const k = `${r.itemKind}:${r.itemCode}:${r.baseUom}`;
    const g = m.get(k) ?? { name: r.itemName, code: r.itemCode, uom: r.baseUom, rows: [] };
    g.rows.push(r);
    m.set(k, g);
  }
  return [...m.values()]
    .map((g) => {
      const sum = (f: (r: AvailabilityRow) => string) => g.rows.reduce((a, r) => a.plus(f(r)), D(0));
      const blocked = sum((r) => D(r.quarantined).plus(r.onHold).plus(r.expired).plus(r.recalled).plus(r.rejected).toString());
      return { ...g, onHand: sum((r) => r.onHand), available: sum((r) => r.available), setAside: sum((r) => D(r.allocated).plus(r.reserved).toString()), blocked };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Can we deliver? (stock availability / ATP), grade-5 (ADR-088): one row per item with the amount free to
 * use or sell now in friendly units; tap to see each lot and shelf. Set-aside and blocked stock (waiting for
 * QA, stopped, expired) is never counted as free. Exports in ⋯ More.
 */
export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.balance.view")) return <Forbidden what="what we can deliver" />;
  const sp = await searchParams;
  const asOf = sp.asOf && /^\d{4}-\d{2}-\d{2}$/.test(sp.asOf) ? sp.asOf : manilaToday();
  const itemKind = sp.itemKind === "material" || sp.itemKind === "product" ? sp.itemKind : undefined;
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const rows = await availabilityRows(ctx, { siteId: ctx.currentSiteId, asOf, itemKind, q });
  const totals = availabilityTotals(rows, asOf);
  const items = byItem(rows);
  const blockedAlloc = rows.filter((r) => D(r.allocatedBlocked).gt(0));
  const exportQs = new URLSearchParams({ siteId: ctx.currentSiteId, asOf, ...(itemKind ? { itemKind } : {}), ...(q ? { q } : {}) });
  const link = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    const all = { q, itemKind, asOf: asOf === manilaToday() ? undefined : asOf, ...over };
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    const s = p.toString();
    return `/inventory/availability${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Can we deliver?"
        subtitle={`${ctx.currentSite.name} · ${asOf === manilaToday() ? "today" : `on ${fmtDate(asOf)}`}`}
        actions={
          ctx.can("inventory.balance.export") && rows.length > 0 ? (
            <MoreMenu>
              <div className="flex flex-col gap-2">
                <a className={buttonClass("secondary")} href={`/api/v1/inventory/availability/export?${exportQs}&format=xlsx`}>Download for Excel</a>
                <a className={buttonClass("secondary")} href={`/api/v1/inventory/availability/export?${exportQs}&format=csv`}>Download as CSV</a>
              </div>
            </MoreMenu>
          ) : undefined
        }
      />
      <PageIntro>This screen is for answering “can we deliver?”: how much of each item is free to use or sell now. Stock set aside for orders or waiting for the QA check is not counted.</PageIntro>

      <form className="flex flex-wrap gap-2" role="search">
        {itemKind && <input type="hidden" name="itemKind" value={itemKind} />}
        <div className="relative min-w-0 flex-1 basis-[220px] sm:max-w-[420px]">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <Input id="q" name="q" type="search" defaultValue={q} placeholder="Item name or lot number" aria-label="Search item or lot" className="pl-10" />
        </div>
        <button className={buttonClass("secondary")}>Search</button>
        <div className="w-full">
          <MoreDetails title="Check another day (you can skip this)" open={asOf !== manilaToday()}>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="asOf" className="text-[14px] font-medium">On this day</label>
                <Input id="asOf" name="asOf" type="date" defaultValue={asOf} />
              </div>
              <button className={buttonClass("secondary")}>Show</button>
            </div>
            <p className="text-[13px] text-muted">Stock that expires before that day is not counted.</p>
          </MoreDetails>
        </div>
      </form>
      <FilterTabs
        label="Kind of item"
        active={itemKind ?? ""}
        tabs={[
          ["", "Everything", link({ itemKind: undefined })],
          ["material", "Raw materials", link({ itemKind: "material" })],
          ["product", "Finished goods", link({ itemKind: "product" })],
        ]}
      />

      {blockedAlloc.length > 0 && (
        <Banner tone="warn" title={`${blockedAlloc.length} order${blockedAlloc.length === 1 ? " has" : "s have"} stock set aside that cannot go out`}>
          It is waiting for QA, stopped or expired. Sales must choose other stock, or wait for QA: {blockedAlloc.map((r) => `${r.itemName} (lot ${r.lotNumber})`).join(", ")}.
        </Banner>
      )}

      {items.length === 0 ? (
        <EmptyState title={q || itemKind ? "Nothing matches" : "No stock here yet"} action={q || itemKind ? <LinkButton href="/inventory/availability" variant="secondary">Show everything</LinkButton> : undefined}>
          {q || itemKind ? "Try fewer words or another kind." : `Items show here once stock is received or made at ${ctx.currentSite.name}.`}
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface" aria-label="What we can deliver" data-testid="availability-list">
          {items.map((it) => (
            <li key={`${it.code}:${it.uom}`}>
              <details className="group">
                <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[15px] font-semibold">{it.name}</p>
                    <p className="mt-0.5 text-[13px] text-fg-2">
                      In stock {fmtLotQty(it.onHand.toString(), it.uom)}
                      {it.setAside.gt(0) && ` · set aside ${fmtLotQty(it.setAside.toString(), it.uom)}`}
                      {it.blocked.gt(0) && ` · not usable ${fmtLotQty(it.blocked.toString(), it.uom)}`}
                      <span className="ml-1 font-mono text-[12px] text-muted">· {it.code}</span>
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={it.available.gt(0) ? "font-semibold tabular text-[16px]" : "font-semibold tabular text-[16px] text-[var(--bad-fg)]"}>{fmtLotQty(it.available.toString(), it.uom)}</p>
                    <p className="text-[12px] text-muted">free now</p>
                  </div>
                  <ChevronDown size={18} className="shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <ul className="border-t border-line bg-surface-2/40">
                  {it.rows.map((r) => (
                    <li key={`${r.lotId}:${r.locationId}`}>
                      <Link href={`/inventory/${r.lotId}`} className="flex min-h-[48px] items-center gap-3 px-4 py-2 pl-6 hover:bg-surface-2">
                        <div className="min-w-0 flex-1 text-[13px]">
                          <span className="font-medium">On {r.locationCode}</span> <LotStatusChip status={r.qualityStatus} expiresOn={r.expiresOn} />
                          <span className="block text-fg-2">{r.expiresOn ? `expires ${fmtDate(r.expiresOn)}` : "no expiry"} <span className="font-mono text-[12px] text-muted">· {r.lotNumber}</span></span>
                        </div>
                        <span className="shrink-0 text-right text-[13px] tabular">
                          <strong>{fmtLotQty(r.available, r.baseUom)}</strong>
                          <span className="block text-[12px] text-muted">of {fmtLotQty(r.onHand, r.baseUom)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}

      {totals.length > 0 && (
        <MoreDetails title="How the free amount is worked out">
          {totals.map((t) => (
            <dl key={t.uom} className="grid max-w-[420px] grid-cols-2 gap-x-4 gap-y-1 text-[13px] tabular">
              <dt className="text-muted">In stock</dt><dd className="text-right">{fmtLotQty(t.onHand, t.uom)}</dd>
              <dt className="text-muted">Set aside for orders</dt><dd className="text-right">− {fmtLotQty(D(t.allocated).plus(t.reserved).toString(), t.uom)}</dd>
              <dt className="text-muted">Waiting for QA check</dt><dd className="text-right">− {fmtLotQty(t.quarantined, t.uom)}</dd>
              <dt className="text-muted">Stopped by QA</dt><dd className="text-right">− {fmtLotQty(t.onHold, t.uom)}</dd>
              <dt className="text-muted">Expired</dt><dd className="text-right">− {fmtLotQty(t.expired, t.uom)}</dd>
              <dt className="text-muted">Recalled or rejected</dt><dd className="text-right">− {fmtLotQty(D(t.recalled).plus(t.rejected).toString(), t.uom)}</dd>
              <dt className="font-semibold">Free now</dt><dd className="text-right font-semibold">{fmtLotQty(t.available, t.uom)}</dd>
            </dl>
          ))}
        </MoreDetails>
      )}
    </div>
  );
}
