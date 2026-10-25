import { DomainError } from "@/lib/errors";

/**
 * Portal state machines (W4E). Every change goes through these tables and writes one audit event.
 *
 * Tenant (customer_portal_tenants.status):
 *   active → suspended (reason; every portal session of the tenant is revoked) → active
 *
 * Portal user (portal_users.status):
 *   invited → active (invitation accepted) | suspended (access withdrawn)
 *   active → locked (too many failed sign-ins) | suspended
 *   locked → active (staff unlock) | suspended
 *   suspended → active (reactivated, had a password) | invited (reactivated before ever signing in; new link)
 */
export type PortalTenantStatus = "active" | "suspended";
export type PortalUserStatus = "invited" | "active" | "locked" | "suspended";

export const PORTAL_TENANT_TRANSITIONS: Record<PortalTenantStatus, readonly PortalTenantStatus[]> = {
  active: ["suspended"],
  suspended: ["active"],
};

export const PORTAL_USER_TRANSITIONS: Record<PortalUserStatus, readonly PortalUserStatus[]> = {
  invited: ["active", "suspended"],
  active: ["locked", "suspended"],
  locked: ["active", "suspended"],
  suspended: ["active", "invited"],
};

export const PORTAL_USER_STATUS_LABEL: Record<PortalUserStatus, string> = { invited: "Invited", active: "Active", locked: "Locked", suspended: "Suspended" };
export const PORTAL_TENANT_STATUS_LABEL: Record<PortalTenantStatus, string> = { active: "Active", suspended: "Suspended" };

export function canPortalUserTransition(from: string, to: PortalUserStatus): boolean {
  return (PORTAL_USER_TRANSITIONS as Record<string, readonly string[]>)[from]?.includes(to) ?? false;
}

export function assertPortalUserTransition(from: string, to: PortalUserStatus) {
  if (!canPortalUserTransition(from, to)) {
    throw new DomainError("state", `This portal account is ${from}; it cannot become ${to}.`, { machine: "portal_user", from, to });
  }
}

export function assertPortalTenantTransition(from: string, to: PortalTenantStatus) {
  if (!(PORTAL_TENANT_TRANSITIONS as Record<string, readonly string[]>)[from]?.includes(to)) {
    throw new DomainError("state", `Portal access is ${from}; it cannot become ${to}.`, { machine: "portal_tenant", from, to });
  }
}
