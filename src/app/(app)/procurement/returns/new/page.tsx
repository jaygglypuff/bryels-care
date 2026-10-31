import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { supplierOptions } from "@/modules/masterdata";
import { recentReceiptsOfSupplier, returnReasonOptions, returnableLots } from "@/modules/procurement";
import { Card, CardTitle, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { createReturnAction } from "../../actions";
import { SubNav, fmtBase } from "../../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Send something back" };

/** New supplier return (W04-09): pick the supplier by name, see its lots here, say why; the number is made by the server. */
export default async function NewSupplierReturnPage({ searchParams }: { searchParams: Promise<{ supplier?: string; q?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.supplier_return.create")) return <Forbidden what="sending goods back to suppliers" />;
  const { supplier, q } = await searchParams;
  const sups = await supplierOptions(ctx);
  const chosen = sups.find((s) => s.id === supplier) ?? null;
  const [reasons, receipts, lots] = chosen ? await Promise.all([returnReasonOptions(ctx), recentReceiptsOfSupplier(ctx, chosen.id), returnableLots(ctx, chosen.id)]) : [[], [], []];
  const needle = (q ?? "").trim().toLowerCase();
  const found = needle ? sups.filter((s) => s.name.toLowerCase().includes(needle) || s.code.toLowerCase().includes(needle)) : sups;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Send something back" subtitle={`From ${ctx.currentSite.name}`} actions={<LinkButton href="/procurement/returns" variant="secondary">All returns</LinkButton>} />
      <PageIntro>This screen is for starting a return to a supplier: pick the supplier, say why, then add the lots on the next screen. The return number is made for you.</PageIntro>
      <SubNav />
      {!chosen ? (
        <Card>
          <CardTitle>1. Which supplier?</CardTitle>
          <form method="get" role="search" className="mb-3 flex flex-wrap items-center gap-2">
            <label htmlFor="sr-q" className="sr-only">Find a supplier</label>
            <input id="sr-q" name="q" defaultValue={q ?? ""} placeholder="Type part of the supplier's name" autoComplete="off" className="min-h-[48px] min-w-0 flex-1 rounded-[12px] border border-line bg-surface px-3 text-[16px]" />
            <button type="submit" className="inline-flex min-h-[48px] items-center rounded-full border border-line px-5 text-[15px] font-medium hover:bg-surface-2">Find</button>
          </form>
          {found.length === 0 ? (
            <EmptyState title="No supplier with that name" action={<LinkButton href="/procurement/returns/new" variant="secondary">Show all suppliers</LinkButton>}>Try fewer letters.</EmptyState>
          ) : (
            <PlainList label="Suppliers">
              {found.map((s) => (
                <PlainRow key={s.id} href={`/procurement/returns/new?supplier=${s.id}`} title={s.name} code={s.code} />
              ))}
            </PlainList>
          )}
        </Card>
      ) : (
        <Card>
          <CardTitle>2. Send back to {chosen.name}</CardTitle>
          <p className="mb-2 text-[14px] text-fg-2">
            <a className="text-primary-text underline" href="/procurement/returns/new">
              Pick another supplier
            </a>
          </p>
          {lots.length === 0 ? (
            <p className="mb-3 text-[14px] text-fg-2">This supplier has no lots here waiting for QA, on hold or marked “Not OK”. You can still start the return; QA must mark a lot “Not OK” before it can be added.</p>
          ) : (
            <>
              <p className="mb-2 text-[14px] font-medium">Their lots here</p>
              <ul className="mb-4 flex flex-col divide-y divide-line rounded-[14px] border border-line">
                {lots.map((l) => (
                  <li key={`${l.lotId}-${l.locationId}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[14px]">
                    <span className="font-medium">{l.materialName ?? l.materialCode}</span>
                    <StatusChip status={l.status} />
                    <span className="text-fg-2">
                      {fmtBase(l.qty, l.baseUom)} at {l.locationCode}
                    </span>
                    <span className="font-mono text-[12px] text-muted">{l.lotNumber}</span>
                    {!l.returnable && <span className="w-full text-[13px] text-muted">QA must mark it “Not OK” first.</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <ActionForm action={createReturnAction} hidden={{ supplierId: chosen.id }} submit="Start the return" pending="Starting…" variant="cta">
            {(fe) => (
              <>
                <Field label="Why does it go back?" htmlFor="reasonCode" error={fe.reasonCode}>
                  <Select id="reasonCode" name="reasonCode" defaultValue="rejected_at_inspection" required>
                    {reasons.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                        {r.requiresNote ? " (explain below)" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Explain (needed for some reasons)" htmlFor="reasonNote" error={fe.reasonNote}>
                  <Input id="reasonNote" name="reasonNote" />
                </Field>
                <MoreDetails>
                  <Field label="From which delivery" htmlFor="goodsReceiptId">
                    <Select id="goodsReceiptId" name="goodsReceiptId" defaultValue="">
                      <option value="">Not sure / several</option>
                      {receipts.map((r) => (
                        <option key={r.id} value={r.id}>
                          {fmtDate(r.receivedAt)} · {r.receiptNumber}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Supplier's return number (if they gave one)" htmlFor="supplierRmaReference">
                    <Input id="supplierRmaReference" name="supplierRmaReference" />
                  </Field>
                </MoreDetails>
              </>
            )}
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
