import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getSupplier } from "@/modules/masterdata";
import { aslMaterialOptions, listSupplierMaterials } from "@/modules/procurement";
import { Card, CardTitle, Dl, EmptyState, Field, Input, LinkButton, PageHeader, Select, Table, Td } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { decideChangeAction, packAction, proposeChangeAction, proposePairAction, termsAction, withdrawChangeAction } from "../../actions";
import { SubNav, money } from "../../_ui";

export const dynamic = "force-dynamic";

/**
 * One supplier's approved-material list (US-6-01, W04-11): pairs, the pending proposal, QA's decision
 * form (never offered to the proposer), and the cost terms (price, MOQ, lead time) for price editors.
 */
export default async function SupplierAslPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.supplier.view")) return <Forbidden what="suppliers" />;
  const { id } = await params;
  let s: Awaited<ReturnType<typeof getSupplier>>;
  try {
    s = await getSupplier(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return <EmptyState title="Supplier not found" action={<LinkButton href="/procurement/suppliers" variant="secondary">Approved suppliers</LinkButton>}>It does not exist.</EmptyState>;
    throw e;
  }
  const rows = await listSupplierMaterials(ctx, s.id);
  const canPropose = ctx.can("masterdata.supplier.edit");
  const canDecide = ctx.can("masterdata.supplier.approve");
  const canTerms = ctx.can("masterdata.supplier_price.edit");
  const seePrices = ctx.can("masterdata.supplier_price.view");
  const mats = canPropose ? (await aslMaterialOptions(ctx)).filter((m) => !rows.some((r) => r.materialId === m.id && (r.isApproved || r.pending))) : [];
  return (
    <>
      <PageHeader title={s.name} subtitle={`${s.code} · approved-material list and terms`} actions={<LinkButton href="/procurement/suppliers" variant="secondary">Approved suppliers</LinkButton>} />
      <SubNav />
      <div className="flex flex-col gap-5">
        {s.qualityStatus === "suspended" && <Banner tone="bad" title="Supplier suspended">{s.qualityStatusReason ?? "No purchase order lines or receipts until the status is resolved (V-ASL)."}</Banner>}
        <Card>
          <CardTitle action={<Chip tone={s.qualityStatus === "approved" ? "ok" : s.qualityStatus === "suspended" ? "bad" : "warn"}>{s.qualityStatus}</Chip>}>Supplier</CardTitle>
          <Dl items={[["Contact", [s.contactName, s.email, s.phone].filter(Boolean).join(" · ") || "—"], ["Payment terms", s.paymentTermsDays !== null ? `${s.paymentTermsDays} days` : "—"], ["Default lead time", s.defaultLeadTimeDays !== null ? `${s.defaultLeadTimeDays} days` : "—"]]} />
        </Card>
        <Card>
          <CardTitle>Approved-material list</CardTitle>
          {rows.length === 0 ? (
            <p className="text-[13px] text-muted">No materials proposed for this supplier yet.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {rows.map((r) => (
                <section key={r.id} className="rounded-[14px] border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <strong>{r.materialCode}</strong> · {r.materialName}
                      {r.supplierPartNumber && <span className="text-[12px] text-muted"> · part {r.supplierPartNumber}</span>}
                    </div>
                    <Chip tone={r.isApproved ? "ok" : r.suspendedReason ? "bad" : "neu"}>{r.isApproved ? "Approved" : r.suspendedReason ? "Suspended" : "Not approved"}</Chip>
                  </div>
                  <p className="mt-1 text-[13px] text-muted">
                    {r.brand && `Brand ${r.brand} · `}
                    {r.packQty && `Pack ${Number(r.packQty).toLocaleString("en-PH", { maximumFractionDigits: 6 })} ${r.packUom} · `}
                    Lead time {r.leadTimeDays ?? "—"} d · MOQ {r.moqQty ? `${Number(r.moqQty)} ${r.moqUom}` : "—"}
                    {seePrices && ` · price ${r.unitPrice ? `${money(r.unitPrice, r.currency ?? "PHP")}/${r.priceUom}` : "—"}${r.priceEffectiveFrom ? ` from ${fmtDate(r.priceEffectiveFrom)}` : ""}`}
                    {r.approvedAt && ` · decided ${fmtDate(r.approvedAt)}`}
                    {r.auditDate && ` · audit ${fmtDate(r.auditDate)}`}
                    {r.suspendedReason && ` · ${r.suspendedReason}`}
                  </p>
                  {r.pending ? (
                    <div className="mt-2 rounded-[10px] bg-surface-2 p-2 text-[13px]">
                      <p>
                        <strong>{r.pending.action === "suspend" ? "Suspension" : "Approval"} proposed</strong> by {r.pending.proposedByName}, {fmtDateTime(r.pending.proposedAt)}: {r.pending.note}
                      </p>
                      {canDecide && r.pending.proposedBy !== ctx.userId && (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <ActionForm action={decideChangeAction} hidden={{ changeId: r.pending.id, decision: "approved" }} submit={r.pending.action === "suspend" ? "Approve suspension" : "Approve pair"} variant="cta" size="sm">
                            <Input name="note" placeholder="Evidence checked (optional)" aria-label="Note" />
                          </ActionForm>
                          <ActionForm action={decideChangeAction} hidden={{ changeId: r.pending.id, decision: "rejected" }} submit="Reject proposal" variant="secondary" size="sm">
                            <Input name="note" placeholder="Why rejected" aria-label="Reason" required />
                          </ActionForm>
                        </div>
                      )}
                      {canDecide && r.pending.proposedBy === ctx.userId && <p className="mt-1 text-muted">You proposed this change, so another QA person decides it.</p>}
                      {r.pending.proposedBy === ctx.userId && <ActionForm action={withdrawChangeAction} hidden={{ changeId: r.pending.id }} submit="Withdraw proposal" variant="ghost" size="sm" className="mt-1" />}
                    </div>
                  ) : (
                    canPropose && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[13px] text-primary-text">{r.isApproved ? "Propose suspension" : "Propose approval"}</summary>
                        <ActionForm action={proposeChangeAction} hidden={{ supplierMaterialId: r.id, action: r.isApproved ? "suspend" : "approve" }} submit="Send to QA" variant="secondary" size="sm" className="mt-2 grid gap-2 sm:grid-cols-3 sm:items-end">
                          <Field label="Reason / evidence" htmlFor={`note-${r.id}`}>
                            <Input id={`note-${r.id}`} name="note" required />
                          </Field>
                          <Field label="Audit date" htmlFor={`audit-${r.id}`}>
                            <Input id={`audit-${r.id}`} type="date" name="auditDate" />
                          </Field>
                        </ActionForm>
                      </details>
                    )
                  )}
                  {canPropose && (
                    <details className="mt-2">
                      <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[13px] text-primary-text">Brand and pack size</summary>
                      <ActionForm action={packAction} hidden={{ supplierMaterialId: r.id }} submit="Save brand and pack" variant="secondary" className="mt-2 grid gap-2 sm:grid-cols-3 sm:items-end">
                        <Field label="Brand (optional)" htmlFor={`b-${r.id}`} hint="Filled in when receiving from this supplier.">
                          <Input id={`b-${r.id}`} name="brand" defaultValue={r.brand ?? ""} maxLength={80} placeholder="e.g. Golden Palm" />
                        </Field>
                        <Field label="Pack size (optional)" htmlFor={`pq-${r.id}`} hint="e.g. 18 for an 18 L tin.">
                          <Input id={`pq-${r.id}`} name="packQty" inputMode="decimal" defaultValue={r.packQty ? String(Number(r.packQty)) : ""} />
                        </Field>
                        <Field label="Pack unit" htmlFor={`pk-${r.id}`}>
                          <Input id={`pk-${r.id}`} name="packUom" defaultValue={r.packUom ?? ""} placeholder={r.baseUom} />
                        </Field>
                      </ActionForm>
                    </details>
                  )}
                  {canTerms && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[13px] text-primary-text">Edit price, MOQ, lead time</summary>
                      <ActionForm action={termsAction} hidden={{ supplierMaterialId: r.id }} submit="Save terms" variant="secondary" size="sm" className="mt-2 grid gap-2 sm:grid-cols-4 sm:items-end">
                        <Field label="Unit price" htmlFor={`p-${r.id}`}>
                          <Input id={`p-${r.id}`} name="unitPrice" inputMode="decimal" defaultValue={r.unitPrice ?? ""} />
                        </Field>
                        <Field label="Price per (unit)" htmlFor={`pu-${r.id}`}>
                          <Input id={`pu-${r.id}`} name="priceUom" defaultValue={r.priceUom ?? ""} placeholder="kg" />
                        </Field>
                        <Field label="Currency" htmlFor={`c-${r.id}`}>
                          <Input id={`c-${r.id}`} name="currency" defaultValue={r.currency ?? "PHP"} />
                        </Field>
                        <Field label="Effective from" htmlFor={`e-${r.id}`}>
                          <Input id={`e-${r.id}`} type="date" name="priceEffectiveFrom" defaultValue={r.priceEffectiveFrom ?? ""} />
                        </Field>
                        <Field label="MOQ" htmlFor={`m-${r.id}`}>
                          <Input id={`m-${r.id}`} name="moqQty" inputMode="decimal" defaultValue={r.moqQty ? String(Number(r.moqQty)) : ""} />
                        </Field>
                        <Field label="MOQ unit" htmlFor={`mu-${r.id}`}>
                          <Input id={`mu-${r.id}`} name="moqUom" defaultValue={r.moqUom ?? ""} />
                        </Field>
                        <Field label="Lead time (days)" htmlFor={`l-${r.id}`}>
                          <Input id={`l-${r.id}`} name="leadTimeDays" inputMode="numeric" defaultValue={r.leadTimeDays ?? ""} />
                        </Field>
                        <Field label="Supplier part no." htmlFor={`sp-${r.id}`}>
                          <Input id={`sp-${r.id}`} name="supplierPartNumber" defaultValue={r.supplierPartNumber ?? ""} />
                        </Field>
                      </ActionForm>
                    </details>
                  )}
                  {r.history.length > 0 && (
                    <ul className="mt-2 text-[12px] text-muted">
                      {r.history.map((h) => (
                        <li key={h.id}>
                          {h.action} {h.status} {h.decidedAt ? fmtDate(h.decidedAt) : ""} · proposed by {h.proposedByName}: {h.note}
                          {h.decisionNote ? ` — ${h.decisionNote}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
        </Card>
        {canPropose && mats.length > 0 && (
          <Card>
            <CardTitle>Propose a material for this supplier</CardTitle>
            <ActionForm action={proposePairAction} hidden={{ supplierId: s.id }} submit="Propose to QA" variant="cta" className="grid gap-3 sm:grid-cols-4 sm:items-end">
              <Field label="Material" htmlFor="materialId">
                <Select id="materialId" name="materialId" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {mats.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} · {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Supplier part no." htmlFor="supplierPartNumber">
                <Input id="supplierPartNumber" name="supplierPartNumber" />
              </Field>
              <Field label="Evidence for QA" htmlFor="note">
                <Input id="note" name="note" required />
              </Field>
              <Field label="Audit date" htmlFor="auditDate">
                <Input id="auditDate" type="date" name="auditDate" />
              </Field>
            </ActionForm>
          </Card>
        )}
        <Card>
          <CardTitle>Receipts at your sites</CardTitle>
          {s.receipts.length === 0 ? (
            <p className="text-[13px] text-muted">None.</p>
          ) : (
            <Table head={["Receipt", "Status", "Delivery note", "Received"]}>
              {s.receipts.map((g) => (
                <tr key={g.id}>
                  <Td>{g.receiptNumber ?? "draft"}</Td>
                  <Td>{g.status}</Td>
                  <Td>{g.supplierDocumentNumber ?? "—"}</Td>
                  <Td>{fmtDateTime(g.receivedAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
