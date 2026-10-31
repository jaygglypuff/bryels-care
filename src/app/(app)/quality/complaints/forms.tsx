"use client";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { ScanOrPick } from "@/ui/scan-or-pick";
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
    <ActionForm action={logComplaintAction} submit="Save the complaint" pending="Saving…" variant="cta">
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
          <Field label="What kind of problem?" htmlFor="category" error={fe.category} hint="The kinds are set by the company's QA.">
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
          <Field label="Which product?" htmlFor="productId" error={fe.productId} hint="Leave on “From the label” when you scan the label below.">
            <Select id="productId" name="productId" defaultValue="">
              <option value="">From the label</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.sku}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <ScanOrPick
              kind="lot"
              name="code"
              submit="code"
              label="Which lot? (optional)"
              hint="Scan the product label, or type part of the number the customer reads out (for example the last 4 digits) and tap the lot. We check it against what we sent this customer."
              candidates={defaultCode ? [{ value: defaultCode, title: `Lot ${defaultCode}`, code: defaultCode, codes: [defaultCode] }] : []}
              defaultValue={defaultCode}
              error={fe.code}
            />
          </div>
          <div className="sm:col-span-2">
            <Field label="What does the customer report?" htmlFor="description" error={fe.description} hint="The customer sees this text on the letter we send back.">
              <Textarea id="description" name="description" required minLength={5} maxLength={4000} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <MoreDetails>
              <Field label="How did it reach us?" htmlFor="channel" error={fe.channel}>
                <Select id="channel" name="channel" defaultValue="phone">
                  {channels.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="When? (leave empty for now)" htmlFor="receivedAt" error={fe.receivedAt}>
                <Input id="receivedAt" name="receivedAt" type="datetime-local" />
              </Field>
              <Field label="How many pieces are affected? (optional)" htmlFor="qtyAffected" error={fe.qtyAffected}>
                <Input id="qtyAffected" name="qtyAffected" inputMode="decimal" autoComplete="off" />
              </Field>
              <Field label="The customer's own reference (optional)" htmlFor="customerReference" error={fe.customerReference}>
                <Input id="customerReference" name="customerReference" maxLength={100} />
              </Field>
              <Field label="Notes for us only (optional)" htmlFor="internalNotes" error={fe.internalNotes} hint="Never printed for the customer.">
                <Textarea id="internalNotes" name="internalNotes" maxLength={4000} />
              </Field>
              <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
                <input type="checkbox" name="sampleReturned" value="yes" className="size-5" /> The customer gave back a sample
              </label>
            </MoreDetails>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

function SeverityField({ levels, fe, required }: { levels: string[]; fe: Record<string, string>; required?: boolean }) {
  return (
    <Field label={required ? "How serious?" : "How serious? (QA, optional)"} htmlFor="severity" error={fe.severity} hint="The levels are set by the company's QA.">
      <Select id="severity" name="severity" required={required} defaultValue="">
        <option value="" disabled={required}>
          {required ? "Choose…" : "Decide later"}
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
    <ActionForm action={startInvestigationAction} hidden={{ complaintId }} submit="Start looking into it" pending="Saving…" variant="cta">
      {(fe) => (
        <>
          {canClassify && <SeverityField levels={levels} fe={fe} />}
          <Field label="What will QA check?" htmlFor="investigation" error={fe.investigation} hint="For us only.">
            <Textarea id="investigation" name="investigation" required maxLength={4000} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function ClassifyForm({ complaintId, levels }: { complaintId: string; levels: string[] }) {
  return (
    <ActionForm action={classifyAction} hidden={{ complaintId }} submit="Save how serious" pending="Saving…" variant="secondary">
      {(fe) => <SeverityField levels={levels} fe={fe} required />}
    </ActionForm>
  );
}

export function UpdateComplaintForm({ complaintId, current }: { complaintId: string; current: { investigation: string | null; rootCause: string | null; internalNotes: string | null; customerResponse: string | null } }) {
  return (
    <ActionForm action={updateComplaintAction} hidden={{ complaintId }} submit="Save" pending="Saving…" variant="secondary">
      {(fe) => (
        <>
          <Field label="What QA checks (for us only)" htmlFor="u-investigation" error={fe.investigation}>
            <Textarea id="u-investigation" name="investigation" defaultValue={current.investigation ?? ""} maxLength={4000} />
          </Field>
          <Field label="What caused it (for us only)" htmlFor="u-rootCause" error={fe.rootCause}>
            <Textarea id="u-rootCause" name="rootCause" defaultValue={current.rootCause ?? ""} maxLength={4000} />
          </Field>
          <Field label="Notes for us only" htmlFor="u-internalNotes" error={fe.internalNotes} hint="Never printed for the customer.">
            <Textarea id="u-internalNotes" name="internalNotes" defaultValue={current.internalNotes ?? ""} maxLength={4000} />
          </Field>
          <Field label="Answer to the customer" htmlFor="u-customerResponse" error={fe.customerResponse} hint="The customer sees this on the letter.">
            <Textarea id="u-customerResponse" name="customerResponse" defaultValue={current.customerResponse ?? ""} maxLength={4000} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function ResolveForm({ complaintId }: { complaintId: string }) {
  return (
    <ActionForm action={resolveComplaintAction} hidden={{ complaintId }} submit="Save the answer" pending="Saving…" variant="cta">
      {(fe) => (
        <>
          <Field label="What did QA find and do? (for us only)" htmlFor="resolution" error={fe.resolution}>
            <Textarea id="resolution" name="resolution" required minLength={5} maxLength={4000} />
          </Field>
          <Field label="Answer to the customer (optional)" htmlFor="r-customerResponse" error={fe.customerResponse} hint="The customer sees this on the letter.">
            <Textarea id="r-customerResponse" name="customerResponse" maxLength={4000} />
          </Field>
          <MoreDetails>
            <Field label="What caused it (optional, for us only)" htmlFor="r-rootCause" error={fe.rootCause}>
              <Textarea id="r-rootCause" name="rootCause" maxLength={4000} />
            </Field>
          </MoreDetails>
        </>
      )}
    </ActionForm>
  );
}

export function ReopenForm({ complaintId }: { complaintId: string }) {
  return (
    <ActionForm action={reopenComplaintAction} hidden={{ complaintId }} submit="Look into it again" pending="Saving…" variant="secondary">
      {(fe) => (
        <Field label="Why look again?" htmlFor="reopen-reason" error={fe.reason}>
          <Input id="reopen-reason" name="reason" required minLength={5} maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}

export function CloseForm({ complaintId }: { complaintId: string }) {
  return (
    <ActionForm action={closeComplaintAction} hidden={{ complaintId }} submit="Close the complaint" pending="Closing…" variant="cta" confirm="Close this complaint? It cannot be changed afterwards.">
      {(fe) => (
        <Field label="Note (optional)" htmlFor="close-note" error={fe.note}>
          <Input id="close-note" name="note" maxLength={2000} />
        </Field>
      )}
    </ActionForm>
  );
}

export function RaiseDeviationForm({ complaintId }: { complaintId: string }) {
  return (
    <ActionForm action={raiseDeviationAction} hidden={{ complaintId }} submit="Send problem report" pending="Sending…" variant="secondary">
      {(fe) => (
        <Field label="What should QA look into?" htmlFor="dev-description" error={fe.description}>
          <Textarea id="dev-description" name="description" required minLength={5} maxLength={4000} />
        </Field>
      )}
    </ActionForm>
  );
}
