/**
 * Portal capabilities (docs/permissions-matrix.md §7). They are NOT internal permission strings and
 * never appear in `roles` / `role_permissions`: a portal user holds a portal role, and the role maps
 * to this separate list, evaluated only by `PortalAuthContext`. Internal `AuthContext` checks
 * (`sales.*`, `inventory.*` …) can never be satisfied by a portal user.
 *
 * Built in Wave 4 W4E: portal_buyer and portal_viewer. `portal.user.admin` (the customer's own
 * administrator managing colleagues) and `portal.payment.create` (US-8-03) are catalogued for later
 * waves and granted to no role yet.
 */
export const PORTAL_CAPABILITIES = [
  "portal.catalog.view",
  "portal.order.create",
  "portal.order.view",
  "portal.quote.view",
  "portal.document.view",
  "portal.account.edit",
  "portal.user.admin",
  "portal.payment.create",
] as const;
export type PortalCapability = (typeof PORTAL_CAPABILITIES)[number];

export type PortalRole = "portal_buyer" | "portal_viewer";

export const PORTAL_ROLE_BUNDLES: Record<PortalRole, { name: string; description: string; capabilities: readonly PortalCapability[] }> = {
  portal_buyer: {
    name: "Buyer",
    description: "Sees the approved catalogue, places and reorders orders, follows deliveries and downloads the company's documents.",
    capabilities: ["portal.catalog.view", "portal.order.create", "portal.order.view", "portal.quote.view", "portal.document.view", "portal.account.edit"],
  },
  portal_viewer: {
    name: "Viewer",
    description: "Sees the catalogue, orders and documents; cannot place orders.",
    capabilities: ["portal.catalog.view", "portal.order.view", "portal.quote.view", "portal.document.view", "portal.account.edit"],
  },
};

export function isPortalRole(v: unknown): v is PortalRole {
  return v === "portal_buyer" || v === "portal_viewer";
}

export function capabilitiesFor(role: string): ReadonlySet<PortalCapability> {
  return new Set(isPortalRole(role) ? PORTAL_ROLE_BUNDLES[role].capabilities : []);
}
