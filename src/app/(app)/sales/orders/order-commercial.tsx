"use client";
import { useState } from "react";
import { Button, Field, Input, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { approveOrderAction, reorderAction, returnOrderAction, submitOrderAction, voidOrderAction } from "./actions";

/** Draft → submit (customer requirements, minimum order, credit and approval check). The server decides: confirmed, or pending approval with the reason. */
export function SubmitOrderForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm action={submitOrderAction} hidden={{ orderId }} submit="Send the order" pending="Checking credit and approvals…" variant="cta" size="lg" />
  );
}

export function ApproveOrderForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm action={approveOrderAction} hidden={{ orderId }} submit="Approve and confirm" pending="Approving…" variant="cta">
      {(fe) => (
        <Field label="Approval note (optional)" htmlFor="approve-note" error={fe.note}>
          <Textarea id="approve-note" name="note" maxLength={500} className="min-h-[56px]" placeholder="e.g. Customer paid the overdue invoice" />
        </Field>
      )}
    </ActionForm>
  );
}

function ReasonForm({ orderId, action, button, label, placeholder, confirm, variant = "secondary" }: { orderId: string; action: typeof returnOrderAction; button: string; label: string; placeholder: string; confirm?: string; variant?: "secondary" | "danger" }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {button}
      </Button>
    );
  return (
    <div className="rounded-[12px] border border-line p-3">
      <ActionForm action={action} hidden={{ orderId }} submit={button} pending="Saving…" variant={variant} confirm={confirm}>
        {(fe) => (
          <Field label={label} htmlFor={`${button}-reason`} error={fe.reason}>
            <Input id={`${button}-reason`} name="reason" required minLength={3} maxLength={300} placeholder={placeholder} />
          </Field>
        )}
      </ActionForm>
      <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setOpen(false)}>
        Close
      </Button>
    </div>
  );
}

export function ReturnOrderForm({ orderId }: { orderId: string }) {
  return <ReasonForm orderId={orderId} action={returnOrderAction} button="Send back to draft" label="What needs to change?" placeholder="e.g. Split into two deliveries" />;
}

export function CancelOrderPanel({ orderId, hasAllocations }: { orderId: string; hasAllocations: boolean }) {
  return (
    <ReasonForm
      orderId={orderId}
      action={voidOrderAction}
      button="Cancel order"
      label="Reason for cancelling"
      placeholder="e.g. Customer withdrew the PO"
      variant="danger"
      confirm={`Cancel this order? This cannot be undone.${hasAllocations ? " The stock set aside for it becomes free." : ""}`}
    />
  );
}

export function ReorderForm({ orderId, today }: { orderId: string; today: string }) {
  return (
    <ActionForm action={reorderAction} hidden={{ orderId }} submit="Make a new order like this" pending="Making the draft…" variant="secondary" className="flex flex-col gap-2">
      {(fe) => (
        <Field label="Deliver the new order by" htmlFor="reorder-date" error={fe.requestedDeliveryOn ?? fe.form}>
          <Input id="reorder-date" name="requestedDeliveryOn" type="date" min={today} required />
        </Field>
      )}
    </ActionForm>
  );
}
