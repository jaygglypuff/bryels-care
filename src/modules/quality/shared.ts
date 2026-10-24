import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { idempotencyKeys } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { MIN_REASON_LENGTH } from "./rules";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export function assertUuid(v: unknown, what: string): asserts v is string {
  if (!isUuid(v)) throw new DomainError("not_found", `${what} not found in your sites.`);
}

/** Trimmed reason of MIN_REASON_LENGTH..max characters (field-mapped validation error otherwise). */
export function reasonText(v: string | null | undefined, field = "reason", max = 1000): string {
  const r = (v ?? "").trim();
  if (r.length < MIN_REASON_LENGTH) throw new DomainError("validation", `Give a reason of at least ${MIN_REASON_LENGTH} characters.`, { field });
  if (r.length > max) throw new DomainError("validation", `Too long (max ${max.toLocaleString("en-PH")} characters).`, { field });
  return r;
}

/** Optional free text: trimmed, null when empty, length-checked. */
export function optionalText(v: string | null | undefined, field: string, max = 2000): string | null {
  const r = (v ?? "").trim();
  if (!r) return null;
  if (r.length > max) throw new DomainError("validation", `Too long (max ${max.toLocaleString("en-PH")} characters).`, { field });
  return r;
}

export function requiredText(v: string | null | undefined, field: string, label: string, max = 2000): string {
  const r = optionalText(v, field, max);
  if (!r) throw new DomainError("validation", `${label} is required.`, { field });
  return r;
}

/**
 * Idempotent command wrapper (ADR-009, same contract as the production module's): the first call stores
 * its result under the key inside the caller's transaction; a repeat returns the stored result.
 */
export async function withIdempotency<T extends object>(tx: Tx, ctx: AuthContext, key: string | null | undefined, command: string, fn: () => Promise<T>): Promise<T & { replayed?: boolean }> {
  if (!key) return fn();
  if (key.length > 200) throw new DomainError("validation", "The request key is too long.");
  const inserted = await tx.insert(idempotencyKeys).values({ organizationId: ctx.organizationId, key, command }).onConflictDoNothing().returning({ id: idempotencyKeys.id });
  if (inserted.length === 0) {
    const [row] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.organizationId, ctx.organizationId), eq(idempotencyKeys.key, key))).limit(1);
    if (!row || row.command !== command) throw new DomainError("conflict", "This request key was already used for a different action. Reload the page and try again.");
    if (!row.result) throw new DomainError("conflict", "This request is still being processed. Reload the page in a moment.");
    return { ...(row.result as T), replayed: true };
  }
  const result = await fn();
  await tx
    .update(idempotencyKeys)
    .set({ result: sql`${JSON.stringify(result)}::jsonb` })
    .where(eq(idempotencyKeys.id, inserted[0].id));
  return result;
}

/** Today's date in Asia/Manila as YYYY-MM-DD. */
export function manilaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const isIsoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
