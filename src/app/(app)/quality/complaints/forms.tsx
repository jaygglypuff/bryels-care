"use client";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import {
  classifyAction,
  closeComplaintAction,
  logComplaintAction,
  raiseDeviationAction,
  reopenComplaintAction,
  resolveComplaintAction,
  startInvestigationAction,
  updateComplaintAction,
} from "./actions";

type Opt = { code: string; label: string };

export function LogComplaintForm({ customers, products, categories, channels, defaultCustomerId, defaultCode }: { customers: { id: string; code: string; name: string }[]; products: { id: string; sku: string; name: string }[]; categories: Opt[]; channels: Opt[]; defaultCustomerId?: string; defaultCode?: string }) {
  return (
    <ActionForm action={logComplaintAction} submit="Log complaint" pending="Logging…" variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer" htmlFor="customerId" error={fe.customerId}>
            <Select id="customerId" name="customerId" required defaultValue={defaultCustomerId ?? ""}>
              <option value="" disabled>
                Choose…
              </option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Lot or box from the label (scan or type)" htmlFor="code" error={fe.code} hint="Checked against the shipments to this customer. Leave empty if the customer does not have it.">
            <Input id="code" name="code" autoComplete="off" defaultValue={defaultCode ?? ""} placeholder="BC:LOT:… or BC:BOX:…" />
          </Field>
          <Field label="Product (when there is no code)" htmlFor="productId" error={fe.productId}>
            <Select id="productId" name="productId" defaultValue="">
              <option value="">From the lot</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" htmlFor="category" error={fe.category} hint="Categories are configured by the company's QA.">
            <Select id="category" name="category" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Received by" htmlFor="channel" error={fe.channel}>
            <Select id="channel" name="channel" defaultValue="phone">
              {channels.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Received at (optional, Manila time)" htmlFor="receivedAt" error={fe.receivedAt} hint="Leave empty for now.">
            <Input id="receivedAt" name="receivedAt" type="datetime-local" />
          </Field>
          <Field label="Customer's reference (optional)" htmlFor="customerReference" error={fe.customerReference}>
            <Input id="customerReference" name="customerReference" maxLength={100} />
          </Field>
          <Field label="Quantity affected (optional)" htmlFor="qtyAffected" error={fe.qtyAffected}>
            <Input id="qtyAffected" name="qtyAffected" inputMode="decimal" autoComplete="off" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="What the customer reports" htmlFor="description" error={fe.description} hint="Customer-facing: this text appears on the acknowledgement.">
              <Textarea id="description" name="description" required minLength={5} maxLength={4000} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Internal notes (optional)" htmlFor="internalNotes" error={fe.internalNotes} hint="Never printed on customer documents.">
              <Textarea id="internalNotes" name="internalNotes" maxLength={4000} />
            </Field>
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-[14px] sm:col-span-2">
            <input type="checkbox" name="sampleReturned" value="yes" className="size-5" /> The customer returned a sample
          </label>
        </div>
      )}
    </ActionForm>
  );
}

function SeverityField({ levels, fe, required }: { levels: string[]; fe: Record<string, string>; required?: boolean }) {
  return (
    <Field label={required ? "Severity" : "Severity (QA, optional)"} htmlFor="severity" error={fe.severity} hint="Classes are configured by the company's QA.">
      <Select id="severity" name="severity" required={required} defaultValue="">
        <option value="" disabled={required}>
          {required ? "Choose…" : "Classify later"}
        </option>
        {levels.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function StartInvestigationForm({ complaintId, levels, canClassify }: { complaintId: string; levels: string[]; canClassify: boolean }) {
  return (
    <ActionForm action={startInvestigationAction} hidden={{ complaintId }} submit="Start investigation" pending="Saving…">
      {(fe) => (
        <>
          {canClassify && <SeverityField levels={levels} fe={fe} />}
          <Field label="Investigation plan" htmlFor="investigation" error={fe.investigation} hint="Internal.">
            <Textarea id="investigation" name="investigation" required maxLength={4000} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function ClassifyForm({ complaintId, levels }: { complaintId: string; levels: string[] }) {
  return (
    <ActionForm action={classifyAction} hidden={{ complaintId }} submit="Record severity" pending="Saving…" variant="secondary">
      {(fe) => <SeverityField levels={levels} fe={fe} required />}
    </ActionForm>
  );
}

export function UpdateComplaintForm({ complaintId, current }: { complaintId: string; current: { investigation: string | null; rootCause: string | null; internalNotes: string | null; customerResponse: string | null } }) {
  return (
    <ActionForm action={updateComplaintAction} hidden={{ complaintId }} submit="Save" pending="Saving…" variant="secondary">
      {(fe) => (
        <>
          <Field label="Investigation (internal)" htmlFor="u-investigation" error={fe.investigation}>
            <Textarea id="u-investigation" name="investigation" defaultValue={current.investigation ?? ""} maxLength={4000} />
          </Field>
          <Field label="Root cause (internal)" htmlFor="u-rootCause" error={fe.rootCause}>
            <Textarea id="u-rootCause" name="rootCause" defaultValue={current.rootCause ?? ""} maxLength={4000} />
          </Field>
          <Field label="Internal notes" htmlFor="u-internalNotes" error={fe.internalNotes} hint="Never printed on customer documents.">
            <Textarea id="u-internalNotes" name="internalNotes" defaultValue={current.internalNotes ?? ""} maxLength={4000} />
          </Field>
          <Field label="Reply to the customer" htmlFor="u-customerResponse" error={fe.customerResponse} hint="Customer-facing: printed on the acknowledgement.">
            <Textarea id="u-customerResponse" name="customerResponse" defaultValue={current.customerResponse ?? ""} maxLength={4000} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function ResolveForm({ complaintId }: { complaintId: string }) {
  return (
    <ActionForm action={resolveComplaintAction} hidden={{ complaintId }} submit="Mark resolved" pending="Saving…">
      {(fe) => (
        <>
          <Field label="Resolution (internal)" htmlFor="resolution" error={fe.resolution} hint="What was found and done.">
            <Textarea id="resolution" name="resolution" required minLength={5} maxLength={4000} />
          </Field>
          <Field label="Root cause (optional, internal)" htmlFor="r-rootCause" error={fe.rootCause}>
            <Textarea id="r-rootCause" name="rootCause" maxLength={4000} />
          </Field>
          <Field label="Reply to the customer (optional)" htmlFor="r-customerResponse" error={fe.customerResponse} hint="Customer-facing.">
            <Textarea id="r-customerResponse" name="customerResponse" maxLength={4000} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function ReopenForm({ complaintId }: { complaintId: string }) {
  return (
    <ActionForm action={reopenComplaintAction} hidden={{ complaintId }} submit="Reopen investigation" pending="Saving…" variant="secondary">
      {(fe) => (
        <Field label="Why" htmlFor="reopen-reason" error={fe.reason}>
          <Input id="reopen-reason" name="reason" required minLength={5} maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}

export function CloseForm({ complaintId }: { complaintId: string }) {
  return (
    <ActionForm action={closeComplaintAction} hidden={{ complaintId }} submit="Close complaint" pending="Closing…" variant="cta" confirm="Close this complaint? It cannot be edited afterwards.">
      {(fe) => (
        <Field label="Closing note (optional)" htmlFor="close-note" error={fe.note}>
          <Input id="close-note" name="note" maxLength={2000} />
        </Field>
      )}
    </ActionForm>
  );
}

export function RaiseDeviationForm({ complaintId }: { complaintId: string }) {
  return (
    <ActionForm action={raiseDeviationAction} hidden={{ complaintId }} submit="Raise deviation" pending="Raising…" variant="secondary">
      {(fe) => (
        <Field label="What QA should investigate" htmlFor="dev-description" error={fe.description}>
          <Textarea id="dev-description" name="description" required minLength={5} maxLength={4000} />
        </Field>
      )}
    </ActionForm>
  );
}
