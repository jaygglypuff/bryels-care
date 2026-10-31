"use client";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import {
  addLineAction,
  approveReturnAction,
  cancelReturnAction,
  closeReturnAction,
  createReturnAction,
  inspectReturnAction,
  postReturnAction,
  removeLineAction,
  sendBackReturnAction,
  submitReturnAction,
} from "./actions";

type Loc = { id: string; code: string; name: string; kind: string };

export function NewReturnForm({ shipments, preselect, complaint, reasons, locations }: { shipments: { id: string; drNumber: string; orderNumber: string; customerName: string; siteCode: string; dispatchedAt: string }[]; preselect: string | null; complaint: { id: string; number: string } | null; reasons: { code: string; label: string; requiresNote: boolean }[]; locations: Loc[] }) {
  return (
    <ActionForm action={createReturnAction} hidden={{ complaintId: complaint?.id }} submit="Start the customer return" pending="Starting…" variant="cta" size="lg">
      {(fe) => (
        <div className="grid gap-4">
          <Field label="Which delivery did it come from?" htmlFor="shipmentId" error={fe.shipmentId} hint="Customer · day it was sent · delivery receipt">
            <Select id="shipmentId" name="shipmentId" required defaultValue={preselect ?? ""}>
              <option value="" disabled>
                Choose the delivery…
              </option>
              {shipments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.customerName} · sent {s.dispatchedAt} · {s.drNumber} · {s.orderNumber}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Why did it come back?" htmlFor="reasonCode" error={fe.reasonCode}>
            <Select id="reasonCode" name="reasonCode" required defaultValue={complaint ? "quality_complaint" : ""}>
              <option value="" disabled>
                Choose…
              </option>
              {reasons.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                  {r.requiresNote ? " (explain)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Explain (needed for some reasons)" htmlFor="reasonNote" error={fe.reasonNote}>
            <Input id="reasonNote" name="reasonNote" maxLength={500} />
          </Field>
          <MoreDetails open={!!fe.toLocationId}>
            <Field label="Where to keep it" htmlFor="toLocationId" error={fe.toLocationId} hint="Returned goods are kept apart until QA checks them.">
              <Select id="toLocationId" name="toLocationId" defaultValue="">
                <option value="">The usual returns place</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.code})
                  </option>
                ))}
              </Select>
            </Field>
          </MoreDetails>
          {complaint && <p className="text-[13px] text-muted">Linked to complaint {complaint.number}.</p>}
        </div>
      )}
    </ActionForm>
  );
}

export function ScanLineForm({ returnId, locations, defaultLocationId }: { returnId: string; locations: Loc[]; defaultLocationId: string }) {
  return (
    <ActionForm action={addLineAction} hidden={{ returnId }} submit="Add to the return" pending="Adding…" variant="cta" size="lg">
      {(fe) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Scan the box or lot label" htmlFor="code" error={fe.code} hint="Or type the number on the label.">
              <Input id="code" name="code" required autoFocus autoComplete="off" inputMode="text" className="min-h-[52px] text-[17px]" />
            </Field>
          </div>
          <Field label="How many came back" htmlFor="qty" error={fe.qty} hint="Not more than was sent on this delivery.">
            <Input id="qty" name="qty" inputMode="decimal" autoComplete="off" />
          </Field>
          <Field label="How does it look?" htmlFor="condition" error={fe.condition}>
            <Select id="condition" name="condition" defaultValue="unknown">
              <option value="unknown">Not looked at yet</option>
              <option value="sellable">Looks OK to sell</option>
              <option value="damaged">Damaged</option>
              <option value="expired">Expired</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <MoreDetails open={!!(fe.toLocationId || fe.note)}>
              <Field label="Where to keep it" htmlFor="toLocationId" error={fe.toLocationId}>
                <Select id="toLocationId" name="toLocationId" defaultValue={defaultLocationId}>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.code})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Note (optional)" htmlFor="note" error={fe.note}>
                <Input id="note" name="note" maxLength={500} />
              </Field>
              <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
                <input type="checkbox" name="manualEntry" value="yes" className="size-5" /> The label cannot be read: I typed the number
              </label>
            </MoreDetails>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function RemoveLineButton({ returnId, lineId }: { returnId: string; lineId: string }) {
  return <ActionForm action={removeLineAction} hidden={{ returnId, lineId }} submit="Remove" pending="Removing…" variant="secondary" size="sm" className="flex flex-col gap-1" />;
}

export function SubmitReturnButton({ returnId }: { returnId: string }) {
  return <ActionForm action={submitReturnAction} hidden={{ returnId }} submit="Send for approval" pending="Sending…" variant="cta" size="lg" />;
}

export function ApproveReturnForm({ returnId }: { returnId: string }) {
  return (
    <ActionForm action={approveReturnAction} hidden={{ returnId }} submit="Approve the return" pending="Approving…" variant="cta" size="lg">
      {(fe) => (
        <Field label="Approval note (optional)" htmlFor="approve-note" error={fe.note}>
          <Input id="approve-note" name="note" maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}

export function SendBackForm({ returnId }: { returnId: string }) {
  return (
    <ActionForm action={sendBackReturnAction} hidden={{ returnId }} submit="Send back to draft" pending="Sending…" variant="secondary">
      {(fe) => (
        <Field label="What needs fixing?" htmlFor="sendback-reason" error={fe.reason}>
          <Input id="sendback-reason" name="reason" required minLength={5} maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}

export function PostReturnButton({ returnId }: { returnId: string }) {
  return <ActionForm action={postReturnAction} hidden={{ returnId }} submit="Take it in (kept apart for QA)" pending="Taking it in…" variant="cta" size="lg" confirm="The returned goods go into stock, kept apart until QA checks them. This can only be undone by a reversal. Take it in?" />;
}

export function InspectReturnButton({ returnId }: { returnId: string }) {
  return <ActionForm action={inspectReturnAction} hidden={{ returnId }} submit="QA has decided every lot" pending="Saving…" variant="cta" size="lg" />;
}

export function CloseReturnButton({ returnId }: { returnId: string }) {
  return <ActionForm action={closeReturnAction} hidden={{ returnId }} submit="Finish the return" pending="Finishing…" variant="cta" size="lg" />;
}

export function CancelReturnForm({ returnId }: { returnId: string }) {
  return (
    <ActionForm action={cancelReturnAction} hidden={{ returnId }} submit="Cancel the return" pending="Cancelling…" variant="secondary" confirm="Cancel this return?">
      {(fe) => (
        <Field label="Why?" htmlFor="cancel-reason" error={fe.reason}>
          <Textarea id="cancel-reason" name="reason" required minLength={5} maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}
