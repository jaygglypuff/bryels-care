import { requireContext } from "@/lib/auth/context";
import { approvedMaterialsFor, convertibleRequestLines, lastPurchasePrices, poFormOptions, requestCoverHint } from "@/modules/procurement";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Banner, Chip } from "@/ui/status";
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
export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ supplier?: string; q?: string; request?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_order.create")) return <Forbidden what="making purchase orders" permission="procurement.purchase_order.create" />;
  const { supplier, q, request } = await searchParams;
  const opts = await poFormOptions(ctx);
  // ADR-110 C15: "Make the purchase order" on an approved request carries it (?request=): only its lines, and the
  // supplier the request named is chosen for you. The server still checks every line and the approval rule.
  const openLines = await convertibleRequestLines(ctx);
  const fromRequest = request ? openLines.filter((l) => l.requestId === request) : null;
  const named = fromRequest ? [...new Set(fromRequest.map((l) => l.suggestedSupplierId).filter((x): x is string => !!x))] : [];
  const supplierId = supplier ?? (named.length === 1 ? named[0] : undefined);
  const chosen = opts.suppliers.find((s) => s.id === supplierId) ?? null;
  const mats = chosen ? await approvedMaterialsFor(ctx, chosen.id) : [];
  // Only the request's lines when the order is made from a request (ADR-110 C15); otherwise any open request line.
  const prLines = chosen ? (fromRequest ?? openLines).filter((l) => mats.some((m) => m.materialId === l.materialId)) : [];
  const prices = ctx.can("masterdata.supplier_price.view");
  const last = chosen ? await lastPurchasePrices(ctx, chosen.id) : [];
  const needle = (q ?? "").trim().toLowerCase();
  const found = needle ? opts.suppliers.filter((s) => s.name.toLowerCase().includes(needle) || s.code.toLowerCase().includes(needle)) : opts.suppliers;
  const keepRequest = fromRequest?.length ? `request=${request}` : "";
  // ADR-131 (bugs B3/B6): say what the request really named, and what the approval covers.
  const namedChosen = !!chosen && named.includes(chosen.id);
  const namedOther = !!chosen && named.length > 0 && !namedChosen;
  const approvedAmount = fromRequest?.length && fromRequest.every((l) => l.estimatedUnitAmount !== null) ? fromRequest.reduce((s, l) => s + Number(l.qty) * Number(l.estimatedUnitAmount), 0) : null;
  // ADR-132 §12: the request's OKs carry over only when an order of that amount needs no more OKs than it had.
  const hint = approvedAmount !== null && request ? await requestCoverHint(ctx, request, approvedAmount.toFixed(2)).catch(() => null) : null;
  const moreOks = !!hint && hint.requestSteps < hint.orderSteps;
  const neededBy = fromRequest?.map((l) => l.neededByDate).filter((d): d is string => !!d).sort()[0] ?? null;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New purchase order" subtitle={`For ${ctx.currentSite.name}`} actions={<LinkButton href="/procurement/orders" variant="secondary">All orders</LinkButton>} />
      <PageIntro>This screen is for ordering from a supplier in four short steps: who, what, when, then check and send. The order number is made for you.</PageIntro>
      <SubNav />
      {fromRequest && (
        <div className="mb-4">
          {fromRequest.length === 0 ? (
            <Banner tone="warn" title="That request to buy is not waiting to be ordered">It is not approved, is already on a purchase order, or is at another site. Pick the supplier below, or open the request.</Banner>
          ) : (
            <Banner tone={namedOther ? "warn" : "info"} title={`From request to buy ${fromRequest[0].requestNumber}`}>
              {!chosen
                ? named.length === 1
                  ? "Pick the supplier below."
                  : named.length > 1
                    ? "The request names more than one supplier: pick one below."
                    : "The request names no supplier: pick one below."
                : namedChosen
                  ? `Supplier ${chosen.name}, as named on the request.`
                  : namedOther
                    ? `The request named another supplier. With ${chosen.name} the order needs the manager's OK again.`
                    : `You chose ${chosen.name} (the request named no supplier).`}{" "}
              {namedOther
                ? ""
                : approvedAmount !== null
                  ? prices
                    ? moreOks
                      ? `The request was approved for up to ₱${approvedAmount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, with ${hint!.requestSteps === 1 ? "1 OK" : `${hint!.requestSteps} OKs`}. An order this big needs ${hint!.orderSteps} OKs, so the order is sent for its OKs when you save it.`
                      : `The request was approved for up to ₱${approvedAmount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Up to that amount the order needs no second OK; above it, it does.`
                    : "Up to the amount the request was approved for, the order needs no second OK."
                  : "The request had no price, so the order needs an OK of its own."}
            </Banner>
          )}
        </div>
      )}
      {!chosen ? (
        <Card>
          <WizardSteps current={1} />
          <CardTitle>1. Who do we buy from?</CardTitle>
          <form method="get" role="search" className="mb-3 flex flex-wrap items-center gap-2">
            <label htmlFor="sup-q" className="sr-only">Find a supplier</label>
            <input id="sup-q" name="q" defaultValue={q ?? ""} placeholder="Type part of the supplier's name" autoComplete="off" className="min-h-[48px] min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-3 text-[16px]" />
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
                  href={`/procurement/orders/new?supplier=${s.id}${fromRequest?.length ? `&request=${request}` : ""}`}
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
          fromRequests={prLines.map((l) => ({ id: l.id, materialId: l.materialId, requestNumber: l.requestNumber, qty: String(Number(l.qty)), uom: l.uom, price: l.estimatedUnitAmount }))}
          lastPrices={last.map((p) => ({ materialId: p.materialId, unitAmount: p.unitAmount, uom: p.uom, poNumber: p.poNumber, orderDate: p.orderDate }))}
          warehouses={opts.warehouses.map((w) => ({ id: w.id, name: w.name, code: w.code }))}
          prices={prices}
          today={today()}
          neededBy={neededBy}
          approvedAmount={namedOther || moreOks ? null : approvedAmount}
          changeHref={`/procurement/orders/new${keepRequest ? `?${keepRequest}` : ""}`}
          canSubmit={ctx.can("procurement.purchase_order.submit")}
        />
      )}
    </div>
  );
}
