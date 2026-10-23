import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { EXPIRY_WARN_DAYS, LOT_STATUSES, getCurrentSiteLocation, listLots, lotKpis } from "@/modules/inventory/lots";
import { Card, EmptyState, Input, Kpi, LinkButton, PageHeader, Select, Table, Td, buttonClass } from "@/ui/core";
import { Banner, StatusChip } from "@/ui/status";
import { Expiry, fmtLotQty } from "@/ui/inventory/bits";
import { Forbidden } from "../forbidden";

export const metadata = { title: "Lots & stock" };

const STATUS_LABEL: Record<string, string> = {
  quarantine: "Quarantined",
  released: "Released",
  on_hold: "QA Hold",
  rejected: "Rejected",
  expired: "Expired (status or date)",
  recalled: "Recalled",
  expiring: `Expiring ≤ ${EXPIRY_WARN_DAYS} days`,
};

type SP = { q?: string; kind?: string; status?: string; empty?: string; loc?: string };

export default async function LotsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="lots and stock" />;
  const sp = await searchParams;
  const kind = sp.kind === "material" || sp.kind === "product" ? sp.kind : undefined;
  const includeEmpty = sp.empty === "1";
  const [lots, kpis, loc] = await Promise.all([
    listLots(ctx, { q: sp.q, kind, status: sp.status, includeEmpty, locationId: sp.loc }),
    lotKpis(ctx),
    getCurrentSiteLocation(ctx, sp.loc),
  ]);
  const filtered = !!(sp.q || kind || sp.status || sp.loc);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Lots & stock"
        subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name} · every lot of material and finished goods with its quality status`}
        actions={
          <>
            <LinkButton href="/inventory/scan" variant="secondary">Scan / look up</LinkButton>
            {ctx.can("inventory.receipt.post") && <LinkButton href="/inventory/receive" variant="cta">Receive materials</LinkButton>}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Quarantined" value={kpis.quarantined} hint="Awaiting QA release" tone={kpis.quarantined ? "warn" : "neutral"} href="/inventory?status=quarantine" />
        <Kpi label="On hold" value={kpis.onHold} hint="QA hold; not usable" tone={kpis.onHold ? "warn" : "neutral"} href="/inventory?status=on_hold" />
        <Kpi label={`Expiring ≤ ${EXPIRY_WARN_DAYS} d`} value={kpis.expiring} hint="Use first (FEFO)" tone={kpis.expiring ? "warn" : "good"} href="/inventory?status=expiring" />
        <Kpi label="Expired" value={kpis.expired} hint="Blocked from use" tone={kpis.expired ? "bad" : "good"} href="/inventory?status=expired" />
      </div>

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto_auto] lg:items-end" role="search">
          {sp.loc && <input type="hidden" name="loc" value={sp.loc} />}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="q" className="text-[13px] font-medium">Item or lot</label>
            <Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Lot number, material, SKU, supplier lot…" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="kind" className="text-[13px] font-medium">Kind</label>
            <Select id="kind" name="kind" defaultValue={kind ?? ""}>
              <option value="">All</option>
              <option value="material">Materials</option>
              <option value="product">Finished goods</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="status" className="text-[13px] font-medium">Quality status</label>
            <Select id="status" name="status" defaultValue={sp.status ?? ""}>
              <option value="">All</option>
              {[...LOT_STATUSES, "expiring"].map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-[13px]">
            <input type="checkbox" name="empty" value="1" defaultChecked={includeEmpty} className="size-4 accent-[var(--primary)]" />
            Include empty lots
          </label>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass("primary")}>Apply</button>
            {filtered && <Link href="/inventory" className={buttonClass("ghost")}>Clear</Link>}
          </div>
        </form>
      </Card>

      {loc && (
        <Banner tone="info" title={`Showing lots stored at ${loc.code} · ${loc.name}`} action={<Link href="/inventory" className={buttonClass("secondary", "sm")}>Show all</Link>} />
      )}

      <Card>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold">{lots.length} {lots.length === 1 ? "lot" : "lots"}</h2>
          <p className="text-[12px] text-muted">FEFO order: earliest expiry first, so the lot to use next is at the top.</p>
        </div>
        {lots.length === 0 ? (
          <EmptyState
            title={filtered ? "No lots match these filters" : "No stock at this site yet"}
            action={filtered ? <LinkButton href="/inventory" variant="secondary">Clear filters</LinkButton> : ctx.can("inventory.receipt.post") ? <LinkButton href="/inventory/receive">Receive materials</LinkButton> : undefined}
          >
            {filtered ? "Try a different item, kind or status, or include empty lots." : "Received materials and produced finished goods appear here."}
          </EmptyState>
        ) : (
          <>
            {/* Phone: cards */}
            <ul className="space-y-2 sm:hidden">
              {lots.map((l) => (
                <li key={l.id}>
                  <Link href={`/inventory/${l.id}`} className="block rounded-[12px] border border-line p-3 active:bg-surface-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-[15px] font-semibold text-primary-text">{l.lotNumber}</span>
                      <StatusChip status={l.qualityStatus} />
                    </div>
                    <p className="mt-1 text-[14px]">{l.itemName} <span className="text-muted">· {l.itemCode}</span></p>
                    <div className="mt-2 flex flex-wrap items-end justify-between gap-2 text-[13px]">
                      <Expiry date={l.expiresOn} warnDays={EXPIRY_WARN_DAYS} compact />
                      <span className="font-semibold tabular">{fmtLotQty(l.onHand, l.baseUom)}</span>
                    </div>
                    <p className="mt-1 text-[12px] text-muted">{l.locationCodes ?? "No stock"}{l.supplierLotNumber ? ` · supplier lot ${l.supplierLotNumber}` : ""}</p>
                  </Link>
                </li>
              ))}
            </ul>
            {/* Tablet and desktop: table */}
            <Table className="hidden sm:block" head={["Lot", "Item", "Supplier lot", "Expiry", "On hand", "Locations", "Status"]}>
              {lots.map((l) => (
                <tr key={l.id} className="hover:bg-surface-2">
                  <Td>
                    <Link href={`/inventory/${l.id}`} className="font-mono font-semibold text-primary-text hover:underline">{l.lotNumber}</Link>
                    <div className="text-[11px] text-muted">{l.itemKind === "product" ? "Finished goods" : "Material"}</div>
                  </Td>
                  <Td>
                    {l.itemName}
                    <div className="text-[12px] text-muted">{l.itemCode}</div>
                  </Td>
                  <Td>{l.supplierLotNumber ?? <span className="text-muted">—</span>}</Td>
                  <Td><Expiry date={l.expiresOn} warnDays={EXPIRY_WARN_DAYS} /></Td>
                  <Td className="whitespace-nowrap text-right font-medium">{fmtLotQty(l.onHand, l.baseUom)}</Td>
                  <Td className="text-[12px]">{l.locationCodes ?? <span className="text-muted">None</span>}</Td>
                  <Td><StatusChip status={l.qualityStatus} /></Td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Card>
    </div>
  );
}
