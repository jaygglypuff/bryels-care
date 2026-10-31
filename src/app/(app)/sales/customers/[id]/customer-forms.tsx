"use client";
import { useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
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
    <Toggle label="Change these details">
      <ActionForm action={updateCustomerAction} hidden={{ customerId: c.id }} submit="Save">
        {(fe) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="p-name" error={fe.name}>
              <Input id="p-name" name="name" defaultValue={c.name} required maxLength={120} />
            </Field>
            <Field label="Kind of customer" htmlFor="p-segment" error={fe.segment} hint="To add a type, go to Master data → Lists.">
              <Select id="p-segment" name="segment" defaultValue={c.segment ?? ""}>
                {([["", "—"], ...segments.map((o) => [o.value, o.label])] as [string, string][]).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Shortest shelf life allowed (days left when sent out)" htmlFor="p-shelf" error={fe.minShelfLifeDays}>
              <Input id="p-shelf" name="minShelfLifeDays" defaultValue={c.minShelfLifeDays} inputMode="numeric" required />
            </Field>
            <Field label="Usual days from order to delivery" htmlFor="p-lead" error={fe.defaultLeadTimeDays}>
              <Input id="p-lead" name="defaultLeadTimeDays" defaultValue={c.defaultLeadTimeDays ?? ""} inputMode="numeric" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Note for our team" htmlFor="p-notes" error={fe.notesInternal}>
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
    <Toggle label="Change how much they may owe">
      <ActionForm action={creditTermsAction} hidden={{ customerId: c.id }} submit="Save">
        {(fe) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Most they may owe (₱)" htmlFor="ct-limit" error={fe.creditLimitAmount} hint="Empty = no limit">
              <Input id="ct-limit" name="creditLimitAmount" defaultValue={c.creditLimitAmount ? String(Number(c.creditLimitAmount)) : ""} inputMode="decimal" />
            </Field>
            <Field label="Days to pay" htmlFor="ct-terms" error={fe.paymentTermsDays}>
              <Input id="ct-terms" name="paymentTermsDays" defaultValue={c.paymentTermsDays ?? ""} inputMode="numeric" />
            </Field>
            <Field label="Tax number" htmlFor="ct-tin" error={fe.taxIdentifier} hint="Format checked by the company's accountant">
              <Input id="ct-tin" name="taxIdentifier" defaultValue={c.taxIdentifier ?? ""} maxLength={40} />
            </Field>
            <Field label="Why?" htmlFor="ct-reason" error={fe.reason}>
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
    <Toggle label="Buying now? Change it">
      <ActionForm action={customerStatusAction} hidden={{ customerId }} submit="Save">
        {(fe) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Change to" htmlFor="st-to" error={fe.to}>
              <Select id="st-to" name="to" required>
                {options.map((o) => (
                  <option key={o.to} value={o.to}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Why?" htmlFor="st-reason" error={fe.reason}>
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
            <Field label="Name of this address" htmlFor="a-label" error={fe.label}>
              <Input id="a-label" name="label" required maxLength={60} placeholder="e.g. Pasig branch" />
            </Field>
            <Field label="Street address" htmlFor="a-line1" error={fe.line1}>
              <Input id="a-line1" name="line1" required maxLength={200} />
            </Field>
            <Field label="City or town" htmlFor="a-city" error={fe.city}>
              <Input id="a-city" name="city" required maxLength={80} />
            </Field>
            <Field label="Province (optional)" htmlFor="a-province" error={fe.province}>
              <Input id="a-province" name="province" maxLength={80} />
            </Field>
            <Field label="Who receives there (optional)" htmlFor="a-contact" error={fe.contactName}>
              <Input id="a-contact" name="contactName" maxLength={80} />
            </Field>
            <Field label="Phone (optional)" htmlFor="a-phone" error={fe.phone}>
              <Input id="a-phone" name="phone" maxLength={40} type="tel" />
            </Field>
            <label className="flex min-h-[44px] items-center gap-2 text-[13px]">
              <input type="checkbox" name="makeDefaultShipTo" className="size-5" /> Deliver here usually
            </label>
            <label className="flex min-h-[44px] items-center gap-2 text-[13px]">
              <input type="checkbox" name="makeDefaultBillTo" className="size-5" /> Send bills here usually
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
            <Field label="Job (optional)" htmlFor="k-role" error={fe.roleLabel}>
              <Input id="k-role" name="roleLabel" maxLength={60} placeholder="e.g. Buyer" />
            </Field>
            <Field label="Phone (optional)" htmlFor="k-phone" error={fe.phone}>
              <Input id="k-phone" name="phone" type="tel" maxLength={40} />
            </Field>
            <Field label="E-mail (optional)" htmlFor="k-email" error={fe.email}>
              <Input id="k-email" name="email" type="email" />
            </Field>
            <label className="flex min-h-[44px] items-center gap-2 text-[13px]">
              <input type="checkbox" name="isPrimary" className="size-5" /> Main contact
            </label>
          </div>
        )}
      </ActionForm>
    </Toggle>
  );
}

const KINDS: [string, string, "number" | "boolean" | "text" | "artwork"][] = [
  ["min_remaining_shelf_life_days", "Days before expiry when sent out (at least)", "number"],
  ["moq", "Smallest order (pcs)", "number"],
  ["carton_count", "Pieces per carton", "number"],
  ["lead_time", "Days from order to delivery", "number"],
  ["lot_age_max_days", "Oldest stock allowed when sent out (days since made)", "number"],
  ["label_artwork", "Their label design", "artwork"],
  ["coa_required", "Quality certificate (COA) with each delivery", "boolean"],
  ["full_shipment_required", "Send everything at once (no part deliveries)", "boolean"],
  ["packaging", "How to pack", "text"],
  ["shipping_marks", "Marks on the boxes", "text"],
  ["document", "Paper they need", "text"],
  ["other", "Other", "text"],
];

export function RequirementForm({ customerId, products, artwork, today }: { customerId: string; products: { id: string; skuCode: string; name: string }[]; artwork: { id: string; label: string; productId: string }[]; today: string }) {
  const [kind, setKind] = useState(KINDS[0][0]);
  const mode = KINDS.find((k) => k[0] === kind)![2];
  return (
    <Toggle label="Add or change a special rule">
      <ActionForm action={draftRequirementAction} hidden={{ customerId }} submit="Save the rule">
        {(fe) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Rule" htmlFor="r-kind" error={fe.requirementKind}>
              <Select id="r-kind" name="requirementKind" value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Product" htmlFor="r-product" error={fe.productId}>
              <Select id="r-product" name="productId" defaultValue="">
                <option value="">All products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.skuCode})
                  </option>
                ))}
              </Select>
            </Field>
            {mode === "number" && (
              <Field label="How many" htmlFor="r-num" error={fe.valueNumeric}>
                <Input id="r-num" name="valueNumeric" inputMode="numeric" required />
              </Field>
            )}
            {mode === "boolean" && (
              <Field label="Yes or no" htmlFor="r-bool" error={fe.valueText}>
                <Select id="r-bool" name="valueText" defaultValue="true">
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </Select>
              </Field>
            )}
            {mode === "text" && (
              <Field label="Write it here" htmlFor="r-text" error={fe.valueText}>
                <Textarea id="r-text" name="valueText" required maxLength={500} />
              </Field>
            )}
            {mode === "artwork" && (
              <Field label="Label design" htmlFor="r-art" error={fe.artworkVersionId} hint={artwork.length ? undefined : "Add the label design first (below)."}>
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
            <Field label="Starts on" htmlFor="r-from" error={fe.effectiveFrom}>
              <Input id="r-from" name="effectiveFrom" type="date" defaultValue={today} required />
            </Field>
            <div className="sm:col-span-2">
              <MoreDetails open={!!fe.changeSummary}>
                <Field label="What changed (optional)" htmlFor="r-summary" error={fe.changeSummary}>
                  <Input id="r-summary" name="changeSummary" maxLength={300} />
                </Field>
              </MoreDetails>
            </div>
            <label className="flex min-h-[44px] items-center gap-2 text-[13px]">
              <input type="checkbox" name="submitNow" defaultChecked className="size-5" /> Send for approval now
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
    <Toggle label="Add a label design">
      <ActionForm action={createArtworkAction} hidden={{ customerId }} submit="Save the label design">
        {(fe) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Product" htmlFor="aw-product" error={fe.productId}>
              <Select id="aw-product" name="productId" required>
                <option value="">Choose…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.skuCode})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="What changed on the label (optional)" htmlFor="aw-desc" error={fe.description}>
              <Input id="aw-desc" name="description" maxLength={300} placeholder="e.g. New barcode position" />
            </Field>
            <div className="sm:col-span-2">
              <MoreDetails open={!!(fe.artworkCode || fe.versionLabel)}>
                <Field label="Design code (optional)" htmlFor="aw-code" error={fe.artworkCode} hint="Leave empty: the system uses ART- and the product code.">
                  <Input id="aw-code" name="artworkCode" maxLength={40} placeholder="Given by the system" />
                </Field>
                <Field label="Version (optional)" htmlFor="aw-ver" error={fe.versionLabel} hint="Leave empty: the next version (v1, v2, …).">
                  <Input id="aw-ver" name="versionLabel" maxLength={20} placeholder="Given by the system" />
                </Field>
              </MoreDetails>
            </div>
          </div>
        )}
      </ActionForm>
    </Toggle>
  );
}

export function ItemCodeForm({ customerId, products }: { customerId: string; products: { id: string; skuCode: string; name: string }[] }) {
  return (
    <Toggle label="Add their code for one of our products">
      <ActionForm action={itemCodeAction} hidden={{ customerId }} submit="Save">
        {(fe) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Our product" htmlFor="ic-product" error={fe.productId}>
              <Select id="ic-product" name="productId" required>
                <option value="">Choose…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.skuCode})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Their code (as on their orders)" htmlFor="ic-code" error={fe.customerItemCode}>
              <Input id="ic-code" name="customerItemCode" required maxLength={40} />
            </Field>
            <Field label="Their name for it (optional)" htmlFor="ic-desc" error={fe.customerDescription}>
              <Input id="ic-desc" name="customerDescription" maxLength={120} />
            </Field>
          </div>
        )}
      </ActionForm>
    </Toggle>
  );
}
