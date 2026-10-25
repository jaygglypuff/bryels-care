import { DomainError } from "@/lib/errors";
import type { PortalCapability, PortalRole } from "./capabilities";

/**
 * Who is acting in the customer portal (docs/permissions-matrix.md §7, docs/security.md §2.10).
 *
 * Replaces `AuthContext` for portal code and is deliberately NOT convertible to it: it has no internal
 * user id, no permission set, no sites. Every portal query filters on `customerId` taken from here
 * (resolved from the session row on the server), never on an id the browser sends. A foreign id is
 * answered as "not found" (404), the same as an id that does not exist.
 */
export class PortalAuthContext {
  /** Brand: TypeScript keeps the two context types apart even where shapes overlap. */
  readonly boundary = "portal" as const;

  constructor(
    readonly portalUserId: string,
    readonly tenantId: string,
    readonly customerId: string,
    readonly organizationId: string,
    /** Site that fulfils this customer's portal orders (never shown to the customer). */
    readonly fulfilmentSiteId: string,
    readonly email: string,
    readonly displayName: string,
    readonly customerName: string,
    readonly portalRole: PortalRole,
    readonly capabilities: ReadonlySet<PortalCapability>,
    readonly options: { sessionId?: string | null; correlationId?: string | null; mfaEnabled?: boolean } = {},
  ) {}

  get sessionId(): string | null {
    return this.options.sessionId ?? null;
  }

  get correlationId(): string | null {
    return this.options.correlationId ?? null;
  }

  /** Audit actor label: `portal_user:<id>` (audit_events.actor_id stays null; it references internal users). */
  get actorLabel(): string {
    return `portal_user:${this.portalUserId}`;
  }

  can(c: PortalCapability): boolean {
    return this.capabilities.has(c);
  }

  /** Refuses with 403 when the portal role lacks the capability. Internal permission strings never pass. */
  require(c: PortalCapability): void {
    if (!this.capabilities.has(c)) throw new DomainError("forbidden", "Your portal account cannot do this. Ask Bryel's Care to change your access.");
  }
}

export function isPortalContext(v: unknown): v is PortalAuthContext {
  return v instanceof PortalAuthContext;
}
