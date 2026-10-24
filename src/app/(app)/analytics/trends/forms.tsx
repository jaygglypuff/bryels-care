"use client";
import { ActionForm } from "@/ui/form";
import { Input } from "@/ui/core";
import { deleteViewAction, saveViewAction } from "./actions";

/** "Save view" (US-5-16): stores the current selection for the signed-in user only. */
export function SaveViewForm({ config, defaultName }: { config: string; defaultName: string }) {
  return (
    <ActionForm action={saveViewAction} hidden={{ config }} submit="Save view" pending="Saving…" variant="secondary" size="sm" className="flex flex-wrap items-end gap-2">
      {(fe) => (
        <div className="flex min-w-[200px] flex-1 flex-col gap-1">
          <label htmlFor="view-name" className="text-[12px] font-medium text-fg-2">
            View name
          </label>
          <Input id="view-name" name="name" defaultValue={defaultName} maxLength={80} required className="min-h-[38px]" />
          {fe.name && <p className="text-[12px] text-[var(--bad-fg)]">{fe.name}</p>}
        </div>
      )}
    </ActionForm>
  );
}

export function DeleteViewForm({ viewId, name }: { viewId: string; name: string }) {
  return <ActionForm action={deleteViewAction} hidden={{ viewId }} submit="Remove" pending="Removing…" variant="ghost" size="sm" confirm={`Remove the saved view "${name}"?`} className="inline-flex" />;
}
