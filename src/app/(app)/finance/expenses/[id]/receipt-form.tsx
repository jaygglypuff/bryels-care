"use client";
import { Field, Input } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { uploadReceiptAction } from "../../actions";

/** Receipt photo or PDF (validated and stored privately on the server, docs/security.md §4.6). */
export function ReceiptForm({ id, storageReady }: { id: string; storageReady: boolean }) {
  if (!storageReady) return <p className="text-[13px] text-muted">File storage isn&apos;t set up on this server, so receipts cannot be attached yet. Ask the administrator.</p>;
  return (
    <ActionForm action={uploadReceiptAction} hidden={{ id }} submit="Add the receipt" variant="cta" pending="Adding…">
      {(fe) => (
        <Field label="Photo of the receipt (or a PDF)" htmlFor="e-file" error={fe.file}>
          <Input id="e-file" name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required className="py-2" />
        </Field>
      )}
    </ActionForm>
  );
}
