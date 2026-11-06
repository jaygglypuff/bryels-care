import "server-only";
import type { AuthContext } from "@/lib/auth/context";
import { type NextActors, nextActorsSentence } from "@/lib/next-actors-words";
import type { Permission } from "@/lib/permissions";
import { getCreditNote, getExpenseClaim, getInvoice, getPayment, getSupplierBill } from "@/modules/finance";
import { type EvaluatedStep, type HandoffKind, approvalStepRecord, nextActors } from "@/modules/governance";

type Progress = { steps: { step: number; approvals?: { by: string }[] }[]; next: EvaluatedStep | null } | null | undefined;

const KIND: Record<string, HandoffKind> = {
  "finance.invoice.approve": "invoice",
  "finance.supplier_bill.approve": "supplier_bill",
  "finance.credit_note.approve": "credit_note",
  "finance.payment_record.approve": "payment",
  "finance.expense_claim.approve": "expense_claim",
};

/**
 * Who approves a finance document next (ADR-109, docs/NEXT_APPROVER.md): `nextActors` with the open step's roles, the
 * same people the service keeps out (`exclude`: creator and submitter, or the claimant) and the earlier steps'
 * approvers. Step roles stay as configured (no owner stand-in) except on expense claims, as in `canDecide`.
 */
export async function approvalNext(ctx: AuthContext, permission: string, progress: Progress, record: { siteId: string | null; exclude: readonly (string | null | undefined)[]; pendingSince: Date | null }): Promise<NextActors | null> {
  if (!progress?.next) return null;
  const kind = KIND[permission] ?? "invoice";
  return nextActors(ctx, kind, { ...approvalStepRecord({ siteId: record.siteId, excludeUserIds: record.exclude }, progress, record.pendingSince), roleStandIn: kind === "expense_claim" }).catch(() => null);
}

/** The same as one sentence ("Next: Rosa (finance) approves the invoice (step 1 of 2) — they will see it in To approve."). */
export async function approvalWaiting(ctx: AuthContext, permission: string, progress: Progress, record: { siteId: string | null; exclude: readonly (string | null | undefined)[]; pendingSince: Date | null }): Promise<string> {
  const n = await approvalNext(ctx, permission, progress, record);
  return n ? nextActorsSentence(n) : "Waiting for approval.";
}

type Entity = "invoice" | "credit_note" | "payment" | "bill" | "expense";
const APPROVE: Record<Entity, string> = { invoice: "finance.invoice.approve", credit_note: "finance.credit_note.approve", payment: "finance.payment_record.approve", bill: "finance.supplier_bill.approve", expense: "finance.expense_claim.approve" };
const POST: Record<Entity, Permission> = { invoice: "finance.invoice.post", credit_note: "finance.credit_note.post", payment: "finance.payment_record.post", bill: "finance.supplier_bill.post", expense: "finance.expense_claim.post" };

async function load(ctx: AuthContext, entity: Entity, id: string) {
  if (entity === "invoice") {
    const d = await getInvoice(ctx, id);
    return { r: d.invoice, progress: d.progress, exclude: [d.invoice.createdBy, d.invoice.submittedBy] };
  }
  if (entity === "credit_note") {
    const d = await getCreditNote(ctx, id);
    return { r: d.creditNote, progress: d.progress, exclude: [d.creditNote.createdBy, d.creditNote.submittedBy] };
  }
  if (entity === "payment") {
    const d = await getPayment(ctx, id);
    return { r: d.payment, progress: d.progress, exclude: [d.payment.createdBy, d.payment.submittedBy] };
  }
  if (entity === "bill") {
    const d = await getSupplierBill(ctx, id);
    return { r: d.bill, progress: d.progress, exclude: [d.bill.createdBy, d.bill.submittedBy] };
  }
  const d = await getExpenseClaim(ctx, id);
  return { r: d.claim, progress: d.progress, exclude: [d.claim.claimantUserId] };
}

/**
 * After a finance command (send for approval, approve a step): who acts next, for the success message. Waiting for a
 * step: the step's approvers; approved: who saves it to the books (never an approver when the rules forbid it, never
 * the claimant). Null when nobody waits.
 */
export async function financeNext(ctx: AuthContext, entity: Entity, id: string): Promise<NextActors | null> {
  const x = await load(ctx, entity, id).catch(() => null);
  if (!x) return null;
  const status = x.r.status as string;
  if (status === "submitted") return approvalNext(ctx, APPROVE[entity], x.progress, { siteId: x.r.siteId, exclude: x.exclude, pendingSince: x.r.submittedAt });
  if (status === "approved") {
    const approvers = x.progress && !x.progress.posterMayEqualApprover ? x.progress.approvers : [];
    return nextActors(
      ctx,
      { kind: `finance_post.${entity}`, permission: POST[entity], does: "saves it to the books", doBase: "save it to the books", where: "on this record", fallback: "finance", operational: true, prefer: ["finance", "owner_director"] },
      { siteId: x.r.siteId, excludeUserIds: [...approvers, ...(entity === "expense" ? x.exclude : [])] },
    ).catch(() => null);
  }
  return null;
}
