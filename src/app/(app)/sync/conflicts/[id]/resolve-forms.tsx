"use client";
import { Card, CardTitle, Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { resolveConflictAction } from "../../actions";

/**
 * The resolution choices (docs/offline-sync.md §5): keep the server's version (discard with a
 * note), re-apply as a new change with corrected values, or escalate to a deviation or a stock
 * adjustment draft. The server re-checks everything; these forms only submit.
 */
export function ResolveForms({
  conflictId,
  editable,
  ownDiscardOnly,
  canEscalateAdjustment,
  canEscalateDeviation,
  reasonCodes,
}: {
  conflictId: string;
  editable: { key: string; label: string; value: string }[];
  ownDiscardOnly: boolean;
  canEscalateAdjustment: boolean;
  canEscalateDeviation: boolean;
  reasonCodes: { code: string; label: string }[];
}) {
  const note = (id: string, fe: Record<string, string>, placeholder: string) => (
    <Field label="Resolution note" htmlFor={id} error={fe.note}>
      <Textarea id={id} name="note" required minLength={5} maxLength={1000} placeholder={placeholder} />
    </Field>
  );
  return (
    <Card>
      <CardTitle>Resolve</CardTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-[16px] border border-line p-4">
          <h3 className="mb-2 font-medium">Keep the server&apos;s version</h3>
          <p className="mb-3 text-[13px] text-muted">The device&apos;s change is discarded and never applied. The note is kept in the audit trail.</p>
          <ActionForm action={resolveConflictAction} hidden={{ conflictId, choice: "discard" }} submit="Discard the device's change" variant="secondary" confirm="Discard this offline change? It will not be applied.">
            {(fe) => note(`note-discard-${conflictId}`, fe, "Why the server's version is right, e.g. counted again, nothing missing")}
          </ActionForm>
        </section>
        {!ownDiscardOnly && (
          <section className="rounded-[16px] border border-line p-4">
            <h3 className="mb-2 font-medium">Re-apply as a new change</h3>
            <p className="mb-3 text-[13px] text-muted">Runs again now, as the person who captured it, with their current permissions and the current stock and record state. Correct a value if needed.</p>
            <ActionForm action={resolveConflictAction} hidden={{ conflictId, choice: "reapply" }} submit="Re-apply">
              {(fe) => (
                <>
                  {editable.map((f) => (
                    <Field key={f.key} label={f.label} htmlFor={`ov-${f.key}`}>
                      <Input id={`ov-${f.key}`} name={`override.${f.key}`} defaultValue={f.value} />
                    </Field>
                  ))}
                  {note(`note-reapply-${conflictId}`, fe, "What was checked, e.g. operator confirmed 12 pcs")}
                </>
              )}
            </ActionForm>
          </section>
        )}
        {canEscalateDeviation && (
          <section className="rounded-[16px] border border-line p-4">
            <h3 className="mb-2 font-medium">Escalate to a deviation</h3>
            <p className="mb-3 text-[13px] text-muted">For production problems: QA investigates in the deviation; the offline change itself is not applied.</p>
            <ActionForm action={resolveConflictAction} hidden={{ conflictId, choice: "escalate_deviation" }} submit="Escalate to deviation" variant="secondary">
              {(fe) => note(`note-dev-${conflictId}`, fe, "What QA should look at")}
            </ActionForm>
          </section>
        )}
        {canEscalateAdjustment && (
          <section className="rounded-[16px] border border-line p-4">
            <h3 className="mb-2 font-medium">Escalate to a stock adjustment</h3>
            <p className="mb-3 text-[13px] text-muted">Drafts an adjustment for this lot and location; it follows the normal approval before anything posts.</p>
            <ActionForm action={resolveConflictAction} hidden={{ conflictId, choice: "escalate_adjustment" }} submit="Draft adjustment" variant="secondary">
              {(fe) => (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Direction" htmlFor={`dir-${conflictId}`}>
                      <Select id={`dir-${conflictId}`} name="direction" defaultValue="decrease">
                        <option value="decrease">Decrease</option>
                        <option value="increase">Increase</option>
                      </Select>
                    </Field>
                    <Field label="Quantity (base unit)" htmlFor={`qty-${conflictId}`}>
                      <Input id={`qty-${conflictId}`} name="qty" inputMode="decimal" required />
                    </Field>
                  </div>
                  <Field label="Reason" htmlFor={`rc-${conflictId}`}>
                    <Select id={`rc-${conflictId}`} name="reasonCode" required>
                      {reasonCodes.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {note(`note-adj-${conflictId}`, fe, "Why the stock record needs adjusting")}
                </>
              )}
            </ActionForm>
          </section>
        )}
      </div>
    </Card>
  );
}
