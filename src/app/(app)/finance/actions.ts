"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, DomainError, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import {
  approveInvoice,
  approvePeriodUnlock,
  approveTaxConfiguration,
  cancelCreditNote,
  cancelExpenseClaim,
  cancelInvoice,
  cancelPayment,
  cancelPeriodUnlock,
  cancelSupplierBill,
  createCreditNote,
  createExpenseClaim,
  createInvoiceFromShipment,
  createPayment,
  createSupplierBill,
  decideCreditNote,
  decideExpenseClaim,
  decidePayment,
  decideSupplierBill,
  editInvoiceDraft,
  editSupplierBill,
  issueCreditNote,
  issueInvoice,
  lockPeriod,
  postExpenseClaim,
  postSupplierBill,
  proposeTaxConfiguration,
  recordPayment,
  rejectPeriodUnlock,
  rejectTaxConfiguration,
  requestPeriodUnlock,
  resolveBillDispute,
  retireTaxConfiguration,
  returnInvoice,
  submitCreditNote,
  submitExpenseClaim,
  submitInvoice,
  submitPayment,
  submitSupplierBill,
  uploadExpenseReceipt,
  voidCreditNote,
  voidExpenseClaim,
  voidInvoice,
  voidPayment,
  voidSupplierBill,
} from "@/modules/finance";

/** Finance server actions (US-6-10..14): thin adapters over src/modules/finance; every rule is in the services. */
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const uuid = z.string().uuid("Choose a valid record.");

const MESSAGES: Record<string, string> = {
  submit: "Submitted.",
  approve: "Your approval is recorded.",
  return: "Returned to draft.",
  reject: "Rejected.",
  cancel: "Cancelled.",
  issue: "Issued and posted.",
  post: "Posted.",
  record: "Payment recorded and applied.",
  void: "Reversed with a reversal posting.",
  edit: "Saved.",
  approve_variance: "Variance approved; the bill continues to approval.",
  rematch: "Matched again.",
};

/** One entry point for every in-place finance command (the page re-renders in the response). */
export async function financeCommandAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const entity = z.enum(["invoice", "credit_note", "payment", "bill", "expense"]).parse(str(fd, "entity"));
    const id = uuid.parse(str(fd, "id"));
    const command = z.string().parse(str(fd, "command"));
    const reason = str(fd, "reason") ?? "";
    const note = str(fd, "note") || null;
    const password = str(fd, "password") || null;
    const key = str(fd, "idempotencyKey") || null;
    let message = MESSAGES[command] ?? "Done.";
    switch (`${entity}:${command}`) {
      case "invoice:submit": {
        const r = await submitInvoice(ctx, id);
        message = r.status === "approved" ? "Submitted; no approval needed, ready to issue." : "Submitted for approval.";
        break;
      }
      case "invoice:approve": {
        const r = await approveInvoice(ctx, id, note);
        message = r.approved ? "Approved: ready to issue." : "Your approval is recorded; the next step is still open.";
        break;
      }
      case "invoice:return":
        await returnInvoice(ctx, id, reason);
        break;
      case "invoice:cancel":
        await cancelInvoice(ctx, id, reason);
        break;
      case "invoice:issue": {
        const r = await issueInvoice(ctx, id, { password, idempotencyKey: key });
        message = `Issued as ${r.invoiceNumber}.`;
        break;
      }
      case "invoice:void":
        await voidInvoice(ctx, id, { reason, password });
        break;
      case "invoice:edit":
        await editInvoiceDraft(ctx, id, { notes: str(fd, "notes") ?? null, taxCode: str(fd, "taxCode") ?? null });
        break;
      case "credit_note:submit":
        await submitCreditNote(ctx, id);
        break;
      case "credit_note:approve": {
        const r = await decideCreditNote(ctx, id, { decision: "approved", note });
        message = r.approved ? "Approved: ready to issue." : "Your approval is recorded; the next step is still open.";
        break;
      }
      case "credit_note:return":
        await decideCreditNote(ctx, id, { decision: "returned", note: reason });
        break;
      case "credit_note:cancel":
        await cancelCreditNote(ctx, id, reason);
        break;
      case "credit_note:issue": {
        const r = await issueCreditNote(ctx, id, { password, idempotencyKey: key });
        message = `Issued as ${r.creditNoteNumber} and applied to the invoice.`;
        break;
      }
      case "credit_note:void":
        await voidCreditNote(ctx, id, { reason, password });
        break;
      case "payment:submit": {
        const r = await submitPayment(ctx, id);
        message = r.status === "approved" ? "No approval needed: ready to record." : "Submitted for approval.";
        break;
      }
      case "payment:approve": {
        const r = await decidePayment(ctx, id, { decision: "approved", note });
        message = r.approved ? "Approved: ready to record." : "Your approval is recorded; the next step is still open.";
        break;
      }
      case "payment:return":
        await decidePayment(ctx, id, { decision: "returned", note: reason });
        break;
      case "payment:cancel":
        await cancelPayment(ctx, id, reason);
        break;
      case "payment:record": {
        const r = await recordPayment(ctx, id, { password, idempotencyKey: key });
        message = `Recorded: ${r.applied} applied, ${r.unapplied} left on account.`;
        break;
      }
      case "payment:void":
        await voidPayment(ctx, id, { reason, password });
        break;
      case "bill:submit": {
        const r = await submitSupplierBill(ctx, id);
        message = r.status === "disputed" ? "The three-way match found a variance: the bill is in dispute." : "Matched and submitted for approval.";
        break;
      }
      case "bill:approve": {
        const r = await decideSupplierBill(ctx, id, { decision: "approved", note });
        message = r.approved ? "Approved: ready to post." : "Your approval is recorded; the next step is still open.";
        break;
      }
      case "bill:return":
        await decideSupplierBill(ctx, id, { decision: "returned", note: reason });
        break;
      case "bill:cancel":
        await cancelSupplierBill(ctx, id, reason);
        break;
      case "bill:post":
        await postSupplierBill(ctx, id, { password, idempotencyKey: key });
        break;
      case "bill:void":
        await voidSupplierBill(ctx, id, { reason, password });
        break;
      case "bill:approve_variance":
        await resolveBillDispute(ctx, id, { action: "approve_variance", reason });
        break;
      case "bill:rematch": {
        const r = await resolveBillDispute(ctx, id, { action: "rematch" });
        message = r.status === "disputed" ? "Still outside tolerance: the bill stays in dispute." : "Matched within tolerance; submitted for approval.";
        break;
      }
      case "bill:edit":
        await editSupplierBill(ctx, id, { supplierReference: str(fd, "supplierReference"), billDate: str(fd, "billDate"), notes: str(fd, "notes") ?? null });
        break;
      case "expense:submit":
        await submitExpenseClaim(ctx, id);
        message = "Submitted for approval.";
        break;
      case "expense:approve": {
        const r = await decideExpenseClaim(ctx, id, { decision: "approved", note });
        message = r.status === "approved" ? "Approved: finance can post it." : "Your approval is recorded; the next step is still open.";
        break;
      }
      case "expense:reject":
        await decideExpenseClaim(ctx, id, { decision: "rejected", note: reason });
        break;
      case "expense:return":
        await decideExpenseClaim(ctx, id, { decision: "returned", note: reason });
        break;
      case "expense:cancel":
        await cancelExpenseClaim(ctx, id, reason);
        break;
      case "expense:post":
        await postExpenseClaim(ctx, id, { password, idempotencyKey: key });
        message = "Posted: the claim is payable to the claimant.";
        break;
      case "expense:void":
        await voidExpenseClaim(ctx, id, { reason, password });
        break;
      default:
        throw new DomainError("validation", "Unknown command.");
    }
    refreshCurrentPage();
    return { ok: true, message };
  } catch (e) {
    return toActionState(e);
  }
}

/** Period lock / unlock commands (US-6-13). */
export async function periodCommandAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const command = z.enum(["lock", "request_unlock", "approve_unlock", "reject_unlock", "cancel_unlock"]).parse(str(fd, "command"));
    const password = str(fd, "password") || null;
    const reason = str(fd, "reason") ?? "";
    let message = "Done.";
    if (command === "lock") {
      const code = z.string().regex(/^\d{4}-\d{2}$/).parse(str(fd, "periodCode"));
      await lockPeriod(ctx, code, { reason, acknowledge: str(fd, "acknowledge") === "on", acknowledgementNote: str(fd, "acknowledgementNote") || null, password });
      message = `Period ${code} locked.`;
    } else if (command === "request_unlock") {
      const code = z.string().regex(/^\d{4}-\d{2}$/).parse(str(fd, "periodCode"));
      await requestPeriodUnlock(ctx, code, { reason, password });
      message = "Unlock requested; the owner has been asked to approve it.";
    } else if (command === "approve_unlock") {
      const r = await approvePeriodUnlock(ctx, uuid.parse(str(fd, "requestId")), { note: str(fd, "note") || null, password });
      message = r.unlocked ? `Period ${r.period.periodCode} is open again. Re-export it to the accountant.` : "Your approval is recorded.";
    } else if (command === "reject_unlock") {
      await rejectPeriodUnlock(ctx, uuid.parse(str(fd, "requestId")), { reason });
      message = "Unlock rejected; the period stays locked.";
    } else {
      await cancelPeriodUnlock(ctx, uuid.parse(str(fd, "requestId")));
      message = "Unlock request withdrawn.";
    }
    refreshCurrentPage();
    return { ok: true, message };
  } catch (e) {
    return toActionState(e);
  }
}

/** Tax configuration commands (US-6-14). */
export async function taxCommandAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const command = z.enum(["propose", "approve", "reject", "retire"]).parse(str(fd, "command"));
    const password = str(fd, "password") || null;
    let message = "Done.";
    if (command === "propose") {
      const r = await proposeTaxConfiguration(
        ctx,
        {
          code: str(fd, "code") ?? "",
          name: str(fd, "name") ?? "",
          kind: (str(fd, "kind") ?? "other") as never,
          ratePct: str(fd, "ratePct") ?? "",
          inclusive: str(fd, "inclusive") === "on",
          appliesTo: (str(fd, "appliesTo") ?? "sales") as never,
          rounding: (str(fd, "rounding") ?? "line") as never,
          effectiveFrom: str(fd, "effectiveFrom") ?? "",
          sourceNote: str(fd, "sourceNote") || null,
        },
        { password },
      );
      message = `${r.code} v${r.versionNo} proposed. It is not effective until a second person reviews and approves it.`;
    } else {
      const id = uuid.parse(str(fd, "id"));
      if (command === "approve") {
        const r = await approveTaxConfiguration(ctx, id, { note: str(fd, "note") || null, password });
        message = `${r.code} v${r.versionNo} approved: effective from ${r.effectiveFrom}.`;
      } else if (command === "reject") {
        await rejectTaxConfiguration(ctx, id, { reason: str(fd, "reason") ?? "" });
        message = "Rejected.";
      } else {
        await retireTaxConfiguration(ctx, id, { reason: str(fd, "reason") ?? "", effectiveTo: str(fd, "effectiveTo") || null, password });
        message = "Retired.";
      }
    }
    refreshCurrentPage();
    return { ok: true, message };
  } catch (e) {
    return toActionState(e);
  }
}

/* ------------------------------------------------------------------ create actions (redirect to the new record) */

export async function createInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    id = (await createInvoiceFromShipment(ctx, { shipmentId: uuid.parse(str(fd, "shipmentId")), idempotencyKey: str(fd, "idempotencyKey") || null })).invoiceId;
  } catch (e) {
    return toActionState(e);
  }
  redirect(`/finance/invoices/${id}?created=1`);
}

export async function createCreditNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    id = (
      await createCreditNote(ctx, {
        invoiceId: uuid.parse(str(fd, "invoiceId")),
        amount: str(fd, "amount") || null,
        customerReturnId: str(fd, "customerReturnId") || null,
        reasonCode: str(fd, "reasonCode") ?? "",
        reason: str(fd, "reason") ?? "",
        voidsInvoice: str(fd, "voidsInvoice") === "on",
        idempotencyKey: str(fd, "idempotencyKey") || null,
      })
    ).creditNoteId;
  } catch (e) {
    return toActionState(e);
  }
  redirect(`/finance/credit-notes/${id}?created=1`);
}

export async function createPaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const party = str(fd, "counterparty") ?? "";
    const [kind, partyId] = party.split(":");
    const direction = kind === "customer" ? "inbound" : "outbound";
    let applications: { documentType: "invoice" | "supplier_bill" | "expense_claim"; documentId: string; amount: string }[] | null = null;
    if (str(fd, "allocation") === "manual") {
      applications = [];
      for (const [k, v] of fd.entries()) {
        const m = /^apply:(invoice|supplier_bill|expense_claim):([0-9a-f-]{36})$/.exec(k);
        if (m && typeof v === "string" && v.trim()) applications.push({ documentType: m[1] as never, documentId: m[2], amount: v.trim() });
      }
    }
    id = (
      await createPayment(ctx, {
        direction,
        customerId: kind === "customer" ? partyId : null,
        supplierId: kind === "supplier" ? partyId : null,
        claimantUserId: kind === "claimant" ? partyId : null,
        method: (str(fd, "method") ?? "") as never,
        reference: str(fd, "reference") || null,
        bankReference: str(fd, "bankReference") || null,
        paidOn: str(fd, "paidOn") ?? "",
        amount: str(fd, "amount") ?? "",
        withheldAmount: str(fd, "withheldAmount") || null,
        applications,
        notes: str(fd, "notes") || null,
        idempotencyKey: str(fd, "idempotencyKey") || null,
      })
    ).paymentId;
  } catch (e) {
    return toActionState(e);
  }
  redirect(`/finance/payments/${id}?created=1`);
}

export async function createBillAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    let lines: unknown = [];
    try {
      lines = JSON.parse(str(fd, "lines") ?? "[]");
    } catch {
      return { ok: false, message: "The lines could not be read. Reload the page and try again." };
    }
    id = (
      await createSupplierBill(ctx, {
        supplierId: str(fd, "supplierId") ?? "",
        supplierReference: str(fd, "supplierReference") ?? "",
        billDate: str(fd, "billDate") ?? "",
        goodsReceiptId: str(fd, "goodsReceiptId") || null,
        categoryCode: str(fd, "categoryCode") || null,
        billKind: (str(fd, "billKind") || "bill") as "bill" | "credit" | "charge",
        creditForBillId: str(fd, "creditForBillId") || null,
        notes: str(fd, "notes") || null,
        lines: lines as never,
        idempotencyKey: str(fd, "idempotencyKey") || null,
      })
    ).billId;
  } catch (e) {
    return toActionState(e);
  }
  redirect(`/finance/bills/${id}?created=1`);
}

export async function createExpenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    id = (
      await createExpenseClaim(ctx, {
        categoryCode: str(fd, "categoryCode") ?? "",
        description: str(fd, "description") ?? "",
        expenseDate: str(fd, "expenseDate") ?? "",
        amount: str(fd, "amount") ?? "",
        siteId: str(fd, "siteId") || null,
        idempotencyKey: str(fd, "idempotencyKey") || null,
      })
    ).claimId;
  } catch (e) {
    return toActionState(e);
  }
  redirect(`/finance/expenses/${id}?created=1`);
}

export async function uploadReceiptAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose the receipt photo or PDF.", fieldErrors: { file: "Choose a file." } };
    await uploadExpenseReceipt(ctx, { claimId: uuid.parse(str(fd, "id")), fileName: file.name, declaredType: file.type, bytes: new Uint8Array(await file.arrayBuffer()), idempotencyKey: str(fd, "idempotencyKey") ?? "" });
    refreshCurrentPage();
    return { ok: true, message: "Receipt attached." };
  } catch (e) {
    return toActionState(e);
  }
}
