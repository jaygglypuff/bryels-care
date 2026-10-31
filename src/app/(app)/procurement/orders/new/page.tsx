import { requireContext } from "@/lib/auth/context";
import { approvedMaterialsFor, convertibleRequestLines, poFormOptions } from "@/modules/procurement";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { SubNav } from "../../_ui";
import { NewOrderWizard, WizardSteps } from "./wizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "New purchase order" };

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); // business day (YYYY-MM-DD)

/**
 * New purchase order as a short wizard (ADR-088): 1 supplier (picked by name, with search) → 2 items → 3 when it
 * should arrive → 4 check and send. Only items on the supplier's approved list are offered; price, pack size and
 * lead time come from the supplier terms; the order number is made by the system. The server re-checks every
 * rule (V-ASL, V-UOM, request state) when the order is saved.
 */
export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ supplier?: string; q?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_order.create")) return <Forbidden what="making purchase orders" />;
  const { supplier, q } = await searchParams;
  const opts = await poFormOptions(ctx);
  const chosen = opts.suppliers.find((s) => s.id === supplier) ?? null;
  const mats = chosen ? await approvedMaterialsFor(ctx, chosen.id) : [];
  const prLines = chosen ? (await convertibleRequestLines(ctx)).filter((l) => mats.some((m) => m.materialId === l.materialId)) : [];
  const prices = ctx.can("masterdata.supplier_price.view");
  const needle = (q ?? "").trim().toLowerCase();
  const found = needle ? opts.suppliers.filter((s) => s.name.toLowerCase().includes(needle) || s.code.toLowerCase().includes(needle)) : opts.suppliers;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New purchase order" subtitle={`For ${ctx.currentSite.name}`} actions={<LinkButton href="/procurement/orders" variant="secondary">All orders</LinkButton>} />
      <PageIntro>This screen is for ordering from a supplier in four short steps: who, what, when, then check and send. The order number is made for you.</PageIntro>
      <SubNav />
      {!chosen ? (
        <Card>
          <WizardSteps current={1} />
          <CardTitle>1. Who do we buy from?</CardTitle>
          <form method="get" role="search" className="mb-3 flex flex-wrap items-center gap-2">
            <label htmlFor="sup-q" className="sr-only">Find a supplier</label>
            <input id="sup-q" name="q" defaultValue={q ?? ""} placeholder="Type part of the supplier's name" autoComplete="off" className="min-h-[48px] min-w-0 flex-1 rounded-[12px] border border-line bg-surface px-3 text-[16px]" />
            <button type="submit" className="inline-flex min-h-[48px] items-center rounded-full border border-line px-5 text-[15px] font-medium hover:bg-surface-2">Find</button>
          </form>
          {opts.suppliers.length === 0 ? (
            <EmptyState title="No supplier we may buy from yet">Suppliers are added under Master data → Suppliers, then QA approves which items we may buy from them.</EmptyState>
          ) : found.length === 0 ? (
            <EmptyState title="No supplier with that name" action={<LinkButton href="/procurement/orders/new" variant="secondary">Show all suppliers</LinkButton>}>Try fewer letters, or ask purchasing to add the supplier.</EmptyState>
          ) : (
            <PlainList label="Suppliers">
              {found.map((s) => (
                <PlainRow
                  key={s.id}
                  testId="pick-supplier"
                  href={`/procurement/orders/new?supplier=${s.id}`}
                  title={s.name}
                  code={s.code}
                  status={s.qualityStatus === "approved" ? undefined : <Chip tone="warn">QA still checking</Chip>}
                  facts={s.paymentTermsDays !== null ? `We pay within ${s.paymentTermsDays} days` : "Payment days not set"}
                />
              ))}
            </PlainList>
          )}
        </Card>
      ) : mats.length === 0 ? (
        <Card>
          <WizardSteps current={2} />
          <EmptyState title={`Nothing we may buy from ${chosen.name} yet`} action={<LinkButton href={`/procurement/suppliers/${chosen.id}`} variant="secondary">Suggest items for this supplier</LinkButton>}>
            QA must first approve which items we may buy from this supplier. Suggest an item on the supplier&apos;s page, or <a className="text-primary-text underline" href="/procurement/orders/new">pick another supplier</a>.
          </EmptyState>
        </Card>
      ) : (
        <NewOrderWizard
          supplier={{ id: chosen.id, name: chosen.name, paymentTermsDays: chosen.paymentTermsDays }}
          materials={[...mats]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((m) => ({ id: m.materialId, name: m.name, code: m.code, baseUom: m.baseUom, leadTimeDays: m.leadTimeDays, moqQty: m.moqQty, moqUom: m.moqUom, packQty: m.packQty, packUom: m.packUom, priceUom: m.priceUom, unitPrice: prices ? m.unitPrice ?? null : null, brand: m.brand }))}
          fromRequests={prLines.map((l) => ({ id: l.id, materialId: l.materialId, requestNumber: l.requestNumber, qty: String(Number(l.qty)), uom: l.uom }))}
          warehouses={opts.warehouses.map((w) => ({ id: w.id, name: w.name, code: w.code }))}
          prices={prices}
          today={today()}
          canSubmit={ctx.can("procurement.purchase_order.submit")}
        />
      )}
    </div>
  );
}
