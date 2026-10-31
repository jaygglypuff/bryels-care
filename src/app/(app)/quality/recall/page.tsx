import Link from "next/link";
import { Search } from "lucide-react";
import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { recallScope, type RecallMode, type RecallQuery } from "@/modules/quality";
import { Card, CardTitle, EmptyState, Input, Kpi, PageHeader, Select, Table, Td, buttonClass, cx } from "@/ui/core";
import { listLots } from "@/modules/inventory";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { QaStatusChip, fmtLotQty } from "../_ui";

export const dynamic = "force-dynamic";

const RELATION_WORD = { subject: "The one you chose", source: "Made it", downstream: "Used it", sibling: "Used the same material lot" } as const;
const ROLE_WORD = { start: "The one you chose", upstream: "Went into it", downstream: "Made from it" } as const;
/** Pick a lot by its name instead of typing its number (ADR-088): the lots of the current site, newest use-by first. */
async function lotChoices(ctx: Awaited<ReturnType<typeof requireContext>>) {
  if (!ctx.can("inventory.lot.view")) return [];
  const rows = await listLots(ctx, { includeEmpty: true });
  return rows.map((l) => ({ lotNumber: l.lotNumber, label: `${l.itemName} · ${l.lotNumber}${l.supplierName ? ` · ${l.supplierName}` : ""}` }));
}

function PickLot({ action, name, lots, button, selected }: { action: string; name: string; lots: { lotNumber: string; label: string }[]; button: string; selected?: string }) {
  if (lots.length === 0) return null;
  return (
    <form method="get" action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <label htmlFor={`pick-${name}`} className="text-[13px] font-medium">
          Choose the material or product (lot)
        </label>
        <Select id={`pick-${name}`} name={name} defaultValue={selected ?? ""} required>
          <option value="" disabled>
            Choose…
          </option>
          {lots.map((l) => (
            <option key={l.lotNumber} value={l.lotNumber}>
              {l.label}
            </option>
          ))}
        </Select>
      </div>
      <button type="submit" className={buttonClass("cta")}>
        <Search size={16} /> {button}
      </button>
    </form>
  );
}


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
  const [r, lots] = await Promise.all([recallScope(ctx, { ...q, mode }), lotChoices(ctx)]);
  const linkCls = "inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2";
  const outstanding = r.customers.flatMap((c) => c.outstanding);
  const outByUom = new Map<string, Decimal>();
  for (const o of outstanding) outByUom.set(o.uom, (outByUom.get(o.uom) ?? new Decimal(0)).plus(o.qty));

  return (
    <>
      <PageHeader
        title="Who received it (recall check)"
        actions={
          r.subject && (ctx.can("quality.genealogy.export") || ctx.can("quality.recall_case.create")) ? (
            <>
              {ctx.can("quality.recall_case.create") && (
                <a className={buttonClass("cta")} href={`/quality/recalls/new?${queryString(q, r.mode)}`}>
                  Start a product recall
                </a>
              )}
              {ctx.can("quality.genealogy.export") && (
                <MoreMenu>
                  <div className="flex flex-col gap-2">
                    <a className={linkCls} href={`/api/v1/quality/recall/export?${queryString(q, r.mode)}&format=csv`}>
                      Download (CSV)
                    </a>
                    <a className={linkCls} href={`/api/v1/quality/recall/export?${queryString(q, r.mode)}&format=xlsx`}>
                      Download (Excel)
                    </a>
                  </div>
                </MoreMenu>
              )}
            </>
          ) : undefined
        }
      />
      <PageIntro>This screen is for QA when something may be wrong with a product: see every customer who got it and how much is still with them. It only shows; nothing is changed.</PageIntro>
      {!searched && <NextStep text="Next: choose the material or product below, or scan a label or complaint number." />}
      {r.subject && ctx.can("quality.recall_case.create") && <NextStep text="If the product must come back, start a product recall from this list." action={{ label: "Start a product recall", href: `/quality/recalls/new?${queryString(q, r.mode)}` }} />}

      <div className="flex flex-col gap-5">
        <Card>
          <PickLot action="/quality/recall" name="code" lots={lots} button="Show" selected={q.code} />
          <div className={lots.length ? "mt-3" : ""}>
          <MoreDetails title="Scan a label, or a complaint or supplier's lot number" open={lots.length === 0 || (!!q.code && !r.subject)}>
          <form method="get" action="/quality/recall" className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="code" className="text-[13px] font-medium">
                Scan a label (lot, box or batch) or the complaint number
              </label>
              <Input id="code" name="code" defaultValue={q.code ?? ""} autoComplete="off" />
            </div>
            <button type="submit" className={buttonClass("secondary")}>
              <Search size={16} /> Show
            </button>
          </form>
          <form method="get" action="/quality/recall" className="mt-3 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="supplierLot" className="text-[13px] font-medium">
                Or the supplier&apos;s lot number (from their label)
              </label>
              <Input id="supplierLot" name="supplierLot" defaultValue={q.supplierLot ?? ""} autoComplete="off" />
            </div>
            <button type="submit" className={buttonClass("secondary")}>
              <Search size={16} /> Show where it went
            </button>
          </form>
          </MoreDetails>
          </div>
          <p className="mt-2 text-[12px] text-muted">Only records at your sites ({ctx.allowedSites.map((s) => s.code).join(", ")}) are shown.</p>
        </Card>

        {!searched ? (
          <EmptyState title="Choose something first">Choose a material or product (or scan a label, or use a complaint number) to list every customer who got it.</EmptyState>
        ) : !r.subject ? (
          <EmptyState title="Nothing found">{r.notFoundMessage}</EmptyState>
        ) : (
          <>
            <Card>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">You chose</p>
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
                    <Link key={m} href={`/quality/recall?${queryString(q, m)}`} className={cx("inline-flex min-h-[44px] items-center rounded-full border px-4 text-[13px]", r.mode === m ? "border-ring bg-primary-soft font-medium" : "border-line hover:bg-surface-2")}>
                      {m === "forward" ? "Only where it went" : "Also batches that used the same materials"}
                    </Link>
                  ))}
                </nav>
              </div>
              <p className="mt-2 text-[12px] text-muted">
                As of {fmtDateTime(r.asOf)} · sites: {r.siteCodes.join(", ")}
              </p>
            </Card>
            {r.depthLimitHit && <Banner tone="warn" title="The list is too long to show in full">Some parts were cut. Look again from one of the last lots shown.</Banner>}
            {r.hiddenCount > 0 && <Banner tone="warn" title={`${r.hiddenCount} linked record(s) are at sites you cannot see`}>They are not shown. Ask someone with access to those sites (or the owner) to look too.</Banner>}

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Customers" value={r.customers.length} />
              <Kpi label="Deliveries" value={r.shipments.length} />
              <Kpi label="Still at customers" value={[...outByUom.entries()].map(([u, n]) => fmtLotQty(n.toString(), u)).join(" · ") || "0"} tone={outByUom.size ? "warn" : "neutral"} />
              <Kpi label="Lots and batches" value={`${r.lots.length} / ${r.batches.length}`} />
            </div>

            <Card>
              <CardTitle>Customers who got it</CardTitle>
              {r.customers.length === 0 ? (
                <p className="text-[13px] text-muted">Nothing of it has been sent to a customer from your sites.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line text-[14px]">
                  {r.customers.map((c) => (
                    <li key={c.customerId} className="flex flex-col gap-0.5 py-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.customerName}</span>
                        {c.outstanding.length > 0 && <Chip tone="warn">Still with them: {c.outstanding.map((o) => fmtLotQty(o.qty, o.uom)).join(" · ")}</Chip>}
                      </span>
                      <span className="text-[13px] text-fg-2">{c.shipTo}</span>
                      <span className="text-[12px] text-muted">
                        Delivery receipts {c.drNumbers.join(", ")} · lots <span className="font-mono">{c.lotNumbers.join(", ")}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <MoreDetails title="Details: deliveries, stock still here, boxes, batches and lots">
            <Card>
              <CardTitle>Deliveries</CardTitle>
              {r.shipments.length === 0 ? (
                <p className="text-[13px] text-muted">No deliveries.</p>
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
                <CardTitle>Still in our warehouses</CardTitle>
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
                          <QaStatusChip status={s.status} />
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
                        <QaStatusChip status={b.status} />
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
                      <QaStatusChip status={l.status} />
                      <span className="text-[12px] text-muted">
                        {ROLE_WORD[l.role]}
                        {l.viaBatchNumber ? ` · via ${l.viaBatchNumber}` : l.originLotNumber ? ` · new number for ${l.originLotNumber}` : ""}
                        {l.supplierLot ? ` · supplier's lot ${l.supplierLot}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
            </MoreDetails>
          </>
        )}
      </div>
    </>
  );
}
