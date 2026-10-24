"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { DomainError, type ActionState, toActionState } from "@/lib/errors";
import {
  adminResetMfa,
  changeAssignmentScope,
  deactivateUser,
  endAssignment,
  forcePasswordReset,
  grantAssignment,
  lockUser,
  reactivateUser,
  resendInvitation,
  revokeAllUserSessions,
  revokeInvitation,
  revokeSession,
  unlockUser,
  updateUserProfile,
} from "@/modules/identity";

/** ActionState plus a one-time link when no email went out (shown once to pass on in person). */
export type UserActionState = (NonNullable<ActionState> & { manualLink?: string | null }) | null;

const OPS = ["lock", "unlock", "deactivate", "reactivate", "resend", "revoke_invitation", "force_reset", "sign_out_all", "reset_mfa", "rename", "grant", "end_assignment", "scope", "revoke_session"] as const;
type Op = (typeof OPS)[number];

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

/**
 * One dispatcher for the user detail page. Every branch calls a service that checks permission,
 * scope, separation rules and step-up on the server; the page only decides what to show.
 */
export async function userCommand(_: UserActionState, fd: FormData): Promise<UserActionState> {
  const ctx = await requireContext(); // outside try: a sign-in redirect must not be swallowed
  const userId = s(fd, "userId");
  const op = s(fd, "op") as Op;
  try {
    z.uuid().parse(userId);
    if (!OPS.includes(op)) throw new DomainError("validation", "Unknown action.");
    const reason = s(fd, "reason");
    let message = "Saved.";
    let manualLink: string | null = null;
    switch (op) {
      case "lock":
        await lockUser(ctx, userId, reason);
        message = "Account locked and signed out everywhere.";
        break;
      case "unlock":
        await unlockUser(ctx, userId, reason);
        message = "Account unlocked. The user can sign in again.";
        break;
      case "deactivate":
        await deactivateUser(ctx, userId, reason);
        message = "Account deactivated: sessions revoked, links voided, assignments ended.";
        break;
      case "reactivate":
        await reactivateUser(ctx, userId, reason);
        message = "Account reactivated. It has no roles until you grant them.";
        break;
      case "resend": {
        const d = await resendInvitation(ctx, userId);
        manualLink = d.manualLink;
        message = d.status === "sent" ? "A new invitation was emailed; the previous link no longer works." : "A new invitation link was created; the previous link no longer works.";
        break;
      }
      case "revoke_invitation":
        await revokeInvitation(ctx, userId, reason);
        message = "Invitation withdrawn and the account deactivated.";
        break;
      case "force_reset": {
        const d = await forcePasswordReset(ctx, userId, reason);
        manualLink = d.manualLink;
        message = d.status === "sent" ? "Signed out everywhere; a reset link was emailed to the user." : "Signed out everywhere; a reset link was created.";
        break;
      }
      case "sign_out_all": {
        const n = await revokeAllUserSessions(ctx, userId, reason);
        message = `${n} session(s) signed out.`;
        break;
      }
      case "reset_mfa":
        await adminResetMfa(ctx, userId, reason);
        message = "Two-step sign-in reset. The user sets it up again at next sign-in.";
        break;
      case "rename":
        await updateUserProfile(ctx, userId, { displayName: s(fd, "displayName") });
        message = "Name updated.";
        break;
      case "grant": {
        const siteRaw = s(fd, "siteId");
        await grantAssignment(ctx, {
          userId,
          roleId: s(fd, "roleId"),
          siteId: siteRaw === "org" ? null : siteRaw,
          validFrom: s(fd, "validFrom") || null,
          validTo: s(fd, "validTo") || null,
          warehouseIds: fd.getAll("warehouseIds").filter((x): x is string => typeof x === "string" && !!x),
          reason: reason || null,
        });
        message = "Role granted. It applies on the user's next request.";
        break;
      }
      case "end_assignment":
        await endAssignment(ctx, s(fd, "assignmentId"), reason);
        message = "Assignment ended.";
        break;
      case "scope": {
        const ids = fd.getAll("warehouseIds").filter((x): x is string => typeof x === "string" && !!x);
        await changeAssignmentScope(ctx, s(fd, "assignmentId"), ids.length ? ids : null, reason);
        message = ids.length ? "Warehouse limit saved." : "Warehouse limit removed: the whole site applies.";
        break;
      }
      case "revoke_session":
        await revokeSession(ctx, s(fd, "sessionId"), reason);
        message = "Session signed out.";
        break;
    }
    revalidatePath(`/admin/users/${userId}`);
    revalidatePath("/admin/users");
    return { ok: true, message, manualLink };
  } catch (e) {
    return toActionState(e);
  }
}
