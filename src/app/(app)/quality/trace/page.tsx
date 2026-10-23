import Link from "next/link";
import { Boxes, Factory, Search, Truck } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { traceGenealogy, type TraceNode } from "@/modules/quality/genealogy";
import { Card, CardTitle, EmptyState, Input, PageHeader, Table, Td, buttonClass } from "@/ui/core";
import { Banner, StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { fmtLotQty } from "../_ui";

export const dynamic = "force-dynamic";

const ROLE_LABEL = { consumed: "used", produced: "produced", shipped: "shipped", on_order: "on order" } as const;

function NodeIcon({ kind }: { kind: TraceNode["kind"] }) {
  const cls = "mt-0.5 shrink-0 text-muted";
  if (kind === "batch") return <Factory size={16} className={cls} aria-label="Batch" />;
  if (kind === "shipment") return <Truck size={16} className={cls} aria-label="Shipment" />;
  return <Boxes size={16} className={cls} aria-label="Lot" />;
}

function NodeRow({ n }: { n: TraceNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1 py-1.5">
      <NodeIcon kind={n.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{n.kind === "shipment" ? "Shipment" : n.kind === "batch" ? "Batch" : n.itemKind === "product" ? "Finished lot" : "Material lot"}</span>
          <Link href={n.href} className="font-medium text-primary-text hover:underline">
            {n.kind === "shipment" ? `${n.orderNumber} · ${n.number}` : n.number}
          </Link>
          <StatusChip status={n.status} />
          {n.siteCode && <span className="text-[12px] text-muted">{n.siteCode}</span>}
        </div>
        <p className="text-[13px] text-fg-2">
          {n.label}
          {n.qty && n.qtyRole ? <span className="text-muted"> · {fmtLotQty(n.qty, n.uom)} {ROLE_LABEL[n.qtyRole]}</span> : null}
          {n.kind === "lot" && n.supplierName ? <span className="text-muted"> · {n.supplierName}{n.supplierLot ? `, supplier lot ${n.supplierLot}` : ""}</span> : null}
          {n.kind === "lot" && n.expiresOn ? <span className="text-muted"> · exp. {fmtDate(n.expiresOn)}</span> : null}
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

export default async function TracePage({ searchParams }: { searchParams: Promise<{ lot?: string; batch?: string; q?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.genealogy.view")) return <Forbidden what="traceability" />;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  // A typed code: B-… is a batch number, anything else is looked up as a lot number. BC:LOT: scan payloads are accepted.
  const typed = q.replace(/^BC:LOT:/i, "");
  const lotNumber = sp.lot ?? (typed && !/^B-/i.test(typed) ? typed : undefined);
  const batchNumber = sp.batch ?? (typed && /^B-/i.test(typed) ? typed : undefined);
  const searched = !!(lotNumber || batchNumber);
  const t = await traceGenealogy(ctx, { lotNumber, batchNumber });
  const shownCode = t.query.lotNumber ?? t.query.batchNumber ?? "";

  return (
    <>
      <PageHeader title="Traceability" subtitle="Forward and reverse genealogy from the stock ledger: supplier lot → batches → finished lots → customers." />

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
          <p className="mt-2 text-[12px] text-muted">Only records at your sites ({ctx.allowedSites.map((s) => s.code).join(", ")}) are shown.</p>
        </Card>

        {!searched ? (
          <EmptyState title="Search for a lot or batch">Enter a lot number to see which batches used it and which customers received the product, or a finished lot to see its materials.</EmptyState>
        ) : !t.root ? (
          <EmptyState title="Nothing found">No records trace from {shownCode} at your sites.</EmptyState>
        ) : (
          <>
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
                    {t.root.kind === "lot" && t.root.itemKind === "material"
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
