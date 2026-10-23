import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRightLeft, Lock, Printer, Share2 } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtDateTime } from "@/lib/qty";
import { EXPIRY_WARN_DAYS, getLotDetail, isPastExpiry, moveDestinations, type LotDetail } from "@/modules/inventory/lots";
import { documentHref } from "@/modules/inventory/movements";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, Table, Td, buttonClass } from "@/ui/core";
import { Banner, StatusChip } from "@/ui/status";
import { Expiry, LocationKindChip, MOVEMENT_LABEL, fmtLotQty } from "@/ui/inventory/bits";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Lot" };

const STATUS_WORDS: Record<string, string> = { quarantine: "quarantined", on_hold: "on QA hold", rejected: "rejected", expired: "expired", recalled: "recalled" };

function RiskBanner({ lot, canSeeQa }: { lot: LotDetail; canSeeQa: boolean }) {
  const qa = canSeeQa ? <Link href={`/quality/lots/${lot.id}`} className={buttonClass("secondary", "sm")}>Open QA decision</Link> : undefined;
  const s = lot.qualityStatus;
  if (s === "quarantine")
    return (
      <Banner tone="q" title="Quarantined: not usable yet" action={qa}>
        Issue to production, consumption and shipment are blocked until QA releases this lot. It may only be moved between quarantine and hold locations.
      </Banner>
    );
  if (s === "on_hold")
    return (
      <Banner tone="hold" title="QA hold: not usable" action={qa}>
        QA has put this lot on hold. Issue, consumption and shipment are blocked; it may only be moved between quarantine and hold locations until QA decides.
      </Banner>
    );
  if (s === "rejected")
    return (
      <Banner tone="rej" title="Rejected: must not be used or shipped">
        Keep it segregated in the rejected cage and follow the QA disposal instruction.
      </Banner>
    );
  if (s === "recalled")
    return (
      <Banner tone="bad" title="Recalled: must not be used or shipped">
        Segregate all remaining stock and follow the recall instruction.
      </Banner>
    );
  if (s === "expired" || isPastExpiry(lot.expiresOn))
    return (
      <Banner tone="exp" title={`Expired${lot.expiresOn ? ` on ${fmtDate(lot.expiresOn)}` : ""}: not usable`} action={qa}>
        Expired stock is blocked from issue, consumption and shipment. Move it to a quarantine, hold or rejected location for disposal.
      </Banner>
    );
  return null;
}

export default async function LotPage({ params, searchParams }: { params: Promise<{ lotId: string }>; searchParams: Promise<{ moved?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="lots and stock" />;
  const { lotId } = await params;
  const { moved } = await searchParams;
  let lot: LotDetail;
  try {
    lot = await getLotDetail(ctx, lotId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const onHand = lot.balances.reduce((a, b) => a.plus(b.qtyBase), D(0));
  const site = ctx.allowedSites.find((s) => s.id === lot.siteId);
  const destinations = ctx.can("inventory.movement.post") ? await moveDestinations(ctx, lot) : [];
  const expired = lot.qualityStatus === "expired" || isPastExpiry(lot.expiresOn);
  const usable = lot.qualityStatus === "released" && !expired;

  // Allowed actions only; disallowed ones are shown greyed with the reason (ux-system §5.9).
  const actions: { key: string; label: string; href?: string; icon: React.ReactNode; reason?: string; newTab?: boolean }[] = [];
  if (ctx.can("inventory.movement.post")) {
    const canMoveSomewhere = lot.balances.some((b) => destinations.some((d) => d.id !== b.locationId));
    const reason = onHand.lte(0) ? "No stock left in this lot." : !canMoveSomewhere ? "No other allowed location at this site." : undefined;
    actions.push({ key: "move", label: "Move stock", href: `/inventory/${lot.id}/move`, icon: <ArrowRightLeft size={16} />, reason });
  }
  if (ctx.can("inventory.label.print")) actions.push({ key: "label", label: "Print label", href: `/print/lot-label/${lot.id}`, icon: <Printer size={16} />, newTab: true });
  if (ctx.can("quality.genealogy.view")) actions.push({ key: "trace", label: "Genealogy", href: `/quality/trace?lot=${encodeURIComponent(lot.lotNumber)}`, icon: <Share2 size={16} /> });
  const blocked = usable ? [] : [
    { label: lot.itemKind === "product" ? "Allocate / ship" : "Issue to production", reason: `blocked while the lot is ${expired && lot.qualityStatus === "released" ? "expired" : STATUS_WORDS[lot.qualityStatus] ?? lot.qualityStatus}.` },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={lot.lotNumber}
        subtitle={
          <>
            <Link href="/inventory" className="text-primary-text hover:underline">Lots & stock</Link> · {lot.itemName} · {lot.itemCode}
          </>
        }
        actions={<StatusChip status={lot.qualityStatus} className="px-3 py-1 text-[13px]" />}
      />

      {moved && <Banner tone="ok" title={`Stock moved (${moved})`}>The transfer is posted to the ledger below.</Banner>}
      <RiskBanner lot={lot} canSeeQa={ctx.can("quality.disposition.view")} />
      {lot.siteId !== ctx.currentSiteId && <Banner tone="info" title={`This lot belongs to ${site?.code} · ${site?.name}`}>Switch site to see it in that site's lists.</Banner>}

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardTitle>Identity</CardTitle>
          <Dl
            items={[
              ["Item", <>{lot.itemName}<div className="text-[12px] text-muted">{lot.itemCode}{lot.inciName ? ` · INCI ${lot.inciName}` : ""}</div></>],
              ["Kind", lot.itemKind === "product" ? "Finished goods" : "Material"],
              ["On hand", <strong key="oh">{fmtLotQty(onHand.toString(), lot.baseUom)}</strong>],
              ["Supplier", lot.supplierName ?? "—"],
              ["Supplier lot", lot.supplierLotNumber ?? "—"],
              ["Manufactured", fmtDate(lot.manufacturedOn)],
              ["Expiry", <Expiry key="ex" date={lot.expiresOn} warnDays={EXPIRY_WARN_DAYS} />],
              ["Received", lot.receipt ? <><Link href={`/inventory/receive/${lot.receipt.id}`} className="text-primary-text hover:underline">{lot.receipt.number}</Link><div className="text-[12px] text-muted">{fmtDateTime(lot.receipt.receivedAt)}</div></> : fmtDateTime(lot.createdAt)],
              ["Source batch", lot.batchNumber && lot.sourceBatchId ? <Link href={`/production/${lot.sourceBatchId}`} className="text-primary-text hover:underline">{lot.batchNumber}</Link> : "—"],
              ["Base unit", lot.baseUom],
              ["Site", site ? `${site.code} · ${site.name}` : "—"],
              ["Storage", lot.storageConditions ?? "—"],
            ]}
          />
        </Card>

        <Card>
          <CardTitle>Actions</CardTitle>
          <div className="flex flex-col gap-2">
            {actions.map((a) =>
              a.reason ? (
                <div key={a.key} className="flex min-h-[44px] items-start gap-2 rounded-[10px] border border-dashed border-line-strong px-3 py-2 text-[13px] text-muted" aria-disabled="true">
                  <Lock size={14} className="mt-0.5 shrink-0" /> <span><span className="font-medium">{a.label}</span>: {a.reason}</span>
                </div>
              ) : (
                <LinkButton key={a.key} href={a.href!} variant={a.key === "move" ? "cta" : "secondary"} target={a.newTab ? "_blank" : undefined}>
                  {a.icon} {a.label}
                </LinkButton>
              ),
            )}
            {blocked.map((b) => (
              <div key={b.label} className="flex min-h-[44px] items-start gap-2 rounded-[10px] border border-dashed border-line-strong px-3 py-2 text-[13px] text-muted" aria-disabled="true">
                <Lock size={14} className="mt-0.5 shrink-0" /> <span><span className="font-medium">{b.label}</span>: {b.reason}</span>
              </div>
            ))}
            {actions.length === 0 && blocked.length === 0 && <p className="text-[13px] text-muted">Your role can view this lot but not change it.</p>}
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle>Stock by location</CardTitle>
        {lot.balances.length === 0 ? (
          <EmptyState title="No stock left">All of this lot has been consumed, shipped or moved out.</EmptyState>
        ) : (
          <ul className="divide-y divide-line rounded-[12px] border border-line">
            {lot.balances.map((b) => (
              <li key={b.locationId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <span className="font-mono font-semibold">{b.code}</span> <span className="text-muted">· {b.name} · {b.warehouseCode}</span>
                </div>
                <div className="flex items-center gap-3">
                  <LocationKindChip kind={b.kind} />
                  <span className="font-semibold tabular">{fmtLotQty(b.qtyBase, lot.baseUom)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>Movement ledger</CardTitle>
        {lot.movements.length === 0 ? (
          <EmptyState title="No movements yet" />
        ) : (
          <Table head={["When", "Type", "Quantity", "From → to", "Document", "By"]}>
            {lot.movements.map((m) => {
              const href = documentHref(m);
              return (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap">{fmtDateTime(m.postedAt)}</Td>
                  <Td>{MOVEMENT_LABEL[m.movementType] ?? m.movementType}{m.reason && <div className="text-[12px] text-muted">{m.reason}</div>}</Td>
                  <Td className="whitespace-nowrap font-medium">{fmtLotQty(m.qtyBase, m.baseUom)}</Td>
                  <Td className="whitespace-nowrap font-mono text-[12px]">{m.fromCode ?? "—"} → {m.toCode ?? "—"}</Td>
                  <Td>{href ? <Link href={href} className="text-primary-text hover:underline">{m.sourceDocumentNumber}</Link> : m.sourceDocumentNumber ?? "—"}</Td>
                  <Td>{m.postedBy}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
