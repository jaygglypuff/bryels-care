import type { AuthContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { PORTAL_TENANT_STATUS_LABEL, PORTAL_USER_STATUS_LABEL, getPortalAccess, type PortalTenantStatus, type PortalUserStatus } from "@/modules/portal";
import { Card, CardTitle, EmptyState } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { StepUpGate } from "../../../admin/users/step-up-gate";
import { CatalogItemAdd, CatalogItemRemove, CatalogModeForm, EnablePortalForm, InvitePortalUserForm, PortalUserCommand, TenantStatusForm } from "./portal-access-forms";

const MODE_LABEL: Record<string, string> = {
  all_priced: "every product with an approved price (own list, else general list)",
  customer_price_list: "only products on the customer's own approved price list",
  curated: "only the products chosen by Bryel's Care",
};
const userTone = (s: string) => (s === "active" ? "ok" : s === "invited" ? "info" : s === "locked" ? "warn" : "neu");

/**
 * "Portal access" on the customer page (W4E, US-8-01/02): whether the customer portal is on, which
 * products the customer may order there, and the customer's portal users. Rendered only for holders
 * of `sales.portal_user.view` or `sales.portal_catalog.view`; every change is re-checked by the
 * services (permission at the tenant's site, step-up for restricted changes, state machines, audit).
 */
export async function PortalAccessPanel({ ctx, customerId }: { ctx: AuthContext; customerId: string }) {
  if (!ctx.can("sales.portal_user.view") && !ctx.can("sales.portal_catalog.view")) return null;
  const v = await getPortalAccess(ctx, customerId);
  const restricted = ctx.can("sales.portal_user.admin");
  return (
    <Card>
      <CardTitle action={v.tenant && !v.outOfScope ? <Chip tone={v.tenant.status === "active" ? "ok" : "hold"}>{PORTAL_TENANT_STATUS_LABEL[v.tenant.status as PortalTenantStatus] ?? v.tenant.status}</Chip> : undefined}>Portal access</CardTitle>
      {!v.tenant ? (
        <>
          <EmptyState title="The customer portal is off for this customer">
            When it is on, the customer&apos;s own people order from their approved catalogue at their agreed prices, follow their orders and download their delivery receipts. Their orders still go through credit and approval checks.
          </EmptyState>
          {v.enableSites.length > 0 && (
            <div className="mt-3">
              {restricted && <StepUpGate ctx={ctx} purpose="turn on the customer portal" />}
              <EnablePortalForm customerId={customerId} sites={v.enableSites} />
            </div>
          )}
        </>
      ) : v.outOfScope ? (
        <p className="text-[13px] text-muted">The portal is {v.tenant.status === "active" ? "on" : "paused"} for this customer and is managed by site {v.tenant.siteCode}, outside your sites.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {"siteCode" in v.tenant && (
            <p className="text-[13px] text-fg-2">
              Orders are fulfilled and approved at <span className="font-medium">{v.tenant.siteCode}</span>. The customer may order {MODE_LABEL[String(v.tenant.catalogMode)] ?? v.tenant.catalogMode}.
              {v.tenant.status === "suspended" && v.tenant.statusReason ? ` Paused: ${v.tenant.statusReason}.` : ""}
            </p>
          )}
          {"canAdminUsers" in v && v.canAdminUsers && <StepUpGate ctx={ctx} purpose="change portal access" />}
          {"canAdminUsers" in v && v.canAdminUsers && <TenantStatusForm tenantId={v.tenant.id} status={v.tenant.status} />}

          {v.catalog && (
            <section aria-label="Portal catalogue" className="rounded-[14px] border border-line p-3">
              <p className="mb-2 text-[13px] font-semibold">Catalogue in the portal · {v.catalog.items.length} product{v.catalog.items.length === 1 ? "" : "s"}</p>
              {v.catalog.items.length === 0 ? (
                <p className="text-[12.5px] text-muted">Nothing can be ordered yet: no product matches the rule (approved price list needed).</p>
              ) : (
                <ul className="flex flex-col gap-1 text-[13px]">
                  {v.catalog.items.map((i) => (
                    <li key={i.productId} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="font-mono">{i.sku}</span> {i.name}
                      </span>
                      <span className="flex items-center gap-2 text-muted">
                        {i.priceFrom ? `${i.currency} ${i.priceFrom}` : "—"}
                        {"canAdminCatalog" in v && v.canAdminCatalog && v.catalog!.mode === "curated" && <CatalogItemRemove tenantId={v.tenant!.id} productId={i.productId} sku={i.sku} />}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {"canAdminCatalog" in v && v.canAdminCatalog && (
                <div className="mt-3 flex flex-col gap-3">
                  <CatalogModeForm tenantId={v.tenant.id} mode={v.catalog.mode} />
                  {v.catalog.mode === "curated" && <CatalogItemAdd tenantId={v.tenant.id} candidates={v.catalog.candidates} />}
                </div>
              )}
            </section>
          )}

          {v.users && (
            <section aria-label="Portal users">
              <p className="mb-2 text-[13px] font-semibold">People of this customer with portal access</p>
              {v.users.length === 0 ? (
                <p className="text-[12.5px] text-muted">Nobody yet. Invite the customer&apos;s buyer with the button below.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {v.users.map((u) => (
                    <li key={u.id} className="flex flex-col gap-1 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="min-w-0 font-medium">
                          {u.displayName} <span className="break-all text-[12px] font-normal text-muted">{u.email}</span>
                        </p>
                        <span className="flex flex-wrap gap-1">
                          <Chip tone="neu">{u.roleName}</Chip>
                          <Chip tone={userTone(u.status)}>{PORTAL_USER_STATUS_LABEL[u.status as PortalUserStatus] ?? u.status}</Chip>
                          {u.mfaEnabled && <Chip tone="ok">Two-step on</Chip>}
                        </span>
                      </div>
                      <p className="text-[12px] text-muted">
                        {u.lastLoginAt ? `Last sign-in ${fmtDateTime(u.lastLoginAt)}` : "Never signed in"}
                        {u.status === "invited" && u.openInvitationExpiresAt ? ` · link valid until ${fmtDate(u.openInvitationExpiresAt)}` : ""}
                        {u.status === "invited" && !u.openInvitationExpiresAt ? " · no open link" : ""}
                        {u.liveSessions ? ` · signed in on ${u.liveSessions} device${u.liveSessions === 1 ? "" : "s"}` : ""}
                        {u.statusReason && u.status !== "active" ? ` · ${u.statusReason}` : ""}
                      </p>
                      {"canAdminUsers" in v && v.canAdminUsers && (
                        <div className="flex flex-wrap gap-1">
                          {u.status === "invited" && <PortalUserCommand portalUserId={u.id} email={u.email} command="resend" label="Send a new link" />}
                          {u.status === "locked" && <PortalUserCommand portalUserId={u.id} email={u.email} command="unlock" label="Unlock" variant="secondary" />}
                          {u.status === "suspended" && <PortalUserCommand portalUserId={u.id} email={u.email} command="reactivate" label="Reactivate" variant="secondary" />}
                          {u.status !== "suspended" && <PortalUserCommand portalUserId={u.id} email={u.email} command="suspend" label="Suspend" needsReason variant="danger" />}
                          {u.mfaEnabled && <PortalUserCommand portalUserId={u.id} email={u.email} command="reset_mfa" label="Reset two-step sign-in" needsReason />}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {"canAdminUsers" in v && v.canAdminUsers && v.tenant.status === "active" && <InvitePortalUserForm tenantId={v.tenant.id} />}
            </section>
          )}
          {!v.users && !v.catalog && <Banner tone="info" title="Nothing to show">You can see that the portal exists but not its users or catalogue.</Banner>}
        </div>
      )}
    </Card>
  );
}
