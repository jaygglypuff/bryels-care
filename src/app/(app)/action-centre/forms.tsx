"use client";
import { Input } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { acknowledgeItemAction } from "./actions";

/** Acknowledge = "I am dealing with it" (audited); stops escalation. */
export function AcknowledgeForm({ id }: { id: string }) {
  return (
    <ActionForm action={acknowledgeItemAction} hidden={{ id }} submit="Acknowledge" pending="Saving…" variant="secondary" size="sm" className="flex flex-wrap items-center gap-2" messageBelow>
      <Input name="note" placeholder="Note (optional)" maxLength={500} aria-label="Acknowledgement note" className="!min-h-[34px] w-full text-[13px] sm:w-48" />
    </ActionForm>
  );
}
