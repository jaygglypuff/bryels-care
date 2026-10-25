import "server-only";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db/client";
import { invitations, passwordResetTokens, userSiteAssignments, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { revokeUserSessions } from "@/lib/auth/session-store";
import { SYSTEM_USER_STATUS } from "@/lib/auth/system";
import { newToken, sha256 } from "@/lib/auth/tokens";
import type { SendResult } from "@/lib/email";
import { isDemoEmail, isDemoMode } from "@/lib/demo";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { grantInTx } from "./assignments";
import { invitationLink, resetLink, sendInvitationEmail, sendNoticeEmail, sendResetEmail } from "./messages";
import { assertStepUp, deny, requireReason } from "./policy";
import { assertUserVisible } from "./users";

/**
 * Account lifecycle (docs/security.md §3.9, US-1-16):
 *   invited → active (invitation accepted) | deactivated (invitation revoked)
 *   active → locked (admin or lockout) → active (unlock)
 *   active | locked → deactivated → active (reactivation, grants nothing)
 * Every transition is one transaction with its audit event; locked and deactivated users fail every
 * request at once because the context is rebuilt per request and their sessions are revoked.
 */
const TRANSITIONS: Record<string, string[]> = {
  invited: ["active", "deactivated"],
  active: ["locked", "deactivated"],
  locked: ["active", "deactivated"],
  deactivated: ["active"],
};

function assertTransition(from: string, to: string) {
  if (!TRANSITIONS[from]?.includes(to)) throw new DomainError("state", `This account is ${from}; it cannot become ${to}.`);
}


async function lockUserRow(tx: Tx, ctx: AuthContext, userId: string) {
  const [u] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organizationId, ctx.organizationId), ne(users.status, SYSTEM_USER_STATUS)))
    .for("update")
    .limit(1);
  if (!u) throw new DomainError("not_found", "User not found.");
  return u;
}

/** Delivery outcome for the screen: a link is returned only when no email went out (pass it on by hand). */
export type Delivery = { status: SendResult["status"]; manualLink: string | null };

function delivery(r: SendResult, link: string): Delivery {
  return { status: r.status, manualLink: r.status === "sent" ? null : link };
}

// ---------- invitation ----------

const InviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
    displayName: z.string().trim().min(2, "Enter the person's name.").max(120),
    grants: z
      .array(z.object({ roleId: z.uuid(), siteId: z.uuid().nullable(), warehouseIds: z.array(z.uuid()).max(50).optional().nullable() }).strict())
      .min(1, "Choose at least one role and site.")
      .max(20),
  })
  .strict();
export type InviteInput = z.input<typeof InviteSchema>;

async function issueInvitation(tx: Tx, ctx: AuthContext | null, p: { organizationId: string; userId: string; email: string; roleId: string | null; siteId: string | null; kind?: "standard" | "bootstrap"; now: Date }) {
  const ttl = await getSetting(tx, p.organizationId, "identity.invitation.ttl_hours");
  await tx
    .update(invitations)
    .set({ revokedAt: p.now, revokedReason: "replaced by a new invitation" })
    .where(and(eq(invitations.userId, p.userId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
  const token = newToken();
  const [inv] = await tx
    .insert(invitations)
    .values({
      organizationId: p.organizationId,
      userId: p.userId,
      email: p.email,
      roleId: p.roleId,
      siteId: p.siteId,
      tokenHash: sha256(token),
      expiresAt: new Date(p.now.getTime() + ttl * 3_600_000),
      kind: p.kind ?? "standard",
      createdBy: ctx?.userId ?? null,
      createdAt: p.now,
    })
    .returning();
  return { token, invitation: inv };
}
export { issueInvitation };

/**
 * Invites a person (US-1-16 AC1): `users` row in `invited` without a password, the assignments and the
 * invitation in one transaction; the email is sent after commit.
 */
export async function inviteUser(ctx: AuthContext, raw: InviteInput, now: Date = new Date()): Promise<{ userId: string; delivery: Delivery }> {
  ctx.require("identity.user.create");
  ctx.require("identity.invitation.create");
  ctx.require("identity.site_assignment.admin");
  const input = InviteSchema.parse(raw);
  // Demo mode (ADR-055): only made-up addresses, so the demo never holds a real person and stays resettable.
  if (isDemoMode() && !isDemoEmail(input.email)) {
    throw new DomainError("validation", "This is the demo: invite only made-up addresses ending in @bryels-care.test (for example new.person@bryels-care.test).", { field: "email" });
  }
  await assertStepUp(ctx, "invite people", now);
  const out = await db.transaction(async (tx) => {
    const [dup] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, ctx.organizationId), sql`lower(${users.email}) = ${input.email}`))
      .limit(1);
    if (dup) throw new DomainError("conflict", "A user with this email already exists. Open their record instead.", { field: "email" });
    const [u] = await tx
      .insert(users)
      .values({ organizationId: ctx.organizationId, email: input.email, displayName: input.displayName, passwordHash: "!", status: "invited", createdAt: now, updatedAt: now })
      .returning();
    await audit(tx, ctx, {
      action: "identity.user.created",
      entityType: "user",
      entityId: u.id,
      entityNumber: u.email,
      siteId: null,
      after: { email: u.email, displayName: u.displayName, status: "invited" },
    });
    for (const g of input.grants) await grantInTx(tx, ctx, { userId: u.id, roleId: g.roleId, siteId: g.siteId, warehouseIds: g.warehouseIds ?? null }, now);
    const first = input.grants[0];
    const { token, invitation } = await issueInvitation(tx, ctx, { organizationId: ctx.organizationId, userId: u.id, email: u.email, roleId: first.roleId, siteId: first.siteId, now });
    await audit(tx, ctx, {
      action: "identity.invitation.sent",
      entityType: "user",
      entityId: u.id,
      entityNumber: u.email,
      siteId: null,
      after: { invitationId: invitation.id, expiresAt: invitation.expiresAt, grants: input.grants.length },
    });
    return { user: u, token, invitation };
  });
  const r = await sendInvitationEmail({ organizationId: ctx.organizationId, to: out.user.email, displayName: out.user.displayName, token: out.token, expiresAt: out.invitation.expiresAt, invitedBy: ctx.displayName });
  return { userId: out.user.id, delivery: delivery(r, invitationLink(out.token)) };
}

/** New link for an invited user; the previous link stops working (US-1-11 AC1). */
export async function resendInvitation(ctx: AuthContext, userId: string, now: Date = new Date()): Promise<Delivery> {
  ctx.require("identity.invitation.create");
  await assertUserVisible(ctx, userId);
  const out = await db.transaction(async (tx) => {
    const u = await lockUserRow(tx, ctx, userId);
    if (u.status !== "invited") throw new DomainError("state", `This account is ${u.status}; only invited people get invitation links.`);
    const [prev] = await tx
      .select({ roleId: invitations.roleId, siteId: invitations.siteId })
      .from(invitations)
      .where(eq(invitations.userId, u.id))
      .orderBy(sql`${invitations.createdAt} desc`)
      .limit(1);
    const { token, invitation } = await issueInvitation(tx, ctx, { organizationId: ctx.organizationId, userId: u.id, email: u.email, roleId: prev?.roleId ?? null, siteId: prev?.siteId ?? null, now });
    await audit(tx, ctx, { action: "identity.invitation.sent", entityType: "user", entityId: u.id, entityNumber: u.email, siteId: null, after: { invitationId: invitation.id, expiresAt: invitation.expiresAt, resend: true } });
    return { u, token, invitation };
  });
  const r = await sendInvitationEmail({ organizationId: ctx.organizationId, to: out.u.email, displayName: out.u.displayName, token: out.token, expiresAt: out.invitation.expiresAt, invitedBy: ctx.displayName });
  return delivery(r, invitationLink(out.token));
}

/** Withdraws an invitation: the link stops working and the invited account is deactivated. */
export async function revokeInvitation(ctx: AuthContext, userId: string, reason: string, now: Date = new Date()): Promise<void> {
  ctx.require("identity.invitation.create");
  const why = requireReason(reason);
  await assertUserVisible(ctx, userId);
  await db.transaction(async (tx) => {
    const u = await lockUserRow(tx, ctx, userId);
    if (u.status !== "invited") throw new DomainError("state", `This account is ${u.status}; there is no open invitation.`);
    await tx
      .update(invitations)
      .set({ revokedAt: now, revokedReason: why })
      .where(and(eq(invitations.userId, u.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
    await endAllAssignments(tx, ctx, u.id, why, now);
    await tx.update(users).set({ status: "deactivated", deactivatedAt: now, updatedAt: now }).where(eq(users.id, u.id));
    await audit(tx, ctx, { action: "identity.invitation.revoked", entityType: "user", entityId: u.id, entityNumber: u.email, siteId: null, reason: why });
    await audit(tx, ctx, { action: "identity.user.deactivated", entityType: "user", entityId: u.id, entityNumber: u.email, siteId: null, reason: why, before: { status: "invited" }, after: { status: "deactivated" } });
  });
}

async function endAllAssignments(tx: Tx, ctx: AuthContext, userId: string, reason: string, now: Date) {
  const live = await tx.select().from(userSiteAssignments).where(and(eq(userSiteAssignments.userId, userId), isNull(userSiteAssignments.revokedAt)));
  for (const a of live) {
    const validTo = a.validTo && a.validTo.getTime() <= now.getTime() ? a.validTo : a.validFrom.getTime() > now.getTime() ? a.validFrom : now;
    await tx.update(userSiteAssignments).set({ validTo, revokedAt: now, revokedBy: ctx.userId, revokedReason: reason }).where(eq(userSiteAssignments.id, a.id));
    await audit(tx, ctx, { action: "identity.site_assignment.revoked", entityType: "user_site_assignments", entityId: a.id, siteId: a.siteId, reason, before: { roleId: a.roleId, siteId: a.siteId }, after: { validTo } });
  }
  return live.length;
}

// ---------- lock / unlock / deactivate / reactivate ----------

async function adminTransition(
  ctx: AuthContext,
  userId: string,
  to: "locked" | "active" | "deactivated",
  reason: string,
  opts: { action: `identity.user.${string}`; purpose: string; now: Date; extra?: (tx: Tx, u: typeof users.$inferSelect) => Promise<Record<string, unknown>> },
) {
  ctx.require("identity.user.admin");
  const why = requireReason(reason);
  await assertUserVisible(ctx, userId);
  if (userId === ctx.userId) await deny(ctx, "identity.user.admin", { entityType: "user", entityId: userId, reason: "You cannot change the status of your own account. Ask another administrator." });
  await assertStepUp(ctx, opts.purpose, opts.now);
  return db.transaction(async (tx) => {
    const u = await lockUserRow(tx, ctx, userId);
    assertTransition(u.status, to);
    const extra = opts.extra ? await opts.extra(tx, u) : {};
    const patch: Partial<typeof users.$inferInsert> = { status: to, updatedAt: opts.now };
    if (to === "active") patch.failedLoginCount = 0;
    if (to === "deactivated") patch.deactivatedAt = opts.now;
    if (to === "active" && u.status === "deactivated") patch.deactivatedAt = null;
    await tx.update(users).set(patch).where(eq(users.id, u.id));
    await audit(tx, ctx, {
      action: opts.action as `identity.user.${string}`,
      entityType: "user",
      entityId: u.id,
      entityNumber: u.email,
      siteId: null,
      reason: why,
      before: { status: u.status, failedLoginCount: u.failedLoginCount },
      after: { status: to, ...extra },
    });
    return u;
  });
}

/** Locks an active account at once (suspected compromise); every session is revoked. */
export async function lockUser(ctx: AuthContext, userId: string, reason: string, now: Date = new Date()): Promise<void> {
  await adminTransition(ctx, userId, "locked", reason, {
    action: "identity.user.locked",
    purpose: "lock an account",
    now,
    extra: async (tx, u) => ({ revokedSessions: (await revokeUserSessions(tx, u.id, { by: ctx.userId, reason: "account locked", now })).length }),
  });
}

/** Unlocks a locked account: status locked → active, failure counter reset. */
export async function unlockUser(ctx: AuthContext, userId: string, reason: string, now: Date = new Date()): Promise<void> {
  await adminTransition(ctx, userId, "active", reason, {
    action: "identity.user.unlocked",
    purpose: "unlock an account",
    now,
    extra: async (_tx, u) => {
      if (u.status !== "locked") throw new DomainError("state", `This account is ${u.status}, not locked. Nothing to unlock.`);
      return { failedLoginCount: 0 };
    },
  });
}

/**
 * Offboarding (US-1-16 AC2): status deactivated, every session revoked, open invitation and reset
 * tokens voided, every assignment ended; the row stays for attribution.
 */
export async function deactivateUser(ctx: AuthContext, userId: string, reason: string, now: Date = new Date()): Promise<void> {
  const u = await adminTransition(ctx, userId, "deactivated", reason, {
    action: "identity.user.deactivated",
    purpose: "deactivate an account",
    now,
    extra: async (tx, u) => {
      const revoked = await revokeUserSessions(tx, u.id, { by: ctx.userId, reason: "account deactivated", now });
      await tx.update(invitations).set({ revokedAt: now, revokedReason: "account deactivated" }).where(and(eq(invitations.userId, u.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
      await tx.update(passwordResetTokens).set({ voidedAt: now }).where(and(eq(passwordResetTokens.userId, u.id), isNull(passwordResetTokens.usedAt), isNull(passwordResetTokens.voidedAt)));
      const ended = await endAllAssignments(tx, ctx, u.id, String(reason).trim(), now);
      return { revokedSessions: revoked.length, endedAssignments: ended };
    },
  });
  void u;
}

/** Reactivation (US-1-16 AC2): status active, nothing granted; the admin adds assignments explicitly. */
export async function reactivateUser(ctx: AuthContext, userId: string, reason: string, now: Date = new Date()): Promise<void> {
  await adminTransition(ctx, userId, "active", reason, {
    action: "identity.user.reactivated",
    purpose: "reactivate an account",
    now,
    extra: async (_tx, u) => {
      if (u.status !== "deactivated") throw new DomainError("state", `This account is ${u.status}, not deactivated.`);
      return { grants: 0 };
    },
  });
}

/** Display-name change (identity.user.edit). Email changes need a confirmation flow and are not offered here. */
export async function updateUserProfile(ctx: AuthContext, userId: string, raw: { displayName: string }, now: Date = new Date()): Promise<void> {
  ctx.require("identity.user.edit");
  const displayName = z.string().trim().min(2, "Enter the person's name.").max(120).parse(raw.displayName);
  await assertUserVisible(ctx, userId);
  await db.transaction(async (tx) => {
    const u = await lockUserRow(tx, ctx, userId);
    if (u.displayName === displayName) return;
    await tx.update(users).set({ displayName, updatedAt: now }).where(eq(users.id, u.id));
    await audit(tx, ctx, { action: "identity.user.updated", entityType: "user", entityId: u.id, entityNumber: u.email, siteId: null, before: { displayName: u.displayName }, after: { displayName } });
  });
}

/**
 * Admin "force password reset" (identity.user.admin, docs/permissions-matrix.md §2.1): every session
 * revoked and a reset link emailed to the user. Admins never see or set passwords; when email is not
 * set up the link is shown once to the admin to pass on in person, and that is audited.
 */
export async function forcePasswordReset(ctx: AuthContext, userId: string, reason: string, now: Date = new Date()): Promise<Delivery> {
  ctx.require("identity.user.admin");
  const why = requireReason(reason);
  await assertUserVisible(ctx, userId);
  if (userId === ctx.userId) throw new DomainError("validation", "Use “Change password” on your account page for your own password.");
  await assertStepUp(ctx, "force a password reset", now);
  const out = await db.transaction(async (tx) => {
    const u = await lockUserRow(tx, ctx, userId);
    if (u.status !== "active" && u.status !== "locked") throw new DomainError("state", `This account is ${u.status}; a reset is not possible.`);
    const minutes = await getSetting(tx, ctx.organizationId, "identity.password_reset.ttl_minutes");
    await tx.update(passwordResetTokens).set({ voidedAt: now }).where(and(eq(passwordResetTokens.userId, u.id), isNull(passwordResetTokens.usedAt), isNull(passwordResetTokens.voidedAt)));
    const token = newToken();
    await tx.insert(passwordResetTokens).values({ organizationId: ctx.organizationId, userId: u.id, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + minutes * 60_000), requestedBy: "admin", createdAt: now });
    const revoked = await revokeUserSessions(tx, u.id, { by: ctx.userId, reason: "password reset forced by an administrator", now });
    await audit(tx, ctx, { action: "identity.user.password_reset_requested", entityType: "user", entityId: u.id, entityNumber: u.email, siteId: null, reason: why, after: { by: "admin", revokedSessions: revoked.length } });
    return { u, token, minutes };
  });
  const r = await sendResetEmail({ organizationId: ctx.organizationId, to: out.u.email, displayName: out.u.displayName, token: out.token, minutes: out.minutes });
  const d = delivery(r, resetLink(out.token));
  if (d.manualLink) {
    await db.transaction((tx) =>
      audit(tx, ctx, { action: "identity.user.reset_link_shown", entityType: "user", entityId: out.u.id, entityNumber: out.u.email, siteId: null, reason: "email not delivered; link shown once to the administrator" }),
    );
  }
  return d;
}

/** "Sign out everywhere" for another user (identity.user.admin, US-1-12 AC1). */
export async function revokeAllUserSessions(ctx: AuthContext, userId: string, reason: string, now: Date = new Date()): Promise<number> {
  ctx.require("identity.user.admin");
  const why = requireReason(reason);
  await assertUserVisible(ctx, userId);
  await assertStepUp(ctx, "sign a user out everywhere", now);
  return db.transaction(async (tx) => {
    const u = await lockUserRow(tx, ctx, userId);
    const ids = await revokeUserSessions(tx, u.id, { by: ctx.userId, reason: why, exceptSessionId: ctx.sessionId, now });
    for (const id of ids) await audit(tx, ctx, { action: "identity.session.revoked", entityType: "session", entityId: id, entityNumber: u.email, siteId: null, reason: why });
    await audit(tx, ctx, { action: "identity.session.revoked_all", entityType: "user", entityId: u.id, entityNumber: u.email, siteId: null, reason: why, after: { revokedSessions: ids.length } });
    return ids.length;
  });
}

/** Tells the user about a security-relevant change (best effort, after commit). */
export async function notifyUser(organizationId: string, userId: string, template: string, subject: string, body: string) {
  const [u] = await db.select({ email: users.email, displayName: users.displayName }).from(users).where(eq(users.id, userId)).limit(1);
  if (u) await sendNoticeEmail({ organizationId, to: u.email, displayName: u.displayName, template, subject, body });
}

