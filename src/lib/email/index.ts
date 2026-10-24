import "server-only";
import { db } from "@/db/client";
import { emailOutbox } from "@/db/schema";
import { redact } from "@/lib/auth/tokens";

/**
 * Email adapter (docs/architecture.md §2 "Email provider (adapter)"; docs/deployment-railway.md §5).
 *
 * EMAIL_PROVIDER
 * - `outbox`  development and tests: the full message is stored in `email_outbox` and printed to the
 *             console so the developer can open the link. Refused in production.
 * - `resend`  production: HTTPS API (RESEND_API_KEY, EMAIL_FROM). HTTPS, not SMTP, because Railway
 *             blocks outbound SMTP below the Pro plan. Only metadata is stored (no body, so tokens
 *             never rest in the database).
 * - `none`    (default when unset) nothing is sent; the row records `not_configured` and screens show
 *             "Email is not set up" with the next step. Never a fake "sent".
 * Sending happens after the database transaction commits; a failed send never rolls back the change.
 */
export type EmailMessage = { to: string; subject: string; text: string; template: string; organizationId?: string | null };
export type EmailProvider = "none" | "outbox" | "resend";
export type SendResult = { status: "captured" | "sent" | "failed" | "not_configured"; provider: EmailProvider; error?: string };

export function emailProvider(): EmailProvider {
  const p = (process.env.EMAIL_PROVIDER ?? "none").trim().toLowerCase();
  if (p === "outbox" || p === "resend") return p;
  return "none";
}

/** Human status for the admin screens (never shows secrets). */
export function emailSetupStatus(): { provider: EmailProvider; ready: boolean; problem: string | null } {
  const provider = emailProvider();
  if (provider === "none") return { provider, ready: false, problem: "Email is not set up (EMAIL_PROVIDER is not set). Invitation and reset links must be passed on by hand." };
  if (provider === "outbox") {
    if (process.env.NODE_ENV === "production") return { provider, ready: false, problem: "EMAIL_PROVIDER=outbox is for development only and is refused in production." };
    return { provider, ready: true, problem: null };
  }
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return { provider, ready: false, problem: "EMAIL_PROVIDER=resend needs RESEND_API_KEY and EMAIL_FROM." };
  return { provider, ready: true, problem: null };
}

export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const provider = emailProvider();
  const status = emailSetupStatus();
  const base = { organizationId: msg.organizationId ?? null, toAddress: msg.to, subject: msg.subject, template: msg.template, provider };
  if (provider === "outbox" && status.ready) {
    await db.insert(emailOutbox).values({ ...base, bodyText: msg.text, status: "captured" });
    if (process.env.NODE_ENV !== "test" && !process.env.VITEST) console.info(`[email:outbox] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`);
    return { status: "captured", provider };
  }
  if (provider === "resend" && status.ready) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) throw new Error(`HTTP ${res.status}${body.message ? `: ${body.message}` : ""}`);
      await db.insert(emailOutbox).values({ ...base, bodyText: null, status: "sent", providerMessageId: body.id ?? null });
      return { status: "sent", provider };
    } catch (e) {
      const error = String(redact((e as Error).message)).slice(0, 300);
      await db.insert(emailOutbox).values({ ...base, bodyText: null, status: "failed", error });
      console.error(`[email] send failed (${provider}): ${error}`);
      return { status: "failed", provider, error };
    }
  }
  await db.insert(emailOutbox).values({ ...base, bodyText: null, status: "not_configured", error: status.problem });
  return { status: "not_configured", provider };
}
