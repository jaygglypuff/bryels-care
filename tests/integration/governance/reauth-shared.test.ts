import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, mfaSecrets, users } from "@/db/schema";
import { requireReauthentication } from "@/modules/governance";
import { resetTestDatabase } from "../../support/db";
import { signedIn } from "../identity/helpers";
import { expectCode } from "../../support/kit";

/**
 * One re-authentication rule for restricted changes (Wave 2 integration): W2E's session step-up window
 * (identity.reauth_window_minutes, password plus TOTP when enrolled) satisfies W2F's settings, approval
 * rule and numbering admin and W2C's bulk disposition; the in-form password remains a fallback for
 * people without two-step sign-in. A user with TOTP must use the session step-up.
 */

beforeAll(async () => {
  await resetTestDatabase();
}, 180_000);

describe("requireReauthentication", () => {
  it("passes without a password inside the step-up window", async () => {
    const admin = await signedIn("admin@bryels-care.test", { reauth: true });
    await requireReauthentication(admin, null, "test.purpose");
  });

  it("outside the window: no password is refused, a wrong one is audited, the right one passes", async () => {
    const admin = await signedIn("admin@bryels-care.test", { reauth: false });
    await expectCode(requireReauthentication(admin, null, "test.purpose"), "reauth_required");
    await expectCode(requireReauthentication(admin, "wrong-password", "test.purpose"), "reauth_required");
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "identity.reauth.failed"), eq(auditEvents.actorId, admin.userId)));
    expect(ev.length).toBeGreaterThan(0);
    await requireReauthentication(admin, "demo1234", "test.purpose");
  });

  it("a user with two-step sign-in cannot skip the code with the in-form password", async () => {
    const owner = await signedIn("owner@bryels-care.test", { reauth: false });
    const [u] = await db.select().from(users).where(eq(users.id, owner.userId));
    await db.insert(mfaSecrets).values({ userId: u.id, organizationId: u.organizationId, secretEnc: "test-only", keyId: "test", confirmedAt: new Date() });
    try {
      const e = await expectCode(requireReauthentication(owner, "demo1234", "test.purpose"), "reauth_required");
      expect(e.message).toMatch(/Confirm it's you|authenticator/);
      const fresh = await signedIn("owner@bryels-care.test", { reauth: true, mfa: true });
      await requireReauthentication(fresh, null, "test.purpose");
    } finally {
      await db.delete(mfaSecrets).where(eq(mfaSecrets.userId, u.id));
    }
  });
});
