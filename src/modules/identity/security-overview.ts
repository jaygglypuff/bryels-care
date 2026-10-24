import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { SYSTEM_USER_STATUS } from "@/lib/auth/system";
import { emailSetupStatus } from "@/lib/email";
import { DomainError } from "@/lib/errors";
import { SETTINGS, type SettingKey, getSetting } from "@/lib/settings";
import { mfaStateFor } from "./policy";
import { visibleUserIds } from "./users";

/**
 * Security page read model (no secrets ever: only booleans about configuration). Policy values are
 * settings (src/lib/settings.ts) changed through the settings administration with platform.settings.admin.
 */
const KEYS: SettingKey[] = [
  "session.idle_minutes",
  "session.idle_minutes_privileged",
  "session.idle_minutes_shared_device",
  "session.absolute_hours",
  "session.absolute_hours_privileged",
  "session.purge_after_days",
  "identity.reauth_window_minutes",
  "identity.mfa.grace_days",
  "identity.invitation.ttl_hours",
  "identity.password_reset.ttl_minutes",
  "identity.password.min_length",
  "identity.password.history_count",
  "identity.assignment.restricted_grant_requires_owner",
];

export type SecurityOverview = {
  policy: { key: string; value: unknown; isDefault: boolean; assumption: string }[];
  email: ReturnType<typeof emailSetupStatus>;
  encryptionKeyConfigured: boolean;
  trustedProxyHeaderConfigured: boolean;
  mfa: { userId: string; name: string; email: string; enrolled: boolean; overdue: boolean; graceEndsAt: Date | null }[];
};

export async function securityOverview(ctx: AuthContext): Promise<SecurityOverview> {
  if (!(ctx.can("identity.user.admin") || ctx.can("identity.role.admin"))) throw new DomainError("forbidden", "You do not have permission for the security page.");
  const policy = await Promise.all(
    KEYS.map(async (key) => {
      const value = await getSetting(db, ctx.organizationId, key);
      const def = SETTINGS[key];
      return { key, value, isDefault: JSON.stringify(value) === JSON.stringify(def.default), assumption: def.assumption };
    }),
  );
  const visible = await visibleUserIds(ctx);
  const conds = [eq(users.organizationId, ctx.organizationId), ne(users.status, SYSTEM_USER_STATUS), eq(users.status, "active")];
  if (visible !== null) conds.push(inArray(users.id, visible.length ? visible : ["00000000-0000-0000-0000-000000000000"]));
  const people = await db.select({ id: users.id, name: users.displayName, email: users.email }).from(users).where(and(...conds));
  const mfa = [];
  for (const p of people) {
    const s = await mfaStateFor(db, ctx.organizationId, p.id);
    if (s.required) mfa.push({ userId: p.id, name: p.name, email: p.email, enrolled: s.enrolled, overdue: s.overdue, graceEndsAt: s.graceEndsAt });
  }
  mfa.sort((a, b) => Number(a.enrolled) - Number(b.enrolled) || a.name.localeCompare(b.name));
  return {
    policy,
    email: emailSetupStatus(),
    encryptionKeyConfigured: !!process.env.DATA_ENCRYPTION_KEY,
    trustedProxyHeaderConfigured: !!process.env.TRUSTED_PROXY_HEADER,
    mfa,
  };
}
