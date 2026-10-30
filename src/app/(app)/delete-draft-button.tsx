"use client";
import { deleteDraftAction } from "./delete-draft-actions";
import { Card, CardTitle } from "@/ui/core";
import { ActionForm } from "@/ui/form";

export type DraftKind =
  | "material"
  | "product"
  | "supplier"
  | "customer"
  | "formula_revision"
  | "routing_revision"
  | "work_instruction_revision"
  | "inspection_plan"
  | "purchase_request"
  | "purchase_order"
  | "sales_order"
  | "quote"
  | "price_list"
  | "stock_adjustment";

/** A small card at the end of a detail page: what deleting means, and the button. */
export function DeleteDraftCard({ kind, id, what, note }: { kind: DraftKind; id: string; what: string; note?: string }) {
  return (
    <Card>
      <CardTitle>Delete</CardTitle>
      <p className="mb-3 text-[14px] text-fg-2">{note ?? `This ${what} is still a draft and nothing uses it yet, so you can delete it. Once it is sent for approval or used, it can only be cancelled.`}</p>
      <DeleteDraftButton kind={kind} id={id} what={`this ${what}`} />
    </Card>
  );
}

/**
 * "Delete draft" button (ADR-075). Shown only on a draft that was never sent for approval; asks
 * for confirmation first. The server re-checks everything (state, nothing depends on it, creator
 * or editor, site) and refuses with a plain message otherwise.
 */
export function DeleteDraftButton({ kind, id, what, label = "Delete draft" }: { kind: DraftKind; id: string; what: string; label?: string }) {
  return (
    <ActionForm
      action={deleteDraftAction}
      hidden={{ kind, id }}
      submit={label}
      pending="Deleting…"
      variant="danger"
      size="sm"
      className="flex flex-col items-start gap-2"
      messageBelow
      confirm={`Delete ${what}? This cannot be undone. The audit log keeps a copy of what was deleted.`}
    />
  );
}
