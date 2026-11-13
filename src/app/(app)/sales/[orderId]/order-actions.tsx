"use client";
import { useState } from "react";
import { Button, Field, Input } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { allocateFormAction } from "../actions";
import { changeOrderLineAction, emailOrderConfirmationAction } from "../orders/actions";

/**
 * "Set aside the stock" with a confirm step (ADR-131, B-owner problem 13). When an order due earlier needs the same
 * products, the confirm question says so (owner decision: the earliest delivery date goes first).
 */
export function AllocateForm({ orderId, label = "Set aside the stock", confirm }: { orderId: string; label?: string; confirm: string }) {
  return <ActionForm action={allocateFormAction} hidden={{ orderId }} submit={label} variant="cta" size="lg" pending="Setting aside…" confirm={confirm} />;
}

/** ⋯ on one line of a confirmed order: "Change how many" or "Cancel this line", each with a reason (ADR-131). */
export function LineChange({ lineId, productName, qty, sent }: { lineId: string; productName: string; qty: string; sent: string }) {
  const [mode, setMode] = useState<null | "change" | "cancel">(null);
  if (!mode)
    return (
      <div className="mt-1 flex flex-wrap gap-2" data-testid="line-change">
        <Button type="button" variant="ghost" size="sm" onClick={() => setMode("change")}>
          Change how many
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setMode("cancel")}>
          {Number(sent) > 0 ? "Cancel the rest" : "Cancel this line"}
        </Button>
      </div>
    );
  return (
    <ActionForm
      action={changeOrderLineAction}
      hidden={{ lineId, mode }}
      submit={mode === "cancel" ? (Number(sent) > 0 ? "Cancel the rest" : "Cancel this line") : "Save the new amount"}
      variant={mode === "cancel" ? "danger" : "primary"}
      pending="Saving…"
      confirm={mode === "cancel" ? `Take ${productName} off this order${Number(sent) > 0 ? ` (keep the ${sent} already sent)` : ""}? Stock set aside for it is let go.` : undefined}
    >
      {(fe) => (
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)]">
          {mode === "change" && (
            <Field label="How many now (pcs)" htmlFor={`q-${lineId}`} error={fe.qty} hint={Number(sent) > 0 ? `At least ${sent} (already sent).` : `Was ${qty}.`}>
              <Input id={`q-${lineId}`} name="qty" inputMode="numeric" defaultValue={qty} required pattern="\d+" />
            </Field>
          )}
          <Field label="Why (what the customer said)" htmlFor={`r-${lineId}`} error={fe.reason}>
            <Input id={`r-${lineId}`} name="reason" required minLength={3} maxLength={300} placeholder="e.g. Customer phoned: only 25" />
          </Field>
          <Button type="button" variant="ghost" size="sm" onClick={() => setMode(null)}>
            Keep it as it is
          </Button>
        </div>
      )}
    </ActionForm>
  );
}

/** "Email the order confirmation to <email>" (ADR-131). */
export function EmailConfirmation({ orderId, to, canShipFromText }: { orderId: string; to: string; canShipFromText: string }) {
  return <ActionForm action={emailOrderConfirmationAction} hidden={{ orderId, canShipFromText }} submit={`Email the confirmation to ${to}`} variant="secondary" pending="Sending…" />;
}
