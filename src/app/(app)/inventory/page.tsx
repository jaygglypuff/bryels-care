import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { EXPIRY_WARN_DAYS, LOT_STATUSES, getCurrentSiteLocation, listLots, lotKpis } from "@/modules/inventory/lots";
import { stockBySection } from "@/modules/inventory/sections";
import { LOCATION_SECTIONS, SECTION_LABELS, isSection } from "@/lib/location-sections";
import { SectionHeading } from "@/ui/inventory/sections";
import { Card, EmptyState, Input, Kpi, LinkButton, PageHeader, Select, Table, Td, buttonClass } from "@/ui/core";
import { Banner, StatusChip } from "@/ui/status";
import { Expiry, fmtLotQty } from "@/ui/inventory/bits";
import { Forbidden } from "../forbidden";

export const metadata = { title: "Lots & stock" };

const STATUS_LABEL: Record<string, string> = {
  quarantine: "Waiting for QA",
  released: "Released",
  on_hold: "On hold",
  rejected: "Rejected",
  expired: "Expired (status or date)",
  recalled: "Recalled",
  expiring: `Expiring ≤ ${EXPIRY_WARN_DAYS} days`,
};

type SP = { q?: string; kind?: string; status?: string; empty?: string; loc?: string; section?: string };

export default async function LotsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="lots and stock" />;
  const sp = await searchParams;
  const kind = sp.kind === "material" || sp.kind === "product" ? sp.kind : undefined;
  const includeEmpty = sp.empty === "1";
  const section = isSection(sp.section) ? sp.section : undefined;
  // S6 (ADR-077): stock is grouped by warehouse section; empty lots (no section) are listed separately on request.
  const [groups, emptyLots, kpis, loc] = await Promise.all([
    stockBySection(ctx, { q: sp.q, kind, status: sp.status, section, locationId: sp.loc }),
    includeEmpty ? listLots(ctx, { q: sp.q, kind, status: sp.status, includeEmpty: true, locationId: sp.loc }).then((r) => r.filter((l) => Number(l.onHand) === 0)) : Promise.resolve([]),
    lotKpis(ctx),
    getCurrentSiteLocation(ctx, sp.loc),
  ]);
  const lotCount = new Set(groups.flatMap((g) => g.rows.map((r) => r.lotId))).size;
  const filtered = !!(sp.q || kind || sp.status || sp.loc || section);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Lots & stock"
        subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name} · every lot of material and finished goods with its quality status`}
        actions={
          <>
            <LinkButton href="/inventory/scan" variant="secondary">Scan / look up</LinkButton>
            {ctx.can("procurement.goods_receipt.create") && <LinkButton href="/inventory/receive" variant="cta">Receive materials</LinkButton>}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Waiting for QA" value={kpis.quarantined} hint="New lots QA has not checked yet" tone={kpis.quarantined ? "warn" : "neutral"} href="/inventory?status=quarantine" />
        <Kpi label="On hold" value={kpis.onHold} hint="Stopped by QA; do not use" tone={kpis.onHold ? "warn" : "neutral"} href="/inventory?status=on_hold" />
        <Kpi label={`Expiring ≤ ${EXPIRY_WARN_DAYS} d`} value={kpis.expiring} hint="Use first (FEFO)" tone={kpis.expiring ? "warn" : "good"} href="/inventory?status=expiring" />
        <Kpi label="Expired" value={kpis.expired} hint="Blocked from use" tone={kpis.expired ? "bad" : "good"} href="/inventory?status=expired" />
      </div>

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_auto_auto] xl:items-end" role="search">
          {sp.loc && <input type="hidden" name="loc" value={sp.loc} />}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="q" className="text-[13px] font-medium">Item or lot</label>
            <Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Lot number, material, SKU, supplier lot…" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="section" className="text-[13px] font-medium">Section</label>
            <Select id="section" name="section" defaultValue={section ?? ""}>
              <option value="">All sections</option>
              {LOCATION_SECTIONS.map((s) => (
                <option key={s} value={s}>{SECTION_LABELS[s]}</option>
              ))}
            </Select>
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

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">
          {lotCount} {lotCount === 1 ? "lot" : "lots"} in {groups.length} {groups.length === 1 ? "section" : "sections"}
        </h2>
        <p className="text-[12px] text-muted">In each section the lot to use next (earliest expiry) is at the top.</p>
      </div>

      {groups.length === 0 && emptyLots.length === 0 ? (
        <Card>
          <EmptyState
            title={filtered ? "No lots match these filters" : "No stock at this site yet"}
            action={filtered ? <LinkButton href="/inventory" variant="secondary">Clear filters</LinkButton> : ctx.can("procurement.goods_receipt.create") ? <LinkButton href="/inventory/receive">Receive materials</LinkButton> : undefined}
          >
            {filtered ? "Try a different item, section, kind or status, or include empty lots." : "Received materials and produced finished goods appear here."}
          </EmptyState>
        </Card>
      ) : (
        groups.map((g) => (
          <Card key={g.section} aria-labelledby={`section-${g.section}`} data-testid={`stock-section-${g.section}`}>
            <SectionHeading section={g.section} label={g.label} hint={g.hint} count={g.rows.length} />
            {/* Phone and portrait tablet: cards */}
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:hidden">
              {g.rows.map((l) => (
                <li key={l.lotId} className="min-w-0">
                  <Link href={`/inventory/${l.lotId}`} className="block rounded-[12px] border border-line p-3 active:bg-surface-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 break-all font-mono text-[15px] font-semibold text-primary-text">{l.lotNumber}</span>
                      <StatusChip status={l.qualityStatus} />
                    </div>
                    <p className="mt-1 text-[14px]">{l.itemName} <span className="text-muted">· {l.itemCode}</span></p>
                    <div className="mt-2 flex flex-wrap items-end justify-between gap-2 text-[13px]">
                      <Expiry date={l.expiresOn} warnDays={EXPIRY_WARN_DAYS} compact />
                      <span className="font-semibold tabular">{fmtLotQty(l.onHand, l.baseUom)}</span>
                    </div>
                    <p className="mt-1 text-[12px] text-muted">At {l.locationCodes}{l.supplierLotNumber ? ` · supplier lot ${l.supplierLotNumber}` : ""}</p>
                  </Link>
                </li>
              ))}
            </ul>
            {/* Landscape tablet and desktop: table */}
            <Table className="hidden lg:block" head={["Lot", "Item", "Supplier lot", "Expiry", "Here", "Where", "Status"]}>
              {g.rows.map((l) => (
                <tr key={l.lotId} className="hover:bg-surface-2">
                  <Td>
                    <Link href={`/inventory/${l.lotId}`} className="font-mono font-semibold text-primary-text hover:underline">{l.lotNumber}</Link>
                    <div className="text-[11px] text-muted">{l.itemKind === "product" ? "Finished goods" : "Material"}</div>
                  </Td>
                  <Td>
                    {l.itemName}
                    <div className="text-[12px] text-muted">{l.itemCode}</div>
                  </Td>
                  <Td>{l.supplierLotNumber ?? <span className="text-muted">—</span>}</Td>
                  <Td><Expiry date={l.expiresOn} warnDays={EXPIRY_WARN_DAYS} /></Td>
                  <Td className="whitespace-nowrap text-right font-medium">{fmtLotQty(l.onHand, l.baseUom)}</Td>
                  <Td className="text-[12px]">{l.locationCodes}</Td>
                  <Td><StatusChip status={l.qualityStatus} /></Td>
                </tr>
              ))}
            </Table>
          </Card>
        ))
      )}

      {emptyLots.length > 0 && (
        <Card data-testid="stock-section-empty">
          <h2 className="mb-3 text-[15px] font-semibold">Lots with no stock left · {emptyLots.length}</h2>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {emptyLots.map((l) => (
              <li key={l.id} className="min-w-0">
                <Link href={`/inventory/${l.id}`} className="block rounded-[12px] border border-line p-3 active:bg-surface-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 break-all font-mono text-[14px] font-semibold text-primary-text">{l.lotNumber}</span>
                    <StatusChip status={l.qualityStatus} />
                  </div>
                  <p className="mt-1 text-[13px]">{l.itemName} <span className="text-muted">· {l.itemCode}</span></p>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
