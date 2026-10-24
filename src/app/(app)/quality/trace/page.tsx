import Link from "next/link";
import { Boxes, Factory, PackageOpen, Search, Truck } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { traceGenealogy, type TraceNode } from "@/modules/quality/genealogy";
import { Card, CardTitle, EmptyState, Input, PageHeader, Table, Td, buttonClass } from "@/ui/core";
import { Banner, StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { fmtLotQty } from "../_ui";

export const dynamic = "force-dynamic";

const ROLE_LABEL = { consumed: "used", produced: "produced", shipped: "shipped", on_order: "on order", relotted: "re-lotted (transfer or customer return)" } as const;

function NodeIcon({ kind }: { kind: TraceNode["kind"] }) {
  const cls = "mt-0.5 shrink-0 text-muted";
  if (kind === "batch") return <Factory size={16} className={cls} aria-label="Batch" />;
  if (kind === "shipment") return <Truck size={16} className={cls} aria-label="Shipment" />;
  if (kind === "supplier_lot") return <PackageOpen size={16} className={cls} aria-label="Supplier lot" />;
  return <Boxes size={16} className={cls} aria-label="Lot" />;
}

function NodeRow({ n }: { n: TraceNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1 py-1.5">
      <NodeIcon kind={n.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {n.kind === "shipment" ? "Shipment" : n.kind === "batch" ? "Batch" : n.kind === "supplier_lot" ? "Supplier lot" : n.itemKind === "product" ? "Finished lot" : "Material lot"}
          </span>
          <Link href={n.href} className="font-medium text-primary-text hover:underline">
            {n.kind === "shipment" ? `${n.orderNumber} · ${n.number}` : n.number}
          </Link>
          {n.kind !== "supplier_lot" && <StatusChip status={n.status} />}
          {n.siteCode && <span className="text-[12px] text-muted">{n.siteCode}</span>}
        </div>
        <p className="text-[13px] text-fg-2">
          {n.label}
          {n.qty && n.qtyRole ? <span className="text-muted"> · {fmtLotQty(n.qty, n.uom)} {ROLE_LABEL[n.qtyRole]}</span> : null}
          {n.kind === "shipment" && n.boxNumbers?.length ? (
            <span className="text-muted">
              {" "}
              · {n.boxNumbers.length === 1 ? "box" : `${n.boxNumbers.length} boxes`} {n.boxNumbers.slice(0, 6).join(", ")}
              {n.boxNumbers.length > 6 ? ` +${n.boxNumbers.length - 6} more` : ""}
            </span>
          ) : null}
          {n.kind === "lot" && n.supplierName ? <span className="text-muted"> · {n.supplierName}{n.supplierLot ? `, supplier lot ${n.supplierLot}` : ""}</span> : null}
          {n.kind === "lot" && n.expiresOn ? <span className="text-muted"> · exp. {fmtDate(n.expiresOn)}</span> : null}
          {n.kind === "lot" && n.receiptNumber && n.receiptHref ? (
            <span className="text-muted">
              {" "}
              · received on{" "}
              <Link className="text-primary-text hover:underline" href={n.receiptHref}>
                {n.receiptNumber}
              </Link>
            </span>
          ) : null}
          {n.kind !== "lot" && n.date ? <span className="text-muted"> · {fmtDateTime(n.date)}</span> : null}
        </p>
      </div>
    </div>
  );
}

function Tree({ nodes }: { nodes: TraceNode[] }) {
  return (
    <ul className="flex flex-col">
      {nodes.map((n, i) => (
        <li key={`${n.kind}:${n.id}:${i}`}>
          <NodeRow n={n} />
          {n.children.length > 0 && (
            <div className="ml-2 border-l-2 border-line pl-4 sm:ml-3 sm:pl-5">
              <Tree nodes={n.children} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function TracePage({ searchParams }: { searchParams: Promise<{ lot?: string; batch?: string; q?: string; supplierLot?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.genealogy.view")) return <Forbidden what="traceability" />;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  // A typed code: B-… is a batch number, anything else is looked up as a lot number. BC:LOT: scan payloads are accepted.
  const typed = q.replace(/^BC:LOT:/i, "");
  const lotNumber = sp.lot ?? (typed && !/^B-/i.test(typed) ? typed : undefined);
  const batchNumber = sp.batch ?? (typed && /^B-/i.test(typed) ? typed : undefined);
  const supplierLot = !lotNumber && !batchNumber ? sp.supplierLot?.trim() || undefined : undefined;
  const searched = !!(lotNumber || batchNumber || supplierLot);
  const t = await traceGenealogy(ctx, { lotNumber, batchNumber, supplierLot });
  const shownCode = t.query.lotNumber ?? t.query.batchNumber ?? "";
  const exportQuery = t.query.lotNumber ? `lotNumber=${encodeURIComponent(t.query.lotNumber)}` : t.query.batchNumber ? `batchNumber=${encodeURIComponent(t.query.batchNumber)}` : `supplierLot=${encodeURIComponent(t.query.supplierLot ?? "")}`;
  const linkCls = "inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2";

  return (
    <>
      <PageHeader
        title="Traceability"
        subtitle="Forward and reverse genealogy from the stock ledger: supplier lot → receipt → batches → finished lots → customers."
        actions={
          t.root && ctx.can("quality.genealogy.export") ? (
            <>
              <a className={linkCls} href={`/api/v1/quality/genealogy/export?${exportQuery}&format=csv`}>
                Export CSV
              </a>
              <a className={linkCls} href={`/api/v1/quality/genealogy/export?${exportQuery}&format=xlsx`}>
                Export XLSX
              </a>
            </>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-5">
        <Card>
          <form method="get" action="/quality/trace" className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="q" className="text-[13px] font-medium">
                Lot or batch number
              </label>
              <Input id="q" name="q" defaultValue={shownCode} placeholder="L-2610-00001 or B-26-0001" autoComplete="off" />
            </div>
            <button type="submit" className={buttonClass("cta")}>
              <Search size={16} /> Trace
            </button>
          </form>
          <form method="get" action="/quality/trace" className="mt-3 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="supplierLot" className="text-[13px] font-medium">
                Or a supplier&apos;s lot number (forward trace)
              </label>
              <Input id="supplierLot" name="supplierLot" defaultValue={t.query.supplierLot ?? ""} placeholder="LOS-24871" autoComplete="off" />
            </div>
            <button type="submit" className={buttonClass("secondary")}>
              <Search size={16} /> Trace forward
            </button>
          </form>
          <p className="mt-2 text-[12px] text-muted">Only records at your sites ({ctx.allowedSites.map((s) => s.code).join(", ")}) are shown.</p>
        </Card>

        {!searched ? (
          <EmptyState title="Search for a lot or batch">Enter a lot number to see which batches used it and which customers received the product, or a finished lot to see its materials.</EmptyState>
        ) : !t.root ? (
          <EmptyState title="Nothing found">No records trace from {shownCode || t.query.supplierLot} at your sites.</EmptyState>
        ) : (
          <>
            <p className="text-[12px] text-muted">
              Trace as of {fmtDateTime(t.asOf)} · sites included: {t.siteCodes.join(", ")} · depth limit {t.maxDepth}
            </p>
            {t.depthLimitHit && (
              <Banner tone="warn" title={`The trace reached the depth limit of ${t.maxDepth}`}>
                Some branches were cut. Trace again from one of the deepest lots shown to continue.
              </Banner>
            )}
            {t.hiddenCount > 0 && (
              <Banner tone="warn" title={`${t.hiddenCount} linked record(s) are at sites outside your access`}>
                Ask a user with access to those sites (or the owner) to complete the trace.
              </Banner>
            )}
            <Card>
              <CardTitle>Subject</CardTitle>
              <NodeRow n={t.root} />
            </Card>

            <div className="grid gap-5 xl:grid-cols-2">
              <Card>
                <CardTitle>Where it came from (reverse)</CardTitle>
                {t.reverse.length === 0 ? (
                  <p className="text-[13px] text-muted">
                    {t.root.kind === "supplier_lot"
                      ? `Delivered by ${t.root.supplierName ?? "the supplier"}; see the received lots under "Where it went".`
                      : t.root.kind === "lot" && t.root.itemKind === "material"
                      ? `Received material: supplier ${t.root.supplierName ?? "—"}, supplier lot ${t.root.supplierLot ?? "—"}.`
                      : "No input records found."}
                  </p>
                ) : (
                  <Tree nodes={t.reverse} />
                )}
              </Card>
              <Card>
                <CardTitle>Where it went (forward)</CardTitle>
                {t.forward.length === 0 ? <p className="text-[13px] text-muted">Not used in any batch and not shipped yet.</p> : <Tree nodes={t.forward} />}
              </Card>
            </div>

            <Card>
              <CardTitle>Affected customers</CardTitle>
              {t.affectedCustomers.length === 0 ? (
                <EmptyState title="No customer has received this">No shipment of this lot or of products made from it has been dispatched.</EmptyState>
              ) : (
                <Table head={["Customer", "Order", "DR number", "Lot shipped", "Quantity", "Dispatched"]}>
                  {t.affectedCustomers.map((c) => (
                    <tr key={`${c.shipmentId}:${c.lotId}`}>
                      <Td className="font-medium">{c.customerName}</Td>
                      <Td>
                        <Link className="text-primary-text hover:underline" href={`/sales/${c.orderId}`}>
                          {c.orderNumber}
                        </Link>
                      </Td>
                      <Td>{c.drNumber}</Td>
                      <Td>
                        <Link className="text-primary-text hover:underline" href={`/inventory/${c.lotId}`}>
                          {c.lotNumber}
                        </Link>
                        <div className="text-[12px] text-muted">{c.productName}</div>
                      </Td>
                      <Td>{fmtLotQty(c.qty, c.uom)}</Td>
                      <Td className="whitespace-nowrap">{fmtDateTime(c.dispatchedAt)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
