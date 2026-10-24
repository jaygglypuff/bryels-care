import "server-only";
import { type SendResult, sendEmail } from "@/lib/email";
import { appUrl } from "@/lib/auth/tokens";

/**
 * Account emails (plain text). Links carry the token in the URL fragment (#…), which browsers never
 * send to the server, so tokens cannot end up in proxy or access logs (docs/security.md §3.8).
 */
export const invitationLink = (token: string) => appUrl(`/invite#token=${token}`);
export const resetLink = (token: string) => appUrl(`/reset-password#token=${token}`);

export function sendInvitationEmail(p: { organizationId: string; to: string; displayName: string; token: string; expiresAt: Date; invitedBy: string | null }): Promise<SendResult> {
  return sendEmail({
    organizationId: p.organizationId,
    to: p.to,
    template: "identity.invitation",
    subject: "You're invited to Bryel's Care",
    text: [
      `Hello ${p.displayName},`,
      "",
      `${p.invitedBy ?? "Your administrator"} has invited you to the Bryel's Care operations system.`,
      "Open this link to choose your password. It works once and expires on " + p.expiresAt.toISOString().slice(0, 16).replace("T", " ") + " UTC:",
      "",
      invitationLink(p.token),
      "",
      "If you did not expect this, ignore this email.",
    ].join("\n"),
  });
}

export function sendResetEmail(p: { organizationId: string; to: string; displayName: string; token: string; minutes: number }): Promise<SendResult> {
  return sendEmail({
    organizationId: p.organizationId,
    to: p.to,
    template: "identity.password_reset",
    subject: "Reset your Bryel's Care password",
    text: [
      `Hello ${p.displayName},`,
      "",
      `Open this link within ${p.minutes} minutes to choose a new password. It works once:`,
      "",
      resetLink(p.token),
      "",
      "If you did not ask for this, ignore this email; your password stays the same.",
    ].join("\n"),
  });
}

export function sendNoticeEmail(p: { organizationId: string; to: string; displayName: string; template: string; subject: string; body: string }): Promise<SendResult> {
  return sendEmail({ organizationId: p.organizationId, to: p.to, template: p.template, subject: p.subject, text: `Hello ${p.displayName},\n\n${p.body}\n\nIf this was not you, tell your system administrator now.` });
}
