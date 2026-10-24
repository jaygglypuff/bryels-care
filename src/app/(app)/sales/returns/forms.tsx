"use client";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
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
    <ActionForm action={createReturnAction} hidden={{ complaintId: complaint?.id }} submit="Open return" pending="Opening…" variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Shipment (delivery receipt)" htmlFor="shipmentId" error={fe.shipmentId}>
              <Select id="shipmentId" name="shipmentId" required defaultValue={preselect ?? ""}>
                <option value="" disabled>
                  Choose…
                </option>
                {shipments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.drNumber} · {s.orderNumber} · {s.customerName} · {s.siteCode} · {s.dispatchedAt}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Reason" htmlFor="reasonCode" error={fe.reasonCode}>
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
          <Field label="Receive into" htmlFor="toLocationId" error={fe.toLocationId} hint="Returned stock arrives in quarantine.">
            <Select id="toLocationId" name="toLocationId" defaultValue="">
              <option value="">Site default (customer-returns cage)</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Note (optional; required for some reasons)" htmlFor="reasonNote" error={fe.reasonNote}>
              <Input id="reasonNote" name="reasonNote" maxLength={500} />
            </Field>
          </div>
          {complaint && <p className="text-[13px] text-muted sm:col-span-2">Linked to complaint {complaint.number}.</p>}
        </div>
      )}
    </ActionForm>
  );
}

export function ScanLineForm({ returnId, locations, defaultLocationId }: { returnId: string; locations: Loc[]; defaultLocationId: string }) {
  return (
    <ActionForm action={addLineAction} hidden={{ returnId }} submit="Add line" pending="Adding…" variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Scan the box or lot label" htmlFor="code" error={fe.code} hint="BC:BOX:… or BC:LOT:…; a typed number works too.">
              <Input id="code" name="code" required autoFocus autoComplete="off" inputMode="text" />
            </Field>
          </div>
          <Field label="Quantity returned" htmlFor="qty" error={fe.qty} hint="Not more than was shipped on this delivery receipt.">
            <Input id="qty" name="qty" inputMode="decimal" autoComplete="off" />
          </Field>
          <Field label="Condition" htmlFor="condition" error={fe.condition}>
            <Select id="condition" name="condition" defaultValue="unknown">
              <option value="unknown">Not assessed</option>
              <option value="sellable">Looks sellable</option>
              <option value="damaged">Damaged</option>
              <option value="expired">Expired</option>
            </Select>
          </Field>
          <Field label="Into location" htmlFor="toLocationId" error={fe.toLocationId}>
            <Select id="toLocationId" name="toLocationId" defaultValue={defaultLocationId}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note (optional)" htmlFor="note" error={fe.note}>
            <Input id="note" name="note" maxLength={500} />
          </Field>
          <label className="flex min-h-[44px] items-center gap-2 text-[14px] sm:col-span-2">
            <input type="checkbox" name="manualEntry" value="yes" className="size-5" /> Label unreadable: number typed by hand
          </label>
        </div>
      )}
    </ActionForm>
  );
}

export function RemoveLineButton({ returnId, lineId }: { returnId: string; lineId: string }) {
  return <ActionForm action={removeLineAction} hidden={{ returnId, lineId }} submit="Remove" pending="Removing…" variant="secondary" size="sm" className="flex flex-col gap-1" />;
}

export function SubmitReturnButton({ returnId }: { returnId: string }) {
  return <ActionForm action={submitReturnAction} hidden={{ returnId }} submit="Submit for approval" pending="Submitting…" />;
}

export function ApproveReturnForm({ returnId }: { returnId: string }) {
  return (
    <ActionForm action={approveReturnAction} hidden={{ returnId }} submit="Approve return" pending="Approving…" variant="cta">
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
        <Field label="What needs correcting" htmlFor="sendback-reason" error={fe.reason}>
          <Input id="sendback-reason" name="reason" required minLength={5} maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}

export function PostReturnButton({ returnId }: { returnId: string }) {
  return <ActionForm action={postReturnAction} hidden={{ returnId }} submit="Receive into quarantine" pending="Posting…" variant="cta" confirm="This posts the returned stock into quarantine. It cannot be undone without a reversal. Continue?" />;
}

export function InspectReturnButton({ returnId }: { returnId: string }) {
  return <ActionForm action={inspectReturnAction} hidden={{ returnId }} submit="Mark dispositioned" pending="Saving…" />;
}

export function CloseReturnButton({ returnId }: { returnId: string }) {
  return <ActionForm action={closeReturnAction} hidden={{ returnId }} submit="Close return" pending="Closing…" variant="secondary" />;
}

export function CancelReturnForm({ returnId }: { returnId: string }) {
  return (
    <ActionForm action={cancelReturnAction} hidden={{ returnId }} submit="Cancel return" pending="Cancelling…" variant="secondary" confirm="Cancel this return?">
      {(fe) => (
        <Field label="Reason" htmlFor="cancel-reason" error={fe.reason}>
          <Textarea id="cancel-reason" name="reason" required minLength={5} maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}
