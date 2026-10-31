import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getSupplier } from "@/modules/masterdata";
import { aslMaterialOptions, listSupplierMaterials } from "@/modules/procurement";
import { Card, CardTitle, Dl, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { RecordNo } from "@/ui/plain-list";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { decideChangeAction, packAction, proposeChangeAction, proposePairAction, termsAction, withdrawChangeAction } from "../../actions";
import { SubNav, SupplierChip, money } from "../../_ui";

export const dynamic = "force-dynamic";

const summaryCls = "inline-flex min-h-[44px] cursor-pointer items-center text-[14px] text-primary-text";

/**
 * One supplier (US-6-01, W04-11): the items we may buy from them, QA's yes/no on suggestions (never offered to
 * the person who suggested), and price, minimum order and delivery time for people who may change prices.
 */
export default async function SupplierAslPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.supplier.view")) return <Forbidden what="suppliers" />;
  const { id } = await params;
  let s: Awaited<ReturnType<typeof getSupplier>>;
  try {
    s = await getSupplier(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return <EmptyState title="Supplier not found" action={<LinkButton href="/procurement/suppliers" variant="secondary">All suppliers</LinkButton>}>It does not exist. Ask purchasing.</EmptyState>;
    throw e;
  }
  const rows = await listSupplierMaterials(ctx, s.id);
  const canPropose = ctx.can("masterdata.supplier.edit");
  const canDecide = ctx.can("masterdata.supplier.approve");
  const canTerms = ctx.can("masterdata.supplier_price.edit");
  const seePrices = ctx.can("masterdata.supplier_price.view");
  const mats = canPropose ? (await aslMaterialOptions(ctx)).filter((m) => !rows.some((r) => r.materialId === m.id && (r.isApproved || r.pending))) : [];
  const toDecide = canDecide ? rows.filter((r) => r.pending && r.pending.proposedBy !== ctx.userId) : [];
  const approved = rows.filter((r) => r.isApproved);
  const canOrder = ctx.can("procurement.purchase_order.create") && approved.length > 0 && s.qualityStatus !== "suspended";
  return (
    <>
      <PageHeader
        title={s.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            Supplier · <RecordNo>{s.code}</RecordNo> <SupplierChip status={s.qualityStatus} />
          </span>
        }
        actions={<LinkButton href="/procurement/suppliers" variant="secondary">All suppliers</LinkButton>}
      />
      <PageIntro>This screen is for one supplier: which items we may buy from them, their prices and delivery times, and QA&apos;s yes or no on new items.</PageIntro>
      {toDecide.length > 0 ? (
        <NextStep text={`Next: ${toDecide.length} suggestion(s) wait for your yes or no.`} action={{ label: "Decide", href: `#item-${toDecide[0].id}` }} />
      ) : canOrder ? (
        <NextStep text={`You may buy ${approved.length} item(s) from ${s.name}.`} action={{ label: "Order from this supplier", href: `/procurement/orders/new?supplier=${s.id}` }} />
      ) : canPropose && approved.length === 0 ? (
        <NextStep text="Nothing may be bought from this supplier yet." action={{ label: "Suggest an item", href: "#suggest" }} />
      ) : null}
      <SubNav />
      <div className="flex flex-col gap-5">
        {s.qualityStatus === "suspended" && <Banner tone="bad" title="Stopped – do not buy">{s.qualityStatusReason ?? "No purchase orders or deliveries until QA lifts the stop."}</Banner>}
        <Card>
          <CardTitle>Contact</CardTitle>
          <Dl items={[["Contact", [s.contactName, s.email, s.phone].filter(Boolean).join(" · ") || "—"], ["We pay within", s.paymentTermsDays !== null ? `${s.paymentTermsDays} days` : "—"], ["Usual delivery time", s.defaultLeadTimeDays !== null ? `${s.defaultLeadTimeDays} days` : "—"]]} />
        </Card>
        <Card>
          <CardTitle>Items from this supplier</CardTitle>
          {rows.length === 0 ? (
            <p className="text-[14px] text-fg-2">No items suggested for this supplier yet.{canPropose ? " Suggest one below." : " Purchasing suggests items; QA approves them."}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {rows.map((r) => (
                <li key={r.id} id={`item-${r.id}`} className="scroll-mt-24 rounded-[14px] border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0">
                      <span className="font-semibold">{r.materialName}</span> <span className="font-mono text-[12px] text-muted">{r.materialCode}</span>
                    </p>
                    <Chip tone={r.isApproved ? "ok" : r.suspendedReason ? "bad" : "neu"}>{r.isApproved ? "Yes – may buy" : r.suspendedReason ? "Stopped" : "Not yet approved"}</Chip>
                  </div>
                  <p className="mt-1 text-[14px] text-fg-2">
                    {seePrices && r.unitPrice ? `${money(r.unitPrice, r.currency ?? "PHP")} per ${r.priceUom} · ` : ""}
                    {r.packQty ? `comes in ${Number(r.packQty).toLocaleString("en-PH", { maximumFractionDigits: 6 })} ${r.packUom} packs · ` : ""}
                    {r.moqQty ? `order at least ${Number(r.moqQty).toLocaleString("en-PH")} ${r.moqUom} · ` : ""}
                    {r.leadTimeDays !== null ? `takes ${r.leadTimeDays} day(s)` : "delivery time not set"}
                    {r.brand ? ` · brand ${r.brand}` : ""}
                  </p>
                  {(r.approvedAt || r.auditDate || r.suspendedReason || r.supplierPartNumber || r.priceEffectiveFrom) && (
                    <p className="text-[13px] text-muted">
                      {r.approvedAt && `QA decided ${fmtDate(r.approvedAt)}`}
                      {r.auditDate && ` · audit ${fmtDate(r.auditDate)}`}
                      {r.suspendedReason && ` · ${r.suspendedReason}`}
                      {r.supplierPartNumber && ` · their item number ${r.supplierPartNumber}`}
                      {seePrices && r.priceEffectiveFrom && ` · price from ${fmtDate(r.priceEffectiveFrom)}`}
                    </p>
                  )}
                  {r.pending ? (
                    <div className="mt-2 rounded-[10px] bg-surface-2 p-3 text-[14px]">
                      <p>
                        <strong>{r.pending.action === "suspend" ? "Stop buying" : "Start buying"} — suggested</strong> by {r.pending.proposedByName}, {fmtDateTime(r.pending.proposedAt)}: {r.pending.note}
                      </p>
                      {canDecide && r.pending.proposedBy !== ctx.userId && (
                        <div className="mt-2 grid gap-3 sm:grid-cols-2">
                          <ActionForm action={decideChangeAction} hidden={{ changeId: r.pending.id, decision: "approved" }} submit={r.pending.action === "suspend" ? "Yes, stop buying" : "Yes, we may buy it"} variant="cta">
                            <Input name="note" placeholder="What you checked (you can skip this)" aria-label="What you checked" />
                          </ActionForm>
                          <ActionForm action={decideChangeAction} hidden={{ changeId: r.pending.id, decision: "rejected" }} submit="No" variant="secondary">
                            <Input name="note" placeholder="Why not" aria-label="Why not" required />
                          </ActionForm>
                        </div>
                      )}
                      {canDecide && r.pending.proposedBy === ctx.userId && <p className="mt-1 text-muted">You suggested this, so another QA person decides.</p>}
                      {r.pending.proposedBy === ctx.userId && <ActionForm action={withdrawChangeAction} hidden={{ changeId: r.pending.id }} submit="Take back my suggestion" variant="ghost" className="mt-1" />}
                    </div>
                  ) : (
                    canPropose && (
                      <details className="mt-1">
                        <summary className={summaryCls}>{r.isApproved ? "Suggest we stop buying it" : "Suggest we may buy it"}</summary>
                        <ActionForm action={proposeChangeAction} hidden={{ supplierMaterialId: r.id, action: r.isApproved ? "suspend" : "approve" }} submit="Send to QA" variant="secondary">
                          <Field label="Why (what QA should know)" htmlFor={`note-${r.id}`}>
                            <Input id={`note-${r.id}`} name="note" required />
                          </Field>
                          <MoreDetails>
                            <Field label="Audit date" htmlFor={`audit-${r.id}`}>
                              <Input id={`audit-${r.id}`} type="date" name="auditDate" />
                            </Field>
                          </MoreDetails>
                        </ActionForm>
                      </details>
                    )
                  )}
                  {canTerms && (
                    <details className="mt-1">
                      <summary className={summaryCls}>Change price, minimum order or delivery time</summary>
                      <ActionForm action={termsAction} hidden={{ supplierMaterialId: r.id }} submit="Save" variant="secondary">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="Price (₱)" htmlFor={`p-${r.id}`}>
                            <Input id={`p-${r.id}`} name="unitPrice" inputMode="decimal" defaultValue={r.unitPrice ?? ""} />
                          </Field>
                          <Field label="Price is per" htmlFor={`pu-${r.id}`} hint="For example kg, L, pcs.">
                            <Input id={`pu-${r.id}`} name="priceUom" defaultValue={r.priceUom ?? ""} placeholder="kg" />
                          </Field>
                          <Field label="Order at least" htmlFor={`m-${r.id}`}>
                            <Input id={`m-${r.id}`} name="moqQty" inputMode="decimal" defaultValue={r.moqQty ? String(Number(r.moqQty)) : ""} />
                          </Field>
                          <Field label="Unit of that minimum" htmlFor={`mu-${r.id}`}>
                            <Input id={`mu-${r.id}`} name="moqUom" defaultValue={r.moqUom ?? ""} placeholder="kg" />
                          </Field>
                          <Field label="Days to deliver" htmlFor={`l-${r.id}`}>
                            <Input id={`l-${r.id}`} name="leadTimeDays" inputMode="numeric" defaultValue={r.leadTimeDays ?? ""} />
                          </Field>
                        </div>
                        <MoreDetails>
                          <Field label="Currency" htmlFor={`c-${r.id}`}>
                            <Input id={`c-${r.id}`} name="currency" defaultValue={r.currency ?? "PHP"} />
                          </Field>
                          <Field label="Price starts on" htmlFor={`e-${r.id}`}>
                            <Input id={`e-${r.id}`} type="date" name="priceEffectiveFrom" defaultValue={r.priceEffectiveFrom ?? ""} />
                          </Field>
                          <Field label="Supplier's own item number" htmlFor={`sp-${r.id}`}>
                            <Input id={`sp-${r.id}`} name="supplierPartNumber" defaultValue={r.supplierPartNumber ?? ""} />
                          </Field>
                        </MoreDetails>
                      </ActionForm>
                    </details>
                  )}
                  {canPropose && (
                    <details className="mt-1">
                      <summary className={summaryCls}>Brand and pack size</summary>
                      <ActionForm action={packAction} hidden={{ supplierMaterialId: r.id }} submit="Save brand and pack" variant="secondary">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <Field label="Brand (optional)" htmlFor={`b-${r.id}`} hint="Filled in when receiving from this supplier.">
                            <Input id={`b-${r.id}`} name="brand" defaultValue={r.brand ?? ""} maxLength={80} placeholder="e.g. Golden Palm" />
                          </Field>
                          <Field label="Pack size (optional)" htmlFor={`pq-${r.id}`} hint="e.g. 18 for an 18 L tin.">
                            <Input id={`pq-${r.id}`} name="packQty" inputMode="decimal" defaultValue={r.packQty ? String(Number(r.packQty)) : ""} />
                          </Field>
                          <Field label="Pack unit" htmlFor={`pk-${r.id}`}>
                            <Input id={`pk-${r.id}`} name="packUom" defaultValue={r.packUom ?? ""} placeholder={r.baseUom} />
                          </Field>
                        </div>
                      </ActionForm>
                    </details>
                  )}
                  {r.history.length > 0 && (
                    <details className="mt-1">
                      <summary className={summaryCls}>Earlier decisions ({r.history.length})</summary>
                      <ul className="text-[13px] text-muted">
                        {r.history.map((h) => (
                          <li key={h.id}>
                            {h.action === "suspend" ? "Stop" : "Start"} buying: {h.status} {h.decidedAt ? fmtDate(h.decidedAt) : ""} · suggested by {h.proposedByName}: {h.note}
                            {h.decisionNote ? ` — ${h.decisionNote}` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {canPropose && mats.length > 0 && (
          <Card>
            <span id="suggest" className="block scroll-mt-24" />
            <CardTitle>Suggest an item for this supplier</CardTitle>
            <ActionForm action={proposePairAction} hidden={{ supplierId: s.id }} submit="Send to QA" variant="cta">
              <Field label="Item" htmlFor="materialId">
                <Select id="materialId" name="materialId" required defaultValue="">
                  <option value="" disabled>
                    Pick an item…
                  </option>
                  {[...mats]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="What QA should know (papers, samples, audit)" htmlFor="note">
                <Input id="note" name="note" required />
              </Field>
              <MoreDetails>
                <Field label="Supplier's own item number" htmlFor="supplierPartNumber">
                  <Input id="supplierPartNumber" name="supplierPartNumber" />
                </Field>
                <Field label="Audit date" htmlFor="auditDate">
                  <Input id="auditDate" type="date" name="auditDate" />
                </Field>
              </MoreDetails>
            </ActionForm>
          </Card>
        )}
        <MoreDetails title={`Deliveries from this supplier at your sites (${s.receipts.length})`}>
          {s.receipts.length === 0 ? (
            <p className="text-[14px] text-fg-2">None yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line text-[14px]">
              {s.receipts.map((g) => (
                <li key={g.id} className="py-2">
                  {fmtDateTime(g.receivedAt)} · {g.status === "posted" ? "saved to stock" : g.status}
                  <span className="ml-1 font-mono text-[12px] text-muted">
                    {g.receiptNumber ?? "draft"}
                    {g.supplierDocumentNumber ? ` · supplier paper ${g.supplierDocumentNumber}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </MoreDetails>
      </div>
    </>
  );
}
