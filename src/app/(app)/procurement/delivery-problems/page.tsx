import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { deliveryProblemKindWords, listDeliveryProblems } from "@/modules/procurement";
import { Card, EmptyState, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { SubNav, fmtBase } from "../_ui";
import { DecideDeliveryProblem } from "./decide-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Delivery problems" };

const DECISION_WORDS: Record<string, string> = { send_more: "The supplier sends the rest", money_back: "Asked the supplier for money back", close_rest: "Not needed – the rest is closed" };

/**
 * ADR-131 (C-office problem 11): deliveries that came short, damaged or with a wrong item, for purchasing to decide.
 * Open problems first; decided ones show what was agreed. The decision is checked again on the server.
 */
export default async function DeliveryProblemsPage() {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_order.view")) return <Forbidden what="delivery problems" permission="procurement.purchase_order.view" />;
  const rows = await listDeliveryProblems(ctx);
  const canDecide = ctx.can("procurement.purchase_order.edit");
  const open = rows.filter((r) => !r.decision);
  return (
    <>
      <PageHeader title="Delivery problems" />
      <PageIntro>This screen is for deliveries that came short, damaged or with a wrong item. Decide with the supplier what happens: they send the rest, they give money back, or the rest is not needed.</PageIntro>
      <SubNav />
      {rows.length === 0 ? (
        <EmptyState title="No delivery problems">When the warehouse writes down a short, damaged or wrong delivery, it shows here and you get a message.</EmptyState>
      ) : (
        <div className="flex flex-col gap-3" data-testid="delivery-problems">
          {open.length > 0 && <p className="text-[14px] font-medium">{open.length === 1 ? "1 problem waits for your decision." : `${open.length} problems wait for your decision.`}</p>}
          {rows.map((r) => (
            <Card key={r.goodsReceiptLineId}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 text-[14px]">
                  <p className="font-medium">
                    {r.materialName} from {r.supplierName}
                  </p>
                  <p className="text-fg-2">
                    {deliveryProblemKindWords(r.kind)}: received {fmtBase(r.receivedBase, r.baseUom)} of {fmtBase(r.orderedBase, r.baseUom)} ordered
                    {Number(r.stillToComeBase) > 0 ? `, still to come ${fmtBase(r.stillToComeBase, r.baseUom)}` : ""}
                    {r.receivedAt ? ` · delivered ${fmtDate(r.receivedAt)}` : ""}
                  </p>
                  {r.note && <p className="text-[13px] text-fg-2">Warehouse note: {r.note}</p>}
                  <p className="text-[13px] text-muted">
                    <Link className="text-primary-text hover:underline" href={`/procurement/orders/${r.purchaseOrderId}`}>
                      Order {r.poNumber}
                    </Link>
                    {r.receiptNumber ? ` · delivery ${r.receiptNumber}` : ""}
                  </p>
                </div>
                {r.decision ? <Chip tone="ok">Decided</Chip> : <Chip tone="warn">To decide</Chip>}
              </div>
              {r.decision ? (
                <p className="mt-2 text-[14px]">
                  {DECISION_WORDS[r.decision.decision] ?? r.decision.decision}: {r.decision.note} ({fmtDate(r.decision.decidedAt)})
                </p>
              ) : canDecide ? (
                <div className="mt-3">
                  <DecideDeliveryProblem goodsReceiptLineId={r.goodsReceiptLineId} canSendMore={r.lineStatus === "open"} />
                </div>
              ) : (
                <p className="mt-2 text-[14px] text-fg-2">Purchasing decides this with the supplier.</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
