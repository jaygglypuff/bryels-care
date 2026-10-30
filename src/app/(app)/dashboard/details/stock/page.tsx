import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { listStockAlerts, stockAlertCounts, type StockAlertLot } from "@/modules/analytics";
import { fmtStock } from "@/modules/inventory";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Expiry, LotStatusChip, fmtLotQty } from "@/ui/inventory/bits";
import { Forbidden } from "../../../forbidden";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stock alerts" };

/**
 * The list behind Home's "Stock alerts" card and its "Needs your attention" lines. Same function
 * (`listStockAlerts`) as the card, so the numbers on Home are the row counts here (one source per label).
 */
export default async function StockAlertsPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("analytics.dashboard.view")) return <Forbidden what="stock alerts" />;
  const { scope } = await searchParams;
  const all = scope === "all" && ctx.allowedSites.length > 1 && ctx.can("analytics.owner_dashboard.view");
  let a;
  try {
    a = await listStockAlerts(ctx, { all });
  } catch (e) {
    if (e instanceof DomainError && e.code === "forbidden") return <Forbidden what="stock alerts" />;
    throw e;
  }
  const n = stockAlertCounts(a);
  const showSite = a.scope.all;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock alerts"
        subtitle={`${a.scope.label} · ${n.total} ${n.total === 1 ? "alert" : "alerts"} · a lot on hold that also expires soon is listed in both groups`}
        actions={<LinkButton href={all ? "/dashboard?scope=all" : "/dashboard"} variant="secondary">Back to Home</LinkButton>}
      />
      {a.lowStock && (
        <Card>
          <div id="low" className="scroll-mt-24">
            <CardTitle>Below the minimum stock ({a.lowStock.length})</CardTitle>
          </div>
          {a.lowStock.length === 0 ? (
            <EmptyState title="Nothing is below its minimum">Usable stock of every item with a minimum is at or above it.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {a.lowStock.map((r) => (
                <li key={`${r.kind}-${r.id}-${r.siteId}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2.5 text-[14px]">
                  <span className="min-w-0">
                    <span className="font-medium text-fg">{r.name}</span>
                    <span className="block text-[12px] text-muted">
                      {r.kind === "material" ? "Material" : "Product"} {r.code}
                      {showSite ? ` · ${r.siteCode}` : ""}
                    </span>
                  </span>
                  <span className="text-right tabular">
                    {fmtStock(r.onHand, r.unit)} usable of {fmtStock(r.minimum, r.unit)} minimum
                    {Number(r.waitingForQuality) > 0 && <span className="block text-[12px] text-muted">{fmtStock(r.waitingForQuality, r.unit)} waiting for quality</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {a.lowStock.length > 0 && ctx.can("procurement.reorder_suggestion.view") && (
            <p className="mt-2 text-[13px]">
              <Link href="/procurement/reorder" className="font-medium text-primary-text hover:underline">Open reorder suggestions</Link>
            </p>
          )}
        </Card>
      )}
      {a.expiring && <LotGroup id="expiring" title="Expiring within 30 days" rows={a.expiring} showSite={showSite} empty="No lot in stock expires in the next 30 days." />}
      {a.onHold && <LotGroup id="on-hold" title="On quality hold" rows={a.onHold} showSite={showSite} empty="No lot in stock is on quality hold." />}
      {!a.lowStock && !a.expiring && !a.onHold && <Forbidden what="stock" />}
    </div>
  );
}

function LotGroup({ id, title, rows, showSite, empty }: { id: string; title: string; rows: StockAlertLot[]; showSite: boolean; empty: string }) {
  return (
    <Card>
      <div id={id} className="scroll-mt-24">
        <CardTitle>
          {title} ({rows.length})
        </CardTitle>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing here">{empty}</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 text-[14px]">
              <span className="min-w-0">
                <span className="font-medium text-fg">{l.itemName}</span>
                <span className="block text-[12px] text-muted">
                  Lot{" "}
                  <Link href={`/inventory/${l.id}`} className="font-mono text-primary-text hover:underline">
                    {l.lotNumber}
                  </Link>
                  {showSite ? ` · ${l.siteCode}` : ""} · {fmtLotQty(l.onHand, l.uom)}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2 text-[13px]">
                <Expiry date={l.expiresOn} />
                <LotStatusChip status={l.qualityStatus} expiresOn={l.expiresOn} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
