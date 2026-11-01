"use client";
import { useState } from "react";
import { Input } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { acknowledgeItemAction } from "./actions";

/**
 * Acknowledge = "I am dealing with it" (audited); stops escalation. Round 4 (UX re-audit C #6): no note box on every
 * row; "Add a note" opens it for the one row that needs it (the list showed 22 open fields).
 */
export function AcknowledgeForm({ id }: { id: string }) {
  const [note, setNote] = useState(false);
  return (
    <ActionForm action={acknowledgeItemAction} hidden={{ id }} submit="I'm on it" pending="Saving…" variant="secondary" size="sm" className="flex flex-wrap items-center gap-2" messageBelow>
      {note ? (
        <Input name="note" placeholder="Note (optional)" maxLength={500} aria-label="Note for the others" className="w-full sm:w-48" autoFocus />
      ) : (
        <button type="button" onClick={() => setNote(true)} className="inline-flex min-h-[44px] items-center rounded-full px-3 text-[13px] font-medium text-primary-text hover:bg-primary-soft" data-testid="add-note">
          Add a note
        </button>
      )}
    </ActionForm>
  );
}
