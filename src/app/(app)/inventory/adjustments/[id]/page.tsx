import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime, fmtMoney } from "@/lib/qty";
import { getAdjustment, type AdjustmentDetail } from "@/modules/inventory/adjustments";
import { Card, CardTitle, Dl, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { CommandForm } from "../../_kit/forms";
import { ADJ_STATUS_TONE } from "../../counts/status";
import { approveAdjustmentAction, cancelAdjustmentAction, postAdjustmentAction, rejectAdjustmentAction, submitAdjustmentAction } from "../actions";
import { DeleteDraftCard } from "../../../delete-draft-button";

export const metadata = { title: "Stock adjustment" };

export default async function AdjustmentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.adjustment.view")) return <Forbidden what="stock adjustments" />;
  const { id } = await params;
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
        subtitle={<><Link href="/inventory/adjustments" className="text-primary-text hover:underline">Stock adjustments</Link> · {a.reasonCode.replace(/_/g, " ")}{a.reasonNote ? ` · ${a.reasonNote}` : ""}</>}
        actions={<Chip tone={ADJ_STATUS_TONE[a.status]}>{a.status}</Chip>}
      />
      {a.status === "submitted" && (
        <Banner tone="appr" title={a.can.awaitingSecondStep ? "Approval required: second step" : "Approval required"}>
          {a.requiresSecondApproval
            ? "Above the value threshold: a site manager approves first, then the owner/director (a different person). The drafter cannot approve."
            : "A site manager other than the drafter approves before it can post."}
          {a.can.own ? " You drafted or submitted it, so you cannot approve it." : ""}
        </Banner>
      )}
      {a.status === "rejected" && <Banner tone="bad" title="Rejected">{a.rejectionReason}</Banner>}
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardTitle>Lines</CardTitle>
          <Table head={["#", "Lot", "Location", "Change", "Unit cost", "Posted"]}>
            {a.lines.map((l) => (
              <tr key={l.id}>
                <Td>{l.lineNo}</Td>
                <Td>{l.lotId ? <Link href={`/inventory/${l.lotId}`} className="font-mono text-primary-text hover:underline">{l.lotNumber}</Link> : <span>New lot ({l.newLotItem}) on QA hold</span>}<div className="text-[12px] text-muted">{l.itemName ?? l.newLotItem}</div></Td>
                <Td className="font-mono">{l.locationCode}{l.containerNumber ? ` · ${l.containerNumber}` : ""}</Td>
                <Td className="font-semibold">{l.direction === "increase" ? "+" : "−"}{new Decimal(l.qtyBase).toString()} {l.baseUom ?? ""}</Td>
                <Td>{l.unitCostAmount ? fmtMoney(l.unitCostAmount) : "—"}</Td>
                <Td>{l.stockMovementId ? <Chip tone="ok">Posted</Chip> : "—"}</Td>
              </tr>
            ))}
          </Table>
          <div className="mt-4">
            <Dl
              items={[
                ["Value", a.totalValueAmount === null ? "Not submitted" : `${fmtMoney(a.totalValueAmount)}${a.valueUnknown ? " (some lines without cost)" : ""}`],
                ["Drafted by", a.createdByName ?? "—"],
                ["Submitted", a.submittedAt ? `${fmtDateTime(a.submittedAt)} · ${a.submittedByName}` : "—"],
                ["Approved", a.approvedAt ? `${fmtDateTime(a.approvedAt)} · ${a.approvedByName}` : "—"],
                ["Posted", a.postedAt ? `${fmtDateTime(a.postedAt)} · ${a.postedByName}` : "—"],
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
            {a.can.submit && <CommandForm action={submitAdjustmentAction.bind(null, a.id)} label="Submit for approval" variant="cta" />}
            {a.can.approve && <CommandForm action={approveAdjustmentAction.bind(null, a.id)} label={a.can.awaitingSecondStep ? "Give second approval" : "Approve"} variant="cta" reason={{ label: "Approval note (optional)", required: false }} />}
            {a.can.approve && <CommandForm action={rejectAdjustmentAction.bind(null, a.id)} label="Reject" variant="secondary" reason={{ label: "Why reject?" }} />}
            {a.can.post && <CommandForm action={postAdjustmentAction.bind(null, a.id, randomUUID())} label="Post to stock" variant="cta" confirmText="Post this adjustment? It writes one ledger movement per line and cannot be undone (only reversed)." />}
            {a.can.cancel && <CommandForm action={cancelAdjustmentAction.bind(null, a.id)} label="Cancel" variant="ghost" reason={{ label: "Why cancel?" }} />}
            {!a.can.submit && !a.can.approve && !a.can.post && !a.can.cancel && <p className="text-[13px] text-muted">{a.status === "posted" ? "Posted. Corrections are a reversal plus a new adjustment." : "Nothing for you to do here."}</p>}
          </div>
        </Card>
        {a.status === "draft" && (ctx.can("inventory.adjustment.create") || ctx.can("inventory.adjustment.approve")) && <DeleteDraftCard kind="stock_adjustment" id={a.id} what="adjustment" note="Nothing has moved yet: stock only changes when an approved adjustment is posted. You can delete this draft." />}
      </div>
    </div>
  );
}
