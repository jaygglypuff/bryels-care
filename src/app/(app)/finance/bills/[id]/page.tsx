import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { MATCH_LABEL, getSupplierBill } from "@/modules/finance";
import { Card, CardTitle, Dl, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { FinanceCommand } from "../../commands";
import { ApprovalCard, FinanceStatus, HistoryCard, Money, PostingsCard } from "../../finance-ui";

export const metadata = { title: "Supplier bill" };

const MATCH_TONE: Record<string, "ok" | "warn" | "bad" | "info" | "neu"> = { matched: "ok", no_po: "info", qty_variance: "bad", price_variance: "bad", no_receipt: "warn" };

export default async function BillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.supplier_bill.view")) return <Forbidden what="supplier bills" />;
  const { id } = await params;
  const { created } = await searchParams;
  let d: Awaited<ReturnType<typeof getSupplierBill>>;
  try {
    d = await getSupplierBill(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const b = d.bill;
  const name = (u: string | null) => (u ? d.names[u] ?? "—" : "—");
  return (
    <>
      <PageHeader
        title={`${b.billKind === "credit" ? "Supplier credit" : "Bill"} ${b.billNumber}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <FinanceStatus status={b.status} />
            <span>
              {d.supplier.name} · ref. {b.supplierReference}
            </span>
          </span>
        }
        actions={
          <LinkButton href="/finance/bills" variant="secondary">
            All bills
          </LinkButton>
        }
      />
      {created && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="Bill draft saved.">Submit it: the three-way match runs at submission.</Banner>
        </div>
      )}
      {b.status === "disputed" && (
        <div className="mb-4">
          <Banner tone="bad" title="In dispute: the three-way match found a variance beyond tolerance">
            Resolve it by amending the purchase order and matching again, entering a supplier credit, or having a different person approve the variance with a reason.
          </Banner>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Lines and match</CardTitle>
            <Table head={["#", "Line", "Qty", "Unit", "Amount", "Tax", "Match"]}>
              {d.lines.map((l) => {
                const det = (l.matchDetail ?? {}) as Record<string, string | null>;
                return (
                  <tr key={l.id}>
                    <Td>{l.lineNo}</Td>
                    <Td>
                      {l.description}
                      <span className="block text-[12px] text-muted">{l.chargeKind === "goods" ? "Goods" : l.chargeKind}</span>
                    </Td>
                    <Td>{fmtQty(l.qty, l.uom ?? "", 2)}</Td>
                    <Td>
                      <Money value={l.unitAmount} />
                    </Td>
                    <Td>
                      <Money value={l.lineAmount} />
                    </Td>
                    <Td>{l.taxCode ? `${l.taxCode} ${Number(l.taxRatePct)} %` : "—"}</Td>
                    <Td>
                      {l.matchResult ? <Chip tone={MATCH_TONE[l.matchResult] ?? "neu"}>{MATCH_LABEL[l.matchResult] ?? l.matchResult}</Chip> : <span className="text-muted">Not run</span>}
                      {det.receivedQty !== undefined && (
                        <span className="block text-[12px] text-muted">
                          received {fmtQty(det.receivedQty, "", 2)}
                          {det.billedElsewhere && Number(det.billedElsewhere) > 0 ? `, billed before ${fmtQty(det.billedElsewhere, "", 2)}` : ""}
                        </span>
                      )}
                      {det.poNumber && (
                        <span className="block text-[12px] text-muted">
                          {det.poNumber}: expected <Money value={det.expectedAmount} />, tolerance <Money value={det.priceTolerance} />
                        </span>
                      )}
                      {det.note && <span className="block text-[12px] text-muted">{det.note}</span>}
                    </Td>
                  </tr>
                );
              })}
              <tr className="bg-surface-2">
                <Td colSpan={4}>Subtotal · tax</Td>
                <Td>
                  <Money value={b.subtotalAmount} />
                </Td>
                <Td colSpan={2}>
                  <Money value={b.taxAmount} />
                </Td>
              </tr>
              <tr className="bg-surface-2 font-semibold">
                <Td colSpan={4}>Total ({b.currency})</Td>
                <Td colSpan={3}>
                  <Money value={b.totalAmount} />
                </Td>
              </tr>
            </Table>
            {b.varianceReason && <p className="mt-2 text-[13px]">Variance approved by {name(b.varianceApprovedBy)} on {fmtDateTime(b.varianceApprovedAt)}: {b.varianceReason}</p>}
          </Card>
          <PostingsCard postings={d.postings} />
          <HistoryCard history={d.history} />
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Details</CardTitle>
            <Dl
              items={[
                ["Supplier", d.supplier.name],
                ["Supplier ref.", b.supplierReference],
                ["Goods receipt", d.receipt ? (ctx.can("procurement.goods_receipt.view") ? <Link key="g" className="text-primary-text hover:underline" href={`/inventory/receive/${d.receipt.id}`}>{d.receipt.receiptNumber}</Link> : d.receipt.receiptNumber) : "—"],
                ["Category", b.categoryCode ?? "—"],
                ["Bill date", fmtDate(b.billDate)],
                ["Due", fmtDate(b.dueDate)],
                ["Paid / credited", <Money key="p" value={b.paidAmount} />],
                ["Open", <Money key="o" value={b.openAmount} />],
                ...(d.creditFor ? ([["Credit for", <Link key="cf" className="text-primary-text hover:underline" href={`/finance/bills/${d.creditFor.id}`}>{d.creditFor.billNumber}</Link>]] as [string, React.ReactNode][]) : []),
                ["Entered by", name(b.createdBy)],
                ["Approved by", name(b.approvedBy)],
                ["Posted", b.postedBy ? `${name(b.postedBy)} · ${fmtDateTime(b.postedAt)}` : "—"],
              ]}
            />
            {d.credits.length > 0 && (
              <ul className="mt-3 text-[13px]">
                {d.credits.map((c) => (
                  <li key={c.id}>
                    Credit{" "}
                    <Link className="text-primary-text hover:underline" href={`/finance/bills/${c.id}`}>
                      {c.billNumber}
                    </Link>{" "}
                    · <FinanceStatus status={c.status} /> · <Money value={c.total} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardTitle>Next step</CardTitle>
            <div className="flex flex-col gap-3">
              {b.status === "draft" && ctx.can("finance.supplier_bill.submit") && <FinanceCommand entity="bill" id={b.id} command="submit" label="Submit (run the match)" variant="cta" />}
              {b.status === "disputed" && (
                <>
                  {ctx.can("finance.supplier_bill.submit") && <FinanceCommand entity="bill" id={b.id} command="rematch" label="Match again" />}
                  {d.canApproveVariance ? (
                    <FinanceCommand entity="bill" id={b.id} command="approve_variance" label="Approve the variance" reason variant="cta" />
                  ) : (
                    <p className="text-[13px] text-muted">A finance approver other than the person who entered or submitted the bill can accept the variance.</p>
                  )}
                  {ctx.can("finance.supplier_bill.create") && b.billKind === "bill" && (
                    <LinkButton href="/finance/bills/new" variant="secondary">
                      Enter a supplier credit
                    </LinkButton>
                  )}
                </>
              )}
              {b.status === "submitted" &&
                (d.canApprove ? (
                  <>
                    <FinanceCommand entity="bill" id={b.id} command="approve" label="Approve bill" note variant="cta" />
                    <FinanceCommand entity="bill" id={b.id} command="return" label="Return to draft" reason />
                  </>
                ) : (
                  <p className="text-[13px] text-muted">{d.progress?.next ? `Waiting for step ${d.progress.next.step}: ${d.progress.next.label}.` : "Waiting for approval."}{!b.goodsReceiptId ? " Bills without a receipt are approved by finance." : ""}</p>
                ))}
              {b.status === "approved" &&
                ctx.can("finance.supplier_bill.post") &&
                (d.posterBlocked ? (
                  <p className="text-[13px] text-muted">You approved this bill; above the threshold another finance person posts it.</p>
                ) : (
                  <FinanceCommand entity="bill" id={b.id} command="post" label="Post bill" password variant="cta" hint="Posting writes the payable (immutable), dated on the bill date, and sets the due date from the supplier's terms." />
                ))}
              {["draft", "submitted", "disputed", "approved"].includes(b.status) && ctx.can("finance.supplier_bill.create") && <FinanceCommand entity="bill" id={b.id} command="cancel" label="Cancel" reason variant="danger" />}
              {b.status === "posted" && Number(b.paidAmount) === 0 && b.billKind !== "credit" && ctx.can("finance.supplier_bill.void") && (
                <FinanceCommand entity="bill" id={b.id} command="void" label="Void bill (reversal)" reason password variant="danger" confirm="Void this bill? A reversal posting is written; enter a replacement bill if needed." />
              )}
              {["posted", "partially_paid"].includes(b.status) && b.billKind === "bill" && ctx.can("finance.payment_record.create") && (
                <LinkButton href={`/finance/payments/new?counterparty=supplier:${d.supplier.id}`} variant="secondary">
                  Record a payment
                </LinkButton>
              )}
            </div>
          </Card>
          <ApprovalCard progress={d.progress} decisions={d.decisions} />
        </div>
      </div>
    </>
  );
}
