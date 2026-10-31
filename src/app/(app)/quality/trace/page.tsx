import Link from "next/link";
import { Boxes, Factory, PackageOpen, Search, Truck } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { traceGenealogy, type TraceNode } from "@/modules/quality/genealogy";
import { Card, CardTitle, EmptyState, Input, PageHeader, Select, buttonClass } from "@/ui/core";
import { listLots } from "@/modules/inventory";
import { Explain, MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { Banner, StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { QaStatusChip, fmtLotQty } from "../_ui";

export const dynamic = "force-dynamic";

const ROLE_LABEL = { consumed: "used", produced: "made", shipped: "shipped", on_order: "on order", relotted: "given a new lot number (transfer or customer return)" } as const;
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
            {n.kind === "shipment" ? "Delivery to customer" : n.kind === "batch" ? "Batch" : n.kind === "supplier_lot" ? "Supplier's lot" : n.itemKind === "product" ? "Product lot" : "Material lot"}
          </span>
          <Link href={n.href} className="font-medium text-primary-text hover:underline">
            {n.kind === "shipment" ? `${n.orderNumber} · ${n.number}` : n.number}
          </Link>
          {n.kind !== "supplier_lot" && (n.kind === "shipment" ? <StatusChip status={n.status} /> : <QaStatusChip status={n.status} />)}
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
          {n.kind === "lot" && n.expiresOn ? <span className="text-muted"> · use by {fmtDate(n.expiresOn)}</span> : null}
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
  const [t, lots] = await Promise.all([traceGenealogy(ctx, { lotNumber, batchNumber, supplierLot }), lotChoices(ctx)]);
  const shownCode = t.query.lotNumber ?? t.query.batchNumber ?? "";
  const exportQuery = t.query.lotNumber ? `lotNumber=${encodeURIComponent(t.query.lotNumber)}` : t.query.batchNumber ? `batchNumber=${encodeURIComponent(t.query.batchNumber)}` : `supplierLot=${encodeURIComponent(t.query.supplierLot ?? "")}`;
  const linkCls = "inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2";

  return (
    <>
      <PageHeader
        title="Where it came from and where it went"
        actions={
          t.root && ctx.can("quality.genealogy.export") ? (
            <MoreMenu>
              <div className="flex flex-col gap-2">
                <a className={linkCls} href={`/api/v1/quality/genealogy/export?${exportQuery}&format=csv`}>
                  Download (CSV)
                </a>
                <a className={linkCls} href={`/api/v1/quality/genealogy/export?${exportQuery}&format=xlsx`}>
                  Download (Excel)
                </a>
              </div>
            </MoreMenu>
          ) : undefined
        }
      />
      <PageIntro>
        This screen is for QA: choose a material or product and see which supplier it came from, which batches used it and which customers got it.
      </PageIntro>
      <div className="-mt-3 mb-4"><Explain term="lot" /></div>
      {!searched && <NextStep text="Next: choose the material or product below (or scan its label)." />}

      <div className="flex flex-col gap-5">
        <Card>
          <PickLot action="/quality/trace" name="lot" lots={lots} button="Show" selected={t.query.lotNumber ?? undefined} />
          <div className={lots.length ? "mt-3" : ""}>
          <MoreDetails title="Scan a label, or a batch number or a supplier's lot number" open={lots.length === 0 || (!!q && !t.root)}>
          <form method="get" action="/quality/trace" className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="q" className="text-[13px] font-medium">
                Scan the label (lot or batch)
              </label>
              <Input id="q" name="q" defaultValue={shownCode} autoComplete="off" />
            </div>
            <button type="submit" className={buttonClass("secondary")}>
              <Search size={16} /> Show
            </button>
          </form>
          <form method="get" action="/quality/trace" className="mt-3 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="supplierLot" className="text-[13px] font-medium">
                Or the supplier&apos;s lot number (from their label)
              </label>
              <Input id="supplierLot" name="supplierLot" defaultValue={t.query.supplierLot ?? ""} autoComplete="off" />
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
          <EmptyState title="Choose something first">Choose a material to see which batches used it and which customers got the product, or a product to see what it was made from.</EmptyState>
        ) : !t.root ? (
          <EmptyState title="Nothing found">Nothing at your sites matches {shownCode || t.query.supplierLot}. Check the number on the label, or ask QA.</EmptyState>
        ) : (
          <>
            <p className="text-[12px] text-muted">
              As of {fmtDateTime(t.asOf)} · sites: {t.siteCodes.join(", ")}
            </p>
            {t.depthLimitHit && (
              <Banner tone="warn" title="The list is too long to show in full">
                Some parts were cut. Open one of the last lots shown and look again from there.
              </Banner>
            )}
            {t.hiddenCount > 0 && (
              <Banner tone="warn" title={`${t.hiddenCount} linked record(s) are at sites you cannot see`}>
                Ask someone with access to those sites (or the owner) to look too.
              </Banner>
            )}
            <Card>
              <CardTitle>You chose</CardTitle>
              <NodeRow n={t.root} />
            </Card>

            <div className="grid gap-5 xl:grid-cols-2">
              <Card>
                <CardTitle>Where it came from</CardTitle>
                {t.reverse.length === 0 ? (
                  <p className="text-[13px] text-muted">
                    {t.root.kind === "supplier_lot"
                      ? `Delivered by ${t.root.supplierName ?? "the supplier"}; see the lots we received under "Where it went".`
                      : t.root.kind === "lot" && t.root.itemKind === "material"
                      ? `Bought from ${t.root.supplierName ?? "—"}, their lot number ${t.root.supplierLot ?? "—"}.`
                      : "Nothing recorded."}
                  </p>
                ) : (
                  <Tree nodes={t.reverse} />
                )}
              </Card>
              <Card>
                <CardTitle>Where it went</CardTitle>
                {t.forward.length === 0 ? <p className="text-[13px] text-muted">Not used in any batch and not shipped yet.</p> : <Tree nodes={t.forward} />}
              </Card>
            </div>

            <Card>
              <CardTitle>Customers who got it</CardTitle>
              {t.affectedCustomers.length === 0 ? (
                <EmptyState title="No customer has received this">Nothing of this lot, or made from it, has been sent to a customer.</EmptyState>
              ) : (
                <ul className="flex flex-col divide-y divide-line text-[14px]">
                  {t.affectedCustomers.map((c) => (
                    <li key={`${c.shipmentId}:${c.lotId}`} className="flex flex-col gap-0.5 py-2">
                      <span className="font-medium">{c.customerName}</span>
                      <span className="text-fg-2">
                        {fmtLotQty(c.qty, c.uom)} of {c.productName} · sent {fmtDateTime(c.dispatchedAt)}
                      </span>
                      <span className="text-[12px] text-muted">
                        <Link className="text-primary-text hover:underline" href={`/sales/${c.orderId}`}>
                          order {c.orderNumber}
                        </Link>{" "}
                        · delivery receipt {c.drNumber} ·{" "}
                        <Link className="font-mono text-primary-text hover:underline" href={`/inventory/${c.lotId}`}>
                          {c.lotNumber}
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
