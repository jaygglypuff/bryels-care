"use client";
import { useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import {
  addAddressAction,
  addContactAction,
  addressCommandAction,
  contactCommandAction,
  createArtworkAction,
  creditTermsAction,
  customerStatusAction,
  draftRequirementAction,
  itemCodeAction,
  requirementCommandAction,
  updateCustomerAction,
} from "../actions";

/** Collapsible panel so the customer page stays short on a phone. */
function Toggle({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <div className="mt-3 rounded-[12px] border border-line p-3">
      {children}
      <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setOpen(false)}>
        Close
      </Button>
    </div>
  ) : (
    <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => setOpen(true)}>
      {label}
    </Button>
  );
}

export function ProfileForm({ c, segments }: { c: { id: string; name: string; segment: string | null; minShelfLifeDays: number; defaultLeadTimeDays: number | null; notesInternal: string | null }; segments: { value: string; label: string }[] }) {
  return (
    <Toggle label="Edit profile">
      <ActionForm action={updateCustomerAction} hidden={{ customerId: c.id }} submit="Save profile">
        {(fe) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="p-name" error={fe.name}>
              <Input id="p-name" name="name" defaultValue={c.name} required maxLength={120} />
            </Field>
            <Field label="Customer type" htmlFor="p-segment" error={fe.segment} hint="To add a type, go to Master data → Lists.">
              <Select id="p-segment" name="segment" defaultValue={c.segment ?? ""}>
                {([["", "—"], ...segments.map((o) => [o.value, o.label])] as [string, string][]).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Min shelf life at dispatch (days)" htmlFor="p-shelf" error={fe.minShelfLifeDays}>
              <Input id="p-shelf" name="minShelfLifeDays" defaultValue={c.minShelfLifeDays} inputMode="numeric" required />
            </Field>
            <Field label="Default lead time (days)" htmlFor="p-lead" error={fe.defaultLeadTimeDays}>
              <Input id="p-lead" name="defaultLeadTimeDays" defaultValue={c.defaultLeadTimeDays ?? ""} inputMode="numeric" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Internal notes" htmlFor="p-notes" error={fe.notesInternal}>
                <Textarea id="p-notes" name="notesInternal" defaultValue={c.notesInternal ?? ""} maxLength={1000} />
              </Field>
            </div>
          </div>
        )}
      </ActionForm>
    </Toggle>
  );
}

export function CreditTermsForm({ c }: { c: { id: string; creditLimitAmount?: string | null; paymentTermsDays?: number | null; taxIdentifier?: string | null } }) {
  return (
    <Toggle label="Change credit terms">
      <ActionForm action={creditTermsAction} hidden={{ customerId: c.id }} submit="Save credit terms">
        {(fe) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Credit limit (₱)" htmlFor="ct-limit" error={fe.creditLimitAmount} hint="Empty = no limit set">
              <Input id="ct-limit" name="creditLimitAmount" defaultValue={c.creditLimitAmount ? String(Number(c.creditLimitAmount)) : ""} inputMode="decimal" />
            </Field>
            <Field label="Payment terms (days)" htmlFor="ct-terms" error={fe.paymentTermsDays}>
              <Input id="ct-terms" name="paymentTermsDays" defaultValue={c.paymentTermsDays ?? ""} inputMode="numeric" />
            </Field>
            <Field label="Tax identifier" htmlFor="ct-tin" error={fe.taxIdentifier} hint="Format checked by the company's accountant">
              <Input id="ct-tin" name="taxIdentifier" defaultValue={c.taxIdentifier ?? ""} maxLength={40} />
            </Field>
            <Field label="Reason" htmlFor="ct-reason" error={fe.reason}>
              <Input id="ct-reason" name="reason" required minLength={3} maxLength={300} placeholder="e.g. Annual credit review" />
            </Field>
          </div>
        )}
      </ActionForm>
    </Toggle>
  );
}

export function StatusForm({ customerId, options }: { customerId: string; options: { to: string; label: string }[] }) {
  if (options.length === 0) return null;
  return (
    <Toggle label="Change status">
      <ActionForm action={customerStatusAction} hidden={{ customerId }} submit="Change status">
        {(fe) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="New status" htmlFor="st-to" error={fe.to}>
              <Select id="st-to" name="to" required>
                {options.map((o) => (
                  <option key={o.to} value={o.to}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reason" htmlFor="st-reason" error={fe.reason}>
              <Input id="st-reason" name="reason" required minLength={3} maxLength={300} />
            </Field>
          </div>
        )}
      </ActionForm>
    </Toggle>
  );
}

export function AddressCommand({ addressId, command, label, variant = "ghost", confirm }: { addressId: string; command: "default_ship_to" | "default_bill_to" | "remove"; label: string; variant?: "ghost" | "secondary"; confirm?: string }) {
  return <ActionForm action={addressCommandAction} hidden={{ addressId, command }} submit={label} pending="…" variant={variant} size="sm" confirm={confirm} className="inline-flex flex-col gap-1" messageBelow />;
}

export function AddAddressForm({ customerId }: { customerId: string }) {
  return (
    <Toggle label="Add address">
      <ActionForm action={addAddressAction} hidden={{ customerId }} submit="Add address">
        {(fe) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Address name" htmlFor="a-label" error={fe.label}>
              <Input id="a-label" name="label" required maxLength={60} placeholder="e.g. Pasig branch" />
            </Field>
            <Field label="Street address" htmlFor="a-line1" error={fe.line1}>
              <Input id="a-line1" name="line1" required maxLength={200} />
            </Field>
            <Field label="City or municipality" htmlFor="a-city" error={fe.city}>
              <Input id="a-city" name="city" required maxLength={80} />
            </Field>
            <Field label="Province (optional)" htmlFor="a-province" error={fe.province}>
              <Input id="a-province" name="province" maxLength={80} />
            </Field>
            <Field label="Receiving contact (optional)" htmlFor="a-contact" error={fe.contactName}>
              <Input id="a-contact" name="contactName" maxLength={80} />
            </Field>
            <Field label="Phone (optional)" htmlFor="a-phone" error={fe.phone}>
              <Input id="a-phone" name="phone" maxLength={40} type="tel" />
            </Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" name="makeDefaultShipTo" /> Make this the default ship-to
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" name="makeDefaultBillTo" /> Make this the default bill-to
            </label>
          </div>
        )}
      </ActionForm>
    </Toggle>
  );
}

export function ContactCommand({ contactId, command, label, confirm }: { contactId: string; command: "primary" | "remove"; label: string; confirm?: string }) {
  return <ActionForm action={contactCommandAction} hidden={{ contactId, command }} submit={label} pending="…" variant="ghost" size="sm" confirm={confirm} className="inline-flex flex-col gap-1" messageBelow />;
}

export function AddContactForm({ customerId }: { customerId: string }) {
  return (
    <Toggle label="Add contact">
      <ActionForm action={addContactAction} hidden={{ customerId }} submit="Add contact">
        {(fe) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="k-name" error={fe.name}>
              <Input id="k-name" name="name" required maxLength={80} />
            </Field>
            <Field label="Role" htmlFor="k-role" error={fe.roleLabel}>
              <Input id="k-role" name="roleLabel" maxLength={60} placeholder="e.g. Buyer" />
            </Field>
            <Field label="Phone" htmlFor="k-phone" error={fe.phone}>
              <Input id="k-phone" name="phone" type="tel" maxLength={40} />
            </Field>
            <Field label="Email" htmlFor="k-email" error={fe.email}>
              <Input id="k-email" name="email" type="email" />
            </Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" name="isPrimary" /> Primary contact
            </label>
          </div>
        )}
      </ActionForm>
    </Toggle>
  );
}

const KINDS: [string, string, "number" | "boolean" | "text" | "artwork"][] = [
  ["min_remaining_shelf_life_days", "Minimum remaining shelf life at dispatch (days)", "number"],
  ["moq", "Minimum order quantity (pcs)", "number"],
  ["carton_count", "Units per carton", "number"],
  ["lead_time", "Lead time (days)", "number"],
  ["lot_age_max_days", "Maximum lot age at dispatch (days)", "number"],
  ["label_artwork", "Label artwork version", "artwork"],
  ["coa_required", "Certificate of analysis with each delivery", "boolean"],
  ["full_shipment_required", "Full shipment required", "boolean"],
  ["packaging", "Packaging instructions", "text"],
  ["shipping_marks", "Shipping marks", "text"],
  ["document", "Required document", "text"],
  ["other", "Other", "text"],
];

export function RequirementForm({ customerId, products, artwork, today }: { customerId: string; products: { id: string; skuCode: string; name: string }[]; artwork: { id: string; label: string; productId: string }[]; today: string }) {
  const [kind, setKind] = useState(KINDS[0][0]);
  const mode = KINDS.find((k) => k[0] === kind)![2];
  return (
    <Toggle label="New requirement version">
      <ActionForm action={draftRequirementAction} hidden={{ customerId }} submit="Save requirement">
        {(fe) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Requirement" htmlFor="r-kind" error={fe.requirementKind}>
              <Select id="r-kind" name="requirementKind" value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Product" htmlFor="r-product" error={fe.productId} hint="Empty = all products of the customer">
              <Select id="r-product" name="productId" defaultValue="">
                <option value="">All products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.skuCode} · {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            {mode === "number" && (
              <Field label="Value" htmlFor="r-num" error={fe.valueNumeric}>
                <Input id="r-num" name="valueNumeric" inputMode="numeric" required />
              </Field>
            )}
            {mode === "boolean" && (
              <Field label="Value" htmlFor="r-bool" error={fe.valueText}>
                <Select id="r-bool" name="valueText" defaultValue="true">
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </Select>
              </Field>
            )}
            {mode === "text" && (
              <Field label="Value" htmlFor="r-text" error={fe.valueText}>
                <Textarea id="r-text" name="valueText" required maxLength={500} />
              </Field>
            )}
            {mode === "artwork" && (
              <Field label="Artwork version" htmlFor="r-art" error={fe.artworkVersionId} hint={artwork.length ? undefined : "Register an artwork version first (below)."}>
                <Select id="r-art" name="artworkVersionId" required>
                  <option value="">Choose…</option>
                  {artwork.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Effective from" htmlFor="r-from" error={fe.effectiveFrom}>
              <Input id="r-from" name="effectiveFrom" type="date" defaultValue={today} required />
            </Field>
            <div className="sm:col-span-2">
              <Field label="What changed (optional)" htmlFor="r-summary" error={fe.changeSummary}>
                <Input id="r-summary" name="changeSummary" maxLength={300} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" name="submitNow" defaultChecked /> Send for approval now
            </label>
          </div>
        )}
      </ActionForm>
    </Toggle>
  );
}

export function RequirementCommand({ requirementId, command, label, needsReason, variant = "secondary" }: { requirementId: string; command: "submit" | "approve" | "return" | "reject" | "retire"; label: string; needsReason?: boolean; variant?: "secondary" | "cta" | "ghost" }) {
  if (!needsReason) return <ActionForm action={requirementCommandAction} hidden={{ requirementId, command }} submit={label} pending="…" variant={variant} size="sm" className="inline-flex flex-col gap-1" messageBelow />;
  return (
    <Toggle label={label}>
      <ActionForm action={requirementCommandAction} hidden={{ requirementId, command }} submit={label} size="sm">
        {(fe) => (
          <Field label="Reason" htmlFor={`rr-${requirementId}-${command}`} error={fe.reason}>
            <Input id={`rr-${requirementId}-${command}`} name="reason" required minLength={3} maxLength={300} />
          </Field>
        )}
      </ActionForm>
    </Toggle>
  );
}

export function ArtworkForm({ customerId, products }: { customerId: string; products: { id: string; skuCode: string; name: string }[] }) {
  return (
    <Toggle label="Register artwork version">
      <ActionForm action={createArtworkAction} hidden={{ customerId }} submit="Register artwork">
        {(fe) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Product" htmlFor="aw-product" error={fe.productId}>
              <Select id="aw-product" name="productId" required>
                <option value="">Choose…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.skuCode} · {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Artwork code" htmlFor="aw-code" error={fe.artworkCode}>
              <Input id="aw-code" name="artworkCode" required maxLength={40} placeholder="e.g. ART-MPG-GBS" />
            </Field>
            <Field label="Version" htmlFor="aw-ver" error={fe.versionLabel}>
              <Input id="aw-ver" name="versionLabel" required maxLength={20} placeholder="v1" />
            </Field>
            <Field label="Description" htmlFor="aw-desc" error={fe.description}>
              <Input id="aw-desc" name="description" maxLength={300} />
            </Field>
          </div>
        )}
      </ActionForm>
    </Toggle>
  );
}

export function ItemCodeForm({ customerId, products }: { customerId: string; products: { id: string; skuCode: string; name: string }[] }) {
  return (
    <Toggle label="Map a customer item code">
      <ActionForm action={itemCodeAction} hidden={{ customerId }} submit="Save item code">
        {(fe) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Our product" htmlFor="ic-product" error={fe.productId}>
              <Select id="ic-product" name="productId" required>
                <option value="">Choose…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.skuCode} · {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Customer's item code" htmlFor="ic-code" error={fe.customerItemCode}>
              <Input id="ic-code" name="customerItemCode" required maxLength={40} />
            </Field>
            <Field label="Customer's description (optional)" htmlFor="ic-desc" error={fe.customerDescription}>
              <Input id="ic-desc" name="customerDescription" maxLength={120} />
            </Field>
          </div>
        )}
      </ActionForm>
    </Toggle>
  );
}
