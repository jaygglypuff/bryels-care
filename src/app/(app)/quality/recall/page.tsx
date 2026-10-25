import Link from "next/link";
import { Search } from "lucide-react";
import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { recallScope, type RecallMode, type RecallQuery } from "@/modules/quality";
import { Card, CardTitle, EmptyState, Input, Kpi, PageHeader, Table, Td, buttonClass, cx } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { fmtLotQty } from "../_ui";

export const dynamic = "force-dynamic";

const RELATION_WORD = { subject: "Subject", source: "Made the subject", downstream: "Used it", sibling: "Shares an input lot" } as const;
const ROLE_WORD = { start: "Subject", upstream: "Input (upstream)", downstream: "Made from it (downstream)" } as const;

function queryString(q: RecallQuery, mode?: RecallMode) {
  const p = new URLSearchParams();
  if (q.complaintId) p.set("complaintId", q.complaintId);
  else if (q.supplierLot) p.set("supplierLot", q.supplierLot);
  else if (q.code) p.set("code", q.code);
  if (mode) p.set("mode", mode);
  return p.toString();
}

/** Read-only recall explorer (US-4-17, ux-system §9.14): who received what, from a lot, box, batch, supplier lot or complaint. */
export default async function RecallPage({ searchParams }: { searchParams: Promise<{ code?: string; supplierLot?: string; complaintId?: string; mode?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.genealogy.view")) return <Forbidden what="the recall explorer" />;
  const sp = await searchParams;
  const mode = sp.mode === "forward" || sp.mode === "reverse" ? sp.mode : null;
  const complaintId = sp.complaintId && /^[0-9a-f-]{36}$/i.test(sp.complaintId) && ctx.can("quality.complaint.view") ? sp.complaintId : undefined;
  const q: RecallQuery = complaintId ? { complaintId } : sp.supplierLot?.trim() ? { supplierLot: sp.supplierLot.trim() } : { code: sp.code?.trim() || undefined };
  const searched = !!(q.complaintId || q.supplierLot || q.code);
  const r = await recallScope(ctx, { ...q, mode });
  const linkCls = "inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2";
  const outstanding = r.customers.flatMap((c) => c.outstanding);
  const outByUom = new Map<string, Decimal>();
  for (const o of outstanding) outByUom.set(o.uom, (outByUom.get(o.uom) ?? new Decimal(0)).plus(o.qty));

  return (
    <>
      <PageHeader
        title="Recall explorer"
        subtitle="Read-only: every lot, batch, box, shipment and customer affected, from the stock ledger. Open a recall case from this scope to act on it."
        actions={
          r.subject && (ctx.can("quality.genealogy.export") || ctx.can("quality.recall_case.create")) ? (
            <>
              {ctx.can("quality.recall_case.create") && (
                <a className={linkCls} href={`/quality/recalls/new?${queryString(q, r.mode)}`}>
                  Open recall case
                </a>
              )}
              {ctx.can("quality.genealogy.export") && (
                <>
                  <a className={linkCls} href={`/api/v1/quality/recall/export?${queryString(q, r.mode)}&format=csv`}>
                    Export CSV
                  </a>
                  <a className={linkCls} href={`/api/v1/quality/recall/export?${queryString(q, r.mode)}&format=xlsx`}>
                    Export XLSX
                  </a>
                </>
              )}
            </>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-5">
        <Card>
          <form method="get" action="/quality/recall" className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="code" className="text-[13px] font-medium">
                Lot, box, batch or complaint number (scan or type)
              </label>
              <Input id="code" name="code" defaultValue={q.code ?? ""} placeholder="L-2610-00015, BC:BOX:…, B-26-0001 or CMP-26-0001" autoComplete="off" />
            </div>
            <button type="submit" className={buttonClass("cta")}>
              <Search size={16} /> Explore
            </button>
          </form>
          <form method="get" action="/quality/recall" className="mt-3 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="supplierLot" className="text-[13px] font-medium">
                Or a supplier&apos;s lot number
              </label>
              <Input id="supplierLot" name="supplierLot" defaultValue={q.supplierLot ?? ""} placeholder="LOS-24871" autoComplete="off" />
            </div>
            <button type="submit" className={buttonClass("secondary")}>
              <Search size={16} /> Explore forward
            </button>
          </form>
          <p className="mt-2 text-[12px] text-muted">Only records at your sites ({ctx.allowedSites.map((s) => s.code).join(", ")}) are shown.</p>
        </Card>

        {!searched ? (
          <EmptyState title="Start from a code">Scan or type a lot, box, batch or complaint number, or a supplier&apos;s lot number, to list every customer who received affected product.</EmptyState>
        ) : !r.subject ? (
          <EmptyState title="Nothing found">{r.notFoundMessage}</EmptyState>
        ) : (
          <>
            <Card>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{r.subject.kind.replace("_", " ")}</p>
                  <p className="text-[16px] font-semibold">
                    {r.subject.kind === "complaint" && r.subject.id ? (
                      <Link className="text-primary-text hover:underline" href={`/quality/complaints/${r.subject.id}`}>
                        {r.subject.number}
                      </Link>
                    ) : (
                      r.subject.number
                    )}{" "}
                    <span className="text-[14px] font-normal text-fg-2">· {r.subject.label}</span>
                  </p>
                </div>
                <nav className="flex flex-wrap gap-2" aria-label="Direction">
                  {(["forward", "reverse"] as const).map((m) => (
                    <Link key={m} href={`/quality/recall?${queryString(q, m)}`} className={cx("rounded-full border px-3 py-1 text-[13px]", r.mode === m ? "border-ring bg-primary-soft font-medium" : "border-line hover:bg-surface-2")}>
                      {m === "forward" ? "Forward: where it went" : "Reverse: inputs and sibling batches too"}
                    </Link>
                  ))}
                </nav>
              </div>
              <p className="mt-2 text-[12px] text-muted">
                Point in time {fmtDateTime(r.asOf)} · sites included: {r.siteCodes.join(", ")} · depth limit {r.maxDepth}
              </p>
            </Card>
            {r.depthLimitHit && <Banner tone="warn" title={`The trace reached the depth limit of ${r.maxDepth}`}>Some branches were cut. Explore again from one of the deepest lots to continue.</Banner>}
            {r.hiddenCount > 0 && <Banner tone="warn" title={`${r.hiddenCount} linked record(s) are at sites outside your access`}>They are not shown or followed. Ask a user with access to those sites (or the owner) to complete the list.</Banner>}

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Customers" value={r.customers.length} />
              <Kpi label="Shipment lines" value={r.shipments.length} />
              <Kpi label="Still at customers" value={[...outByUom.entries()].map(([u, n]) => fmtLotQty(n.toString(), u)).join(" · ") || "0"} tone={outByUom.size ? "warn" : "neutral"} />
              <Kpi label="Lots / batches" value={`${r.lots.length} / ${r.batches.length}`} />
            </div>

            <Card>
              <CardTitle>Affected customers</CardTitle>
              {r.customers.length === 0 ? (
                <p className="text-[13px] text-muted">No shipment of an affected lot has been dispatched from your sites.</p>
              ) : (
                <Table head={["Customer", "Ship-to", "DR numbers", "Lots", "Still at customer"]}>
                  {r.customers.map((c) => (
                    <tr key={c.customerId}>
                      <Td className="font-medium">{c.customerName}</Td>
                      <Td className="max-w-[260px] text-[13px]">{c.shipTo}</Td>
                      <Td className="text-[13px]">{c.drNumbers.join(", ")}</Td>
                      <Td className="text-[13px]">{c.lotNumbers.join(", ")}</Td>
                      <Td className="whitespace-nowrap">{c.outstanding.map((o) => fmtLotQty(o.qty, o.uom)).join(" · ")}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>

            <Card>
              <CardTitle>Shipments</CardTitle>
              {r.shipments.length === 0 ? (
                <p className="text-[13px] text-muted">No shipments.</p>
              ) : (
                <Table head={["DR / order", "Customer", "Lot", "Shipped", "Returned", "Still at customer", "Boxes", "Dispatched"]}>
                  {r.shipments.map((s) => (
                    <tr key={`${s.shipmentId}:${s.lotId}`}>
                      <Td className="whitespace-nowrap">
                        {s.drNumber}
                        <div className="text-[12px]">
                          <Link className="text-primary-text hover:underline" href={`/sales/${s.orderId}`}>
                            {s.orderNumber}
                          </Link>
                        </div>
                      </Td>
                      <Td>{s.customerName}</Td>
                      <Td>
                        <Link className="text-primary-text hover:underline" href={`/quality/lots/${s.lotId}`}>
                          {s.lotNumber}
                        </Link>
                        <div className="text-[12px] text-muted">{s.productName}</div>
                      </Td>
                      <Td>{fmtLotQty(s.qtyShipped, s.uom)}</Td>
                      <Td>{fmtLotQty(s.qtyReturned, s.uom)}</Td>
                      <Td className="font-medium">{fmtLotQty(s.qtyOutstanding, s.uom)}</Td>
                      <Td className="text-[12px]">{s.boxes.length ? s.boxes.join(", ") : <span className="text-muted">not recorded</span>}</Td>
                      <Td className="whitespace-nowrap">{fmtDateTime(s.dispatchedAt)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>

            <div className="grid gap-5 xl:grid-cols-2">
              <Card>
                <CardTitle>Stock still in our warehouses</CardTitle>
                {r.stock.length === 0 ? (
                  <p className="text-[13px] text-muted">No affected stock on hand at your sites.</p>
                ) : (
                  <Table head={["Lot", "Status", "Location", "On hand"]}>
                    {r.stock.map((s, i) => (
                      <tr key={`${s.lotId}:${i}`}>
                        <Td>
                          <Link className="text-primary-text hover:underline" href={`/quality/lots/${s.lotId}`}>
                            {s.lotNumber}
                          </Link>
                        </Td>
                        <Td>
                          <StatusChip status={s.status} />
                        </Td>
                        <Td className="text-[13px]">
                          {s.siteCode} {s.locationCode} <span className="text-muted">({s.locationKind})</span>
                        </Td>
                        <Td>{fmtLotQty(s.qty, s.uom)}</Td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
              <Card>
                <CardTitle>Boxes</CardTitle>
                {r.boxes.length === 0 ? (
                  <p className="text-[13px] text-muted">No labelled boxes hold or held affected lots.</p>
                ) : (
                  <Table head={["Box", "Status", "Lots", "Now", "Shipped on"]}>
                    {r.boxes.map((b) => (
                      <tr key={b.containerId}>
                        <Td className="font-medium">
                          <Link className="text-primary-text hover:underline" href={`/inventory/containers/${b.containerId}`}>
                            {b.number}
                          </Link>
                          <div className="text-[12px] text-muted">
                            {b.siteCode} {b.locationCode ?? ""}
                          </div>
                        </Td>
                        <Td>
                          <Chip tone="neu">{b.status}</Chip>
                        </Td>
                        <Td className="text-[13px]">{b.lotNumbers.join(", ") || "—"}</Td>
                        <Td>{b.uom ? fmtLotQty(b.qtyNow, b.uom) : "—"}</Td>
                        <Td className="text-[13px]">{b.drNumber ? `${b.drNumber} · ${b.customerName}` : "—"}</Td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <Card>
                <CardTitle>Batches</CardTitle>
                {r.batches.length === 0 ? (
                  <p className="text-[13px] text-muted">No batches involved.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5 text-[14px]">
                    {r.batches.map((b) => (
                      <li key={b.id} className="flex flex-wrap items-center gap-2">
                        <Link className="font-medium text-primary-text hover:underline" href={`/quality/batches/${b.id}`}>
                          {b.number}
                        </Link>
                        <span className="text-fg-2">{b.productName}</span>
                        <StatusChip status={b.status} />
                        <Chip tone={b.relation === "sibling" ? "warn" : "info"}>{RELATION_WORD[b.relation]}</Chip>
                        <span className="text-[12px] text-muted">
                          {b.siteCode}
                          {b.date ? ` · ${fmtDate(b.date)}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card>
                <CardTitle>Lots</CardTitle>
                <ul className="flex flex-col gap-1.5 text-[14px]">
                  {r.lots.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-2">
                      <Link className="font-medium text-primary-text hover:underline" href={`/quality/lots/${l.id}`}>
                        {l.number}
                      </Link>
                      <span className="text-fg-2">{l.itemName}</span>
                      <StatusChip status={l.status} />
                      <span className="text-[12px] text-muted">
                        {ROLE_WORD[l.role]}
                        {l.viaBatchNumber ? ` · via ${l.viaBatchNumber}` : l.originLotNumber ? ` · re-lotted from ${l.originLotNumber}` : ""}
                        {l.supplierLot ? ` · supplier lot ${l.supplierLot}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </>
        )}
      </div>
    </>
  );
}
