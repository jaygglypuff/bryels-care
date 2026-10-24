import { and, desc, eq } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "@/db/client";
import { emailOutbox, organizations, roles, sites, users } from "@/db/schema";
import { AuthContext, buildContextForUser, type SiteRef } from "@/lib/auth/context";
import { createSessionRecord } from "@/lib/auth/session-store";
import { DomainError } from "@/lib/errors";

/** Fixtures for the W2E identity tests (fictional seed accounts, password demo1234). */
export async function idKit() {
  const [org] = await db.select().from(organizations);
  const all = await db.select({ id: sites.id, code: sites.code, name: sites.name }).from(sites);
  const nfd = all.find((s) => s.code === "NFD")!;
  const rvs = all.find((s) => s.code === "RVS")!;
  return { orgId: org.id, nfd, rvs };
}

export async function userByEmail(email: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return u;
}

export async function roleId(orgId: string, code: string) {
  const [r] = await db.select().from(roles).where(and(eq(roles.organizationId, orgId), eq(roles.code, code)));
  return r.id;
}

/**
 * A real request context: built from the user's current assignments (per-site permissions, sub-scopes)
 * with a real session row. `reauth` marks the session as just re-authenticated (step-up done).
 */
export async function signedIn(email: string, opts: { reauth?: boolean; mfa?: boolean; preferredSiteId?: string } = {}): Promise<AuthContext> {
  const u = await userByEmail(email);
  const { session } = await createSessionRecord({ userId: u.id, userAgent: "vitest" });
  const ctx = await buildContextForUser(u.id, opts.preferredSiteId ?? null, {
    session: {
      id: session.id,
      reauthenticatedAt: opts.reauth === false ? null : new Date(),
      mfaVerifiedAt: opts.mfa ? new Date() : null,
      privileged: session.privileged,
    },
  });
  if (!ctx) throw new Error(`no context for ${email}`);
  return ctx;
}

/** A context with an explicit permission set (to model a role mix the seed does not have). */
export function customCtx(base: AuthContext, permissions: string[], sitesList: SiteRef[] = base.allowedSites): AuthContext {
  return new AuthContext(base.userId, base.organizationId, base.displayName, base.email, base.roleCodes, new Set(permissions), sitesList, sitesList[0].id, {
    session: base.session,
  });
}

/** The token from the newest captured email to `to` (EMAIL_PROVIDER=outbox). */
export async function lastLinkToken(to: string): Promise<string> {
  const [m] = await db.select().from(emailOutbox).where(eq(emailOutbox.toAddress, to)).orderBy(desc(emailOutbox.createdAt)).limit(1);
  const match = m?.bodyText?.match(/#token=([A-Za-z0-9_-]{43})/);
  if (!match) throw new Error(`no link mailed to ${to}`);
  return match[1];
}

export async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (x) => x,
  );
  expect(e, `expected DomainError ${code}`).toBeInstanceOf(DomainError);
  expect((e as DomainError).code, (e as Error).message).toBe(code);
  return e as DomainError;
}

export const GOOD_PASSWORD = "tamarind leaves at dawn 42";
