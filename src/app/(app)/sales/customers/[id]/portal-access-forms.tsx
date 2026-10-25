"use client";
import { useState } from "react";
import { Button, Field, Input, Select } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { enablePortalAction, invitePortalUserAction, portalCatalogItemAction, portalCatalogModeAction, portalTenantStatusAction, portalUserCommandAction } from "./portal-access-actions";

const MODES: [string, string][] = [
  ["all_priced", "Every product with an approved price for this customer (own list, else the general list)"],
  ["customer_price_list", "Only products on this customer's own approved price list"],
  ["curated", "Only the products chosen below (each must have an approved price)"],
];

function Toggle({ label, children, variant = "secondary" }: { label: string; children: React.ReactNode; variant?: "secondary" | "ghost" }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <div className="mt-2 rounded-[12px] border border-line p-3">
      {children}
      <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setOpen(false)}>
        Close
      </Button>
    </div>
  ) : (
    <Button type="button" variant={variant} size="sm" className="mt-2" onClick={() => setOpen(true)}>
      {label}
    </Button>
  );
}

export function EnablePortalForm({ customerId, sites }: { customerId: string; sites: { id: string; code: string; name: string }[] }) {
  return (
    <ActionForm action={enablePortalAction} hidden={{ customerId }} submit="Turn on the customer portal" pending="Turning on…" variant="cta">
      {(fe) => (
        <div className="grid grid-cols-1 gap-3">
          <Field label="Site that fulfils portal orders" htmlFor="pa-site" error={fe.siteId}>
            <Select id="pa-site" name="siteId" required defaultValue={sites[0]?.id}>
              {sites.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code} · {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="The customer may order" htmlFor="pa-mode" error={fe.catalogMode}>
            <Select id="pa-mode" name="catalogMode" defaultValue="all_priced">
              {MODES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function TenantStatusForm({ tenantId, status }: { tenantId: string; status: string }) {
  const to = status === "active" ? "suspended" : "active";
  return (
    <Toggle label={to === "suspended" ? "Pause portal access" : "Resume portal access"}>
      <ActionForm action={portalTenantStatusAction} hidden={{ tenantId, to }} submit={to === "suspended" ? "Pause and sign everyone out" : "Resume"} variant={to === "suspended" ? "danger" : "primary"}>
        {(fe) => (
          <Field label="Reason" htmlFor={`pa-ts-${tenantId}`} error={fe.reason}>
            <Input id={`pa-ts-${tenantId}`} name="reason" required minLength={5} maxLength={300} />
          </Field>
        )}
      </ActionForm>
    </Toggle>
  );
}

export function CatalogModeForm({ tenantId, mode }: { tenantId: string; mode: string }) {
  return (
    <ActionForm action={portalCatalogModeAction} hidden={{ tenantId }} submit="Save catalogue rule" size="sm" variant="secondary">
      {(fe) => (
        <Field label="The customer may order" htmlFor={`pa-cm-${tenantId}`} error={fe.catalogMode}>
          <Select id={`pa-cm-${tenantId}`} name="catalogMode" defaultValue={mode}>
            {MODES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </ActionForm>
  );
}

export function CatalogItemAdd({ tenantId, candidates }: { tenantId: string; candidates: { id: string; sku: string; name: string }[] }) {
  if (candidates.length === 0) return <p className="text-[12px] text-muted">Every priced product is already in the curated catalogue.</p>;
  return (
    <ActionForm action={portalCatalogItemAction} hidden={{ tenantId, command: "add" }} submit="Add to catalogue" size="sm" variant="secondary">
      {(fe) => (
        <Field label="Product (approved price required)" htmlFor={`pa-ci-${tenantId}`} error={fe.productId}>
          <Select id={`pa-ci-${tenantId}`} name="productId" required>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.sku} · {c.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </ActionForm>
  );
}

export function CatalogItemRemove({ tenantId, productId, sku }: { tenantId: string; productId: string; sku: string }) {
  return <ActionForm action={portalCatalogItemAction} hidden={{ tenantId, productId, command: "remove" }} submit="Remove" pending="…" variant="ghost" size="sm" confirm={`Remove ${sku} from the portal catalogue?`} className="inline-flex flex-col gap-1" messageBelow />;
}

export function InvitePortalUserForm({ tenantId }: { tenantId: string }) {
  return (
    <Toggle label="Invite a person of this customer">
      <ActionForm action={invitePortalUserAction} hidden={{ tenantId }} submit="Send invitation" pending="Sending…">
        {(fe) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Email" htmlFor={`pi-email-${tenantId}`} error={fe.email}>
              <Input id={`pi-email-${tenantId}`} name="email" type="email" required autoComplete="off" />
            </Field>
            <Field label="Name" htmlFor={`pi-name-${tenantId}`} error={fe.displayName}>
              <Input id={`pi-name-${tenantId}`} name="displayName" required minLength={2} maxLength={120} autoComplete="off" />
            </Field>
            <Field label="May" htmlFor={`pi-role-${tenantId}`} error={fe.portalRole}>
              <Select id={`pi-role-${tenantId}`} name="portalRole" defaultValue="portal_buyer">
                <option value="portal_buyer">Order and view (Buyer)</option>
                <option value="portal_viewer">View only (Viewer)</option>
              </Select>
            </Field>
          </div>
        )}
      </ActionForm>
    </Toggle>
  );
}

export function PortalUserCommand({ portalUserId, email, command, label, needsReason, variant = "ghost", confirm }: { portalUserId: string; email: string; command: "resend" | "suspend" | "reactivate" | "unlock" | "reset_mfa"; label: string; needsReason?: boolean; variant?: "ghost" | "secondary" | "danger"; confirm?: string }) {
  if (!needsReason) return <ActionForm action={portalUserCommandAction} hidden={{ portalUserId, command, email }} submit={label} pending="…" variant={variant} size="sm" confirm={confirm} className="inline-flex flex-col gap-1" messageBelow />;
  return (
    <Toggle label={label} variant="ghost">
      <ActionForm action={portalUserCommandAction} hidden={{ portalUserId, command, email }} submit={label} variant={variant === "ghost" ? "secondary" : variant} size="sm">
        {(fe) => (
          <Field label="Reason" htmlFor={`pu-${command}-${portalUserId}`} error={fe.reason}>
            <Input id={`pu-${command}-${portalUserId}`} name="reason" required minLength={5} maxLength={300} />
          </Field>
        )}
      </ActionForm>
    </Toggle>
  );
}
