import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { CheckCircle2, Minus, Plus } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime, fmtMoney } from "@/lib/qty";
import { fmtFriendly } from "@/lib/units";
import { getAdjustment, type AdjustmentDetail } from "@/modules/inventory/adjustments";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { CommandForm } from "../../_kit/forms";
import { AdjustmentStatusChip } from "../../counts/status";
import { adjustmentReasonWords } from "../reason-words";
import { approveAdjustmentAction, cancelAdjustmentAction, postAdjustmentAction, rejectAdjustmentAction, submitAdjustmentAction } from "../actions";
import { DeleteDraftButton } from "../../../delete-draft-button";

export const metadata = { title: "Stock fix" };

/**
 * One stock fix (stock adjustment, US-2-19), grade-5 (ADR-088): one next step by state, or who we are waiting
 * for. The maker never approves their own fix (ADR-091; the service refuses it too), large fixes need two
 * different approvers, and a saved fix is never edited (undo kept on record, then a new fix).
 */
export default async function AdjustmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string; saved?: string; notSent?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.adjustment.view")) return <Forbidden what="stock fixes" />;
  const { id } = await params;
  const sp = await searchParams;
  let a: AdjustmentDetail;
  try {
    a = await getAdjustment(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const items = [...new Set(a.lines.map((l) => l.itemName ?? l.newLotItem).filter(Boolean))].join(", ");
  const waitingFor = a.requiresSecondApproval
    ? a.can.awaitingSecondStep
      ? "Waiting for the owner (a different person from the first approver) to give the second OK."
      : "Waiting for a site manager to approve first, then the owner. The person who made it cannot approve it."
    : "Waiting for a site manager (not the person who made it) to approve it.";

  const next = (() => {
    if (a.can.submit) return <NextStep text="When every lot is right, send it to the manager (button below). Nothing changes in stock until it is approved." />;
    if (a.status === "submitted" && a.can.approve) return <NextStep text={a.can.awaitingSecondStep ? "Check the lots below, then give the second OK or say why not." : "Check the lots below, then say OK or say why not."} />;
    if (a.status === "submitted") return <NextStep text={a.can.own ? "Sent. You made or sent it, so someone else approves it." : "Sent to the manager."} waitingFor={waitingFor} />;
    if (a.status === "approved" && a.can.post) return <NextStep text="Approved. Save it to stock now (button below)." />;
    if (a.status === "approved") return <NextStep text="Approved." waitingFor="Waiting for the site manager to save it to stock." />;
    if (a.status === "posted") return <NextStep text="Saved to stock. Nothing more to do. If it was wrong, a manager undoes it (kept on record) and you make a new one." />;
    if (a.status === "rejected") return <NextStep text={`Not accepted: ${a.rejectionReason ?? "see the history"}. Make a new fix if the stock is still wrong.`} action={ctx.can("inventory.adjustment.create") ? { label: "Make a new fix", href: "/inventory/adjustments/new" } : undefined} />;
    if (a.status === "cancelled") return <NextStep text="Cancelled. Nothing changed in stock." />;
    if (a.status === "draft") return <NextStep text="Not finished." waitingFor="Waiting for the person who made it to send it to the manager." />;
    return null;
  })();
  const canDelete = a.status === "draft" && (ctx.can("inventory.adjustment.create") || ctx.can("inventory.adjustment.approve"));
  const hasDo = a.can.submit || a.can.approve || a.can.post;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Fix stock: ${items || adjustmentReasonWords(a.reasonCode)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <RecordNo>{a.adjustmentNumber}</RecordNo> <AdjustmentStatusChip status={a.status} /> {adjustmentReasonWords(a.reasonCode)}
          </span>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-3">
              {a.can.cancel && (
                <div>
                  <p className="mb-2 text-[13px] text-fg-2">Cancelling stops this fix. Nothing changes in stock.</p>
                  <CommandForm action={cancelAdjustmentAction.bind(null, a.id)} label="Cancel" variant="secondary" reason={{ label: "Why cancel?" }} />
                </div>
              )}
              {canDelete && (
                <div>
                  <p className="mb-2 text-[13px] text-fg-2">Nothing has changed in stock yet, so this unfinished fix can be deleted.</p>
                  <DeleteDraftButton kind="stock_adjustment" id={a.id} what="adjustment" />
                </div>
              )}
              <LinkButton href="/inventory/adjustments" variant="ghost">All stock fixes</LinkButton>
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for one stock fix: which lots change, by how much, and who says OK before stock changes.</PageIntro>
      {sp.sent && a.status === "submitted" && <Banner tone="ok" title="Sent to the manager">Nothing changes in stock until a manager approves it.</Banner>}
      {sp.saved && a.status === "draft" && <Banner tone="info" title="Saved for later">It is not finished. Tap Send to manager when it is ready.</Banner>}
      {sp.notSent && a.status === "draft" && <Banner tone="warn" title="Saved, but not sent">{sp.notSent.slice(0, 300)}</Banner>}
      {next}

      {hasDo && (
        <Card id="do">
          <div className="flex flex-col gap-3">
            {a.can.submit && <CommandForm action={submitAdjustmentAction.bind(null, a.id)} label="Send to manager" variant="cta" size="lg" />}
            {a.can.approve && <CommandForm action={approveAdjustmentAction.bind(null, a.id)} label={a.can.awaitingSecondStep ? "Give second approval" : "Approve"} variant="cta" reason={{ label: "Note (optional)", required: false }} />}
            {a.can.approve && <CommandForm action={rejectAdjustmentAction.bind(null, a.id)} label="Do not accept" variant="secondary" reason={{ label: "Why not?" }} />}
            {a.can.post && <CommandForm action={postAdjustmentAction.bind(null, a.id, randomUUID())} label="Save to stock" variant="cta" size="lg" confirmText="Save this to stock? Each line changes the stock. It cannot be edited later, only undone (kept on record)." confirmLabel="Yes, save to stock" />}
          </div>
        </Card>
      )}

      <section className="space-y-2">
        <h2 className="text-[16px] font-semibold">What changes</h2>
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface" aria-label="Lots in this fix">
          {a.lines.map((l) => {
            const amount = l.baseUom ? fmtFriendly(l.qtyBase, l.baseUom) : new Decimal(l.qtyBase).toString();
            const inner = (
              <>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">
                    {l.itemName ?? l.newLotItem} {l.stockMovementId && <Chip tone="ok"><CheckCircle2 size={13} aria-hidden /> Saved to stock</Chip>}
                  </p>
                  <p className="mt-0.5 text-[13px] text-fg-2">
                    On {l.locationCode}
                    {l.containerNumber ? ` · box ${l.containerNumber}` : ""}
                    {l.unitCostAmount ? ` · ${fmtMoney(l.unitCostAmount)}${l.baseUom ? ` per ${l.baseUom}` : ""}` : ""}
                    {l.lotId ? <span className="ml-1 font-mono text-[12px] text-muted">· {l.lotNumber}</span> : " · new lot, waiting for the QA check"}
                  </p>
                </div>
                <span className={`flex shrink-0 items-center gap-1 text-[15px] font-semibold tabular ${l.direction === "increase" ? "text-[var(--ok-fg)]" : "text-[var(--bad-fg)]"}`}>
                  {l.direction === "increase" ? <Plus size={15} aria-hidden /> : <Minus size={15} aria-hidden />}
                  {l.direction === "increase" ? "Add" : "Take away"} {amount}
                </span>
              </>
            );
            return (
              <li key={l.id}>
                {l.lotId ? (
                  <Link href={`/inventory/${l.lotId}`} className="flex min-h-[56px] items-center gap-3 px-4 py-3 hover:bg-surface-2">{inner}</Link>
                ) : (
                  <div className="flex min-h-[56px] items-center gap-3 px-4 py-3">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <Card>
        <CardTitle>Why and who</CardTitle>
        <Dl
          items={[
            ["What happened", `${adjustmentReasonWords(a.reasonCode)}${a.reasonNote ? `: ${a.reasonNote}` : ""}`],
            ["Value", a.totalValueAmount === null ? "Worked out when sent" : `${fmtMoney(a.totalValueAmount)}${a.valueUnknown ? " (some lines without cost)" : ""}`],
            ["Made by", a.createdByName ?? "—"],
            ["Sent to manager", a.submittedAt ? `${fmtDateTime(a.submittedAt)} · ${a.submittedByName}` : "—"],
            ["Approved", a.approvedAt ? `${fmtDateTime(a.approvedAt)} · ${a.approvedByName}` : "—"],
            ["Saved to stock", a.postedAt ? `${fmtDateTime(a.postedAt)} · ${a.postedByName}` : "—"],
          ]}
        />
        {a.decisions.length > 0 && (
          <div className="mt-3">
            <MoreDetails title="Every decision">
              <ul className="space-y-1 text-[13px] text-fg-2">
                {a.decisions.map((d, i) => (
                  <li key={i}>Step {d.step}: {d.decision} by {d.by}, {fmtDateTime(d.at)}{d.note ? ` — ${d.note}` : ""}</li>
                ))}
              </ul>
            </MoreDetails>
          </div>
        )}
      </Card>
    </div>
  );
}
