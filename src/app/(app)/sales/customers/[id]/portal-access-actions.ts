"use server";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import {
  addPortalCatalogItem,
  changePortalUser,
  enablePortal,
  invitePortalUser,
  removePortalCatalogItem,
  resendPortalInvitation,
  setPortalCatalogMode,
  setPortalTenantStatus,
  type PortalDelivery,
} from "@/modules/portal";

/** "Portal access" panel actions (W4E, US-8-01/02): parse, call src/modules/portal, refresh in place (ADR-043). */
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const done = (message: string): ActionState => {
  refreshCurrentPage();
  return { ok: true, message };
};
const deliveryText = (d: PortalDelivery, who: string) =>
  d.status === "sent"
    ? `Invitation emailed to ${who}. The link works once and expires after the invitation lifetime (72 hours by default).`
    : d.status === "captured"
      ? `Development email outbox: the invitation to ${who} was captured, not sent. Link (works once): ${d.manualLink}`
      : `The email could not be sent (${d.status === "failed" ? "the provider refused it" : "email is not set up"}). Pass this link to ${who} yourself (it works once): ${d.manualLink}`;

export async function enablePortalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await enablePortal(ctx, s(fd, "customerId"), { siteId: s(fd, "siteId"), catalogMode: s(fd, "catalogMode") });
    return done("The customer portal is on. Invite the customer's people below.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function portalTenantStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const to = s(fd, "to") === "active" ? "active" : "suspended";
    await setPortalTenantStatus(ctx, s(fd, "tenantId"), to, s(fd, "reason"));
    return done(to === "suspended" ? "Portal access is paused; everyone of this customer was signed out." : "Portal access is resumed.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function portalCatalogModeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await setPortalCatalogMode(ctx, s(fd, "tenantId"), s(fd, "catalogMode"));
    return done("Catalogue rule saved.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function portalCatalogItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (s(fd, "command") === "remove") {
      await removePortalCatalogItem(ctx, s(fd, "tenantId"), s(fd, "productId"));
      return done("Removed from the portal catalogue.");
    }
    await addPortalCatalogItem(ctx, s(fd, "tenantId"), s(fd, "productId"));
    return done("Added to the portal catalogue.");
  } catch (e) {
    return toActionState(e);
  }
}

export async function invitePortalUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const email = s(fd, "email");
    const r = await invitePortalUser(ctx, s(fd, "tenantId"), { email, displayName: s(fd, "displayName"), portalRole: s(fd, "portalRole") });
    return done(deliveryText(r.delivery, email.trim().toLowerCase()));
  } catch (e) {
    return toActionState(e);
  }
}

export async function portalUserCommandAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const id = s(fd, "portalUserId");
    const command = s(fd, "command");
    if (command === "resend") {
      const d = await resendPortalInvitation(ctx, id);
      return done(deliveryText(d, s(fd, "email") || "the person"));
    }
    if (command !== "suspend" && command !== "reactivate" && command !== "unlock" && command !== "reset_mfa") return { ok: false, message: "Unknown command." };
    await changePortalUser(ctx, id, command, s(fd, "reason") || null);
    const msg: Record<string, string> = { suspend: "Portal account suspended and signed out.", reactivate: "Portal account reactivated.", unlock: "Portal account unlocked.", reset_mfa: "Two-step sign-in reset; the person was signed out." };
    return done(msg[command]);
  } catch (e) {
    return toActionState(e);
  }
}
