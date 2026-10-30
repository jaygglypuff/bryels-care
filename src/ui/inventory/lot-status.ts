import { daysUntil } from "@/lib/qty";

/** Statuses that already say "do not use"; a past expiry date does not override them. */
const BLOCKING = ["rejected", "recalled", "expired"];

/** The status a lot list shows: "expired" once the expiry date is before today (Asia/Manila), unless already blocked. */
export function lotDisplayStatus(status: string, expiresOn: string | null | undefined, now = new Date()): string {
  const d = expiresOn ? daysUntil(expiresOn, now) : null;
  return d !== null && d < 0 && !BLOCKING.includes(status) ? "expired" : status;
}
