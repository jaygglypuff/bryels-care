import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime, fmtMoney } from "@/lib/qty";
import { fmtFriendly } from "@/lib/units";
import { getAdjustment, type AdjustmentDetail } from "@/modules/inventory/adjustments";
import { Card, CardTitle, Dl, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { CommandForm } from "../../_kit/forms";
import { AdjustmentStatusChip } from "../../counts/status";
import { adjustmentReasonWords } from "../reason-words";
import { approveAdjustmentAction, cancelAdjustmentAction, postAdjustmentAction, rejectAdjustmentAction, submitAdjustmentAction } from "../actions";
import { DeleteDraftCard } from "../../../delete-draft-button";

export const metadata = { title: "Stock adjustment" };

export default async function AdjustmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string; saved?: string; notSent?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.adjustment.view")) return <Forbidden what="stock adjustments" />;
  const { id } = await params;
  const sp = await searchParams;
  let a: AdjustmentDetail;
  try {
    a = await getAdjustment(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  return (
    <div className="space-y-5">
      <PageHeader
        title={a.adjustmentNumber}
        subtitle={<><Link href="/inventory/adjustments" className="text-primary-text hover:underline">Fix stock</Link> · {adjustmentReasonWords(a.reasonCode)}{a.reasonNote ? ` · ${a.reasonNote}` : ""}</>}
        actions={<AdjustmentStatusChip status={a.status} />}
      />
      {sp.sent && a.status === "submitted" && <Banner tone="ok" title="Sent to the manager">Nothing changes in stock until a manager approves it.</Banner>}
      {sp.saved && a.status === "draft" && <Banner tone="info" title="Saved for later">It is not finished. Tap Send to manager when it is ready.</Banner>}
      {sp.notSent && a.status === "draft" && <Banner tone="warn" title="Saved, but not sent">{sp.notSent.slice(0, 300)}</Banner>}
      {a.status === "submitted" && (
        <Banner tone="appr" title={a.can.awaitingSecondStep ? "Waiting for the second OK" : "Waiting for a manager's OK"}>
          {a.requiresSecondApproval
            ? "It is a large change: a site manager approves first, then the owner (a different person). The person who made it cannot approve it."
            : "A site manager (not the person who made it) approves it before it is saved to stock."}
          {a.can.own ? " You made or sent it, so someone else approves it." : ""}
        </Banner>
      )}
      {a.status === "rejected" && <Banner tone="bad" title="Rejected">{a.rejectionReason}</Banner>}
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card className="min-w-0">
          <CardTitle>Lots</CardTitle>
          <Table head={["#", "Lot", "Shelf", "Change", "Cost per unit", "Saved"]}>
            {a.lines.map((l) => (
              <tr key={l.id}>
                <Td>{l.lineNo}</Td>
                <Td>{l.lotId ? <Link href={`/inventory/${l.lotId}`} className="font-mono text-primary-text hover:underline">{l.lotNumber}</Link> : <span>New lot ({l.newLotItem}), waiting for QA</span>}<div className="text-[12px] text-muted">{l.itemName ?? l.newLotItem}</div></Td>
                <Td className="font-mono">{l.locationCode}{l.containerNumber ? ` · ${l.containerNumber}` : ""}</Td>
                <Td className="font-semibold">{l.direction === "increase" ? "Add " : "Take away "}{l.baseUom ? fmtFriendly(l.qtyBase, l.baseUom) : new Decimal(l.qtyBase).toString()}</Td>
                <Td>{l.unitCostAmount ? `${fmtMoney(l.unitCostAmount)}${l.baseUom ? ` per ${l.baseUom}` : ""}` : "—"}</Td>
                <Td>{l.stockMovementId ? <Chip tone="ok">Saved</Chip> : "—"}</Td>
              </tr>
            ))}
          </Table>
          <div className="mt-4">
            <Dl
              items={[
                ["Value", a.totalValueAmount === null ? "Worked out when sent" : `${fmtMoney(a.totalValueAmount)}${a.valueUnknown ? " (some lines without cost)" : ""}`],
                ["Made by", a.createdByName ?? "—"],
                ["Sent to manager", a.submittedAt ? `${fmtDateTime(a.submittedAt)} · ${a.submittedByName}` : "—"],
                ["Approved", a.approvedAt ? `${fmtDateTime(a.approvedAt)} · ${a.approvedByName}` : "—"],
                ["Saved to stock", a.postedAt ? `${fmtDateTime(a.postedAt)} · ${a.postedByName}` : "—"],
              ]}
            />
          </div>
          {a.decisions.length > 0 && (
            <ul className="mt-3 space-y-1 text-[12px] text-muted">
              {a.decisions.map((d, i) => (
                <li key={i}>Step {d.step}: {d.decision} by {d.by}, {fmtDateTime(d.at)}{d.note ? ` — ${d.note}` : ""}</li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Next step</CardTitle>
          <div className="flex flex-col gap-3">
            {a.can.submit && <CommandForm action={submitAdjustmentAction.bind(null, a.id)} label="Send to manager" variant="cta" size="lg" />}
            {a.can.approve && <CommandForm action={approveAdjustmentAction.bind(null, a.id)} label={a.can.awaitingSecondStep ? "Give second approval" : "Approve"} variant="cta" reason={{ label: "Approval note (optional)", required: false }} />}
            {a.can.approve && <CommandForm action={rejectAdjustmentAction.bind(null, a.id)} label="Do not accept" variant="secondary" reason={{ label: "Why not?" }} />}
            {a.can.post && <CommandForm action={postAdjustmentAction.bind(null, a.id, randomUUID())} label="Save to stock" variant="cta" confirmText="Save this to stock? Each line changes the stock. It cannot be undone, only reversed." confirmLabel="Yes, save to stock" />}
            {a.can.cancel && <CommandForm action={cancelAdjustmentAction.bind(null, a.id)} label="Cancel" variant="ghost" reason={{ label: "Why cancel?" }} />}
            {!a.can.submit && !a.can.approve && !a.can.post && !a.can.cancel && <p className="text-[13px] text-muted">{a.status === "posted" ? "Saved to stock. To correct it, a manager reverses it and you make a new one." : a.status === "submitted" ? "Waiting for the manager." : "Nothing for you to do here."}</p>}
          </div>
        </Card>
        {a.status === "draft" && (ctx.can("inventory.adjustment.create") || ctx.can("inventory.adjustment.approve")) && <DeleteDraftCard kind="stock_adjustment" id={a.id} what="adjustment" note="Nothing has changed in stock yet: stock only changes after a manager approves it and it is saved. You can delete this unfinished one." />}
      </div>
    </div>
  );
}
