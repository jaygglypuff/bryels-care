"use client";
import { Field, Input, Select } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { decideDeliveryProblemAction } from "../actions";

/** Purchasing's decision on one delivery problem (ADR-131): three plain choices and what was agreed. */
export function DecideDeliveryProblem({ goodsReceiptLineId, canSendMore }: { goodsReceiptLineId: string; canSendMore: boolean }) {
  return (
    <ActionForm action={decideDeliveryProblemAction} hidden={{ goodsReceiptLineId }} submit="Save the decision" variant="cta" pending="Saving…">
      {(fe) => (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="What happens now" htmlFor={`d-${goodsReceiptLineId}`} error={fe.decision}>
            <Select id={`d-${goodsReceiptLineId}`} name="decision" defaultValue="" required>
              <option value="">Choose…</option>
              {canSendMore && <option value="send_more">The supplier sends the rest</option>}
              <option value="money_back">Ask the supplier for money back (or to take it back)</option>
              <option value="close_rest">Not needed – close the rest</option>
            </Select>
          </Field>
          <Field label="What was agreed" htmlFor={`n-${goodsReceiptLineId}`} error={fe.note}>
            <Input id={`n-${goodsReceiptLineId}`} name="note" required minLength={3} maxLength={500} placeholder="e.g. Called Joy at the supplier: 20 more on Friday" />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}
