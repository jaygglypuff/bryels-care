import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getSupplierReturn, returnableLots } from "@/modules/procurement";
import { Card, CardTitle, Dl, EmptyState, Field, Input, LinkButton, PageHeader, Select, Table, Td, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { Banner, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { addReturnLineAction, cancelReturnAction, decideReturnAction, postReturnAction, removeReturnLineAction, submitReturnAction } from "../../actions";
import { SrChip, Steps, SubNav, fmtBase, money } from "../../_ui";

export const dynamic = "force-dynamic";

export default async function SupplierReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.supplier_return.view")) return <Forbidden what="supplier returns" />;
  const { id } = await params;
  let v: Awaited<ReturnType<typeof getSupplierReturn>>;
  try {
    v = await getSupplierReturn(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Supplier return not found" action={<LinkButton href="/procurement/returns" variant="secondary">Supplier returns</LinkButton>}>
          It does not exist or is not at one of your sites.
        </EmptyState>
      );
    }
    throw e;
  }
  const { sr, can } = v;
  const lots = can.edit ? (await returnableLots(ctx, v.supplier.id)).filter((l) => l.returnable) : [];
  return (
    <>
      <PageHeader title={sr.returnNumber} subtitle={`${v.supplier.name} · ${v.site?.code ?? ""}`} actions={<LinkButton href="/procurement/returns" variant="secondary">Supplier returns</LinkButton>} />
      <SubNav />
      <div className="flex flex-col gap-5">
        {sr.status === "posted" && <Banner tone="ok" title="Stock issued">Each line was posted as an issue movement from its location. The expected credit is followed up on the supplier bill.</Banner>}
        <Card>
          <CardTitle action={<SrChip status={sr.status} />}>Return</CardTitle>
          <Dl
            items={[
              ["Supplier", `${v.supplier.name} (${v.supplier.code})`],
              ["Reason", `${sr.reasonCode.replace(/_/g, " ")}${sr.reasonNote ? ` — ${sr.reasonNote}` : ""}`],
              ["Receipt", v.receipt ? <Link key="r" className="text-primary-text hover:underline" href={`/inventory/receive/${v.receipt.id}`}>{v.receipt.receiptNumber}</Link> : "—"],
              ["Purchase order", v.po ? <Link key="p" className="text-primary-text hover:underline" href={`/procurement/orders/${v.po.id}`}>{v.po.poNumber}</Link> : "—"],
              ["Supplier RMA", sr.supplierRmaReference ?? "—"],
              ...(can.seePrices ? ([["Expected credit", sr.creditExpectedAmount ? money(sr.creditExpectedAmount, sr.currency) : "not recorded (counts as above the threshold)"]] as [string, string][]) : []),
              ["Posted", sr.postedAt ? fmtDateTime(sr.postedAt) : "—"],
              ...(sr.cancelReason ? ([["Cancelled", sr.cancelReason]] as [string, string][]) : []),
            ]}
          />
        </Card>
        <Card>
          <CardTitle>Lots going back</CardTitle>
          {v.lines.length === 0 ? (
            <p className="text-[13px] text-muted">No lines yet.</p>
          ) : (
            <Table head={["#", "Lot", "Material", "From", "Quantity", ...(can.seePrices ? ["Credit"] : []), "Movement", ""]}>
              {v.lines.map((l) => (
                <tr key={l.id}>
                  <Td>{l.lineNo}</Td>
                  <Td>
                    <span className="inline-flex flex-wrap items-center gap-1">
                      {l.lotNumber} <StatusChip status={l.lotStatus} />
                    </span>
                    <div className="text-[12px] text-muted">{l.supplierLot}</div>
                  </Td>
                  <Td>{l.materialCode}</Td>
                  <Td>{l.locationCode}</Td>
                  <Td className="whitespace-nowrap">{fmtBase(l.qtyBase, l.baseUom)}</Td>
                  {can.seePrices && <Td>{l.creditExpectedAmount ? money(l.creditExpectedAmount, l.currency) : "—"}</Td>}
                  <Td>{l.stockMovementId ? "issued" : "—"}</Td>
                  <Td>{can.edit && <ActionForm action={removeReturnLineAction} hidden={{ returnId: sr.id, lineId: l.id }} submit="Remove" variant="ghost" size="sm" />}</Td>
                </tr>
              ))}
            </Table>
          )}
          {can.edit && (
            <div className="mt-4 border-t border-line pt-4">
              {lots.length === 0 ? (
                <p className="text-[13px] text-muted">No rejected lot of this supplier has stock here. QA rejects a lot first (W04-09).</p>
              ) : (
                <ActionForm action={addReturnLineAction} hidden={{ returnId: sr.id }} submit="Add line" variant="secondary" className="grid gap-3 sm:grid-cols-4 sm:items-end">
                  <Field label="Rejected lot and location" htmlFor="lotLocation">
                    <Select id="lotLocation" name="lotLocation" required defaultValue="">
                      <option value="" disabled>
                        Choose…
                      </option>
                      {lots.map((l) => (
                        <option key={`${l.lotId}|${l.locationId}`} value={`${l.lotId}|${l.locationId}`}>
                          {l.lotNumber} · {l.materialCode} · {fmtBase(l.qty, l.baseUom)} at {l.locationCode}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Quantity" htmlFor="qty">
                    <Input id="qty" name="qty" inputMode="decimal" required />
                  </Field>
                  <Field label="Unit" htmlFor="uom" hint="Blank = the lot's base unit.">
                    <Input id="uom" name="uom" />
                  </Field>
                  {can.seePrices && (
                    <Field label="Expected credit" htmlFor="creditExpectedAmount" hint="Blank = from the PO price.">
                      <Input id="creditExpectedAmount" name="creditExpectedAmount" inputMode="decimal" />
                    </Field>
                  )}
                </ActionForm>
              )}
            </div>
          )}
        </Card>
        <Card>
          <CardTitle>Approval and posting</CardTitle>
          <Steps steps={v.progress.steps} />
          <div className="mt-3 flex flex-col gap-3">
            {can.submit && <ActionForm action={submitReturnAction} hidden={{ returnId: sr.id }} submit="Submit for approval" variant="cta" />}
            {can.decide && (
              <div className="grid gap-3 sm:grid-cols-2">
                <ActionForm action={decideReturnAction} hidden={{ returnId: sr.id, decision: "approve" }} submit="Approve" variant="cta">
                  <Input name="note" placeholder="Note (optional)" aria-label="Note" />
                </ActionForm>
                <ActionForm action={decideReturnAction} hidden={{ returnId: sr.id, decision: "return" }} submit="Return to draft" variant="secondary">
                  <Input name="note" placeholder="What must change?" aria-label="Reason" required />
                </ActionForm>
              </div>
            )}
            {can.post && <ActionForm action={postReturnAction} hidden={{ returnId: sr.id, idempotencyKey: randomUUID() }} submit="Post: goods leave the site" variant="cta" confirm="Issue the stock of every line to the supplier now?" />}
            {sr.status === "approved" && !can.post && <p className="text-[13px] text-muted">Posting is done by someone other than the approver, with the post permission (warehouse or procurement).</p>}
            {can.cancel && (
              <details>
                <summary className="cursor-pointer text-[14px] text-[var(--bad-fg)]">Cancel the return</summary>
                <ActionForm action={cancelReturnAction} hidden={{ returnId: sr.id }} submit="Cancel return" variant="danger" confirm="Cancel this supplier return?">
                  <Textarea name="reason" rows={2} placeholder="Reason" aria-label="Reason" required />
                </ActionForm>
              </details>
            )}
          </div>
        </Card>
        <Card>
          <CardTitle>History</CardTitle>
          <ol className="flex flex-col gap-1 text-[13px]">
            {v.transitions.map((t) => (
              <li key={t.id}>
                {fmtDateTime(t.occurredAt)} · {t.fromState ?? "—"} → <strong>{t.toState}</strong> · {t.actorName}
                {t.reason ? ` — ${t.reason}` : ""}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
