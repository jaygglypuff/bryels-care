import "server-only";
import Decimal from "decimal.js";
import { and, eq, inArray } from "drizzle-orm";
import { type DbOrTx, type Tx } from "@/db/client";
import { idempotencyKeys, materials, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { findConversionStep, toBasePair } from "@/modules/masterdata";
import { sql } from "drizzle-orm";

/** Shared helpers of the procurement module (Wave 4 W4A). Quantities and money are decimal strings (ADR-010). */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Business date in Asia/Manila (YYYY-MM-DD). */
export function businessDate(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

export function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to.slice(0, 10) + "T00:00:00Z") - Date.parse(from.slice(0, 10) + "T00:00:00Z")) / 86_400_000);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function optDate(v: string | null | undefined, field: string, label: string): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  if (!DATE_RE.test(t) || Number.isNaN(Date.parse(t + "T00:00:00Z"))) throw new DomainError("validation", `${label}: use a valid date.`, { field });
  return t;
}

export function cleanText(v: string | null | undefined, max: number, field: string, label: string): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  if (t.length > max) throw new DomainError("validation", `${label} is too long (max ${max} characters).`, { field });
  return t;
}

export function requireReason(v: string | null | undefined, field = "reason", min = 5): string {
  const r = (v ?? "").trim();
  if (r.length < min) throw new DomainError("validation", `Give a reason of at least ${min} characters.`, { field });
  if (r.length > 1000) throw new DomainError("validation", "Reason is too long (max 1,000 characters).", { field });
  return r;
}

/** Positive decimal with at most `dp` places (quantities 6, money 4). */
export function parseDecimal(v: unknown, field: string, label: string, opts: { dp?: number; allowZero?: boolean } = {}): Decimal {
  let d: Decimal;
  try {
    d = new Decimal(String(v ?? "").trim().replace(/,/g, ""));
  } catch {
    throw new DomainError("validation", `${label}: enter a number like 25 or 12.5.`, { field });
  }
  if (!d.isFinite() || (opts.allowZero ? d.lt(0) : d.lte(0))) throw new DomainError("validation", `${label} must be ${opts.allowZero ? "zero or more" : "greater than zero"}.`, { field });
  if (d.decimalPlaces() > (opts.dp ?? 6)) throw new DomainError("validation", `${label}: use at most ${opts.dp ?? 6} decimal places.`, { field });
  return d;
}

export function optDecimal(v: unknown, field: string, label: string, opts: { dp?: number; allowZero?: boolean } = {}): Decimal | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  return parseDecimal(v, field, label, opts);
}

export const money4 = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

export type MaterialRow = typeof materials.$inferSelect;

/**
 * Converts an entered quantity to the material's base unit through the approved UOM conversions
 * (W2G UOM service, V-UOM). Returns null when no conversion exists.
 */
export async function toBase(q: DbOrTx, organizationId: string, mat: MaterialRow, qty: Decimal, uom: string): Promise<Decimal | null> {
  const step = uom === mat.baseUom ? null : await findConversionStep(q, organizationId, uom, mat.baseUom, mat.id);
  const pair = toBasePair({ qty: qty.toString(), uom }, mat.baseUom, step);
  return pair ? new Decimal(pair.base.qty) : null;
}

/** Quantity of `uom` in one base unit inverse: how many base units one `uom` is (e.g. kg → 1000 g). */
export async function basePerUnit(q: DbOrTx, organizationId: string, mat: MaterialRow, uom: string): Promise<Decimal | null> {
  return toBase(q, organizationId, mat, new Decimal(1), uom);
}

/** Display names for user ids. */
export async function namesOf(q: DbOrTx, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await q.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Prices and amounts are sensitive (docs/permissions-matrix.md §6: masterdata.supplier_price.view). */
export const canSeePrices = (ctx: AuthContext) => ctx.can("masterdata.supplier_price.view");

/**
 * Idempotent command wrapper (data-model §1.10): the first call stores its result under (organization,
 * key); a repeat with the same key returns the stored result without running again.
 */
export async function idempotent<T extends object>(tx: Tx, ctx: AuthContext, key: string | null | undefined, command: string, fn: () => Promise<T>): Promise<{ result: T; replayed: boolean }> {
  if (!key) return { result: await fn(), replayed: false };
  const inserted = await tx.insert(idempotencyKeys).values({ organizationId: ctx.organizationId, key, command }).onConflictDoNothing().returning({ id: idempotencyKeys.id });
  if (inserted.length === 0) {
    const [row] = await tx
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.organizationId, ctx.organizationId), eq(idempotencyKeys.key, key)))
      .limit(1);
    if (!row || row.command !== command) throw new DomainError("conflict", "This request key was already used for a different action. Reload the page and try again.");
    if (!row.result) throw new DomainError("conflict", "This request is still being processed. Reload the page in a moment.");
    return { result: row.result as T, replayed: true };
  }
  const result = await fn();
  await tx
    .update(idempotencyKeys)
    .set({ result: sql`${JSON.stringify(result)}::jsonb` })
    .where(eq(idempotencyKeys.id, inserted[0].id));
  return { result, replayed: false };
}

/** Site check that reads as "not found" for records outside the caller's sites (no existence leak). */
export function assertInScope(ctx: AuthContext, siteId: string, what: string) {
  if (!ctx.allowedSiteIds.includes(siteId)) throw new DomainError("not_found", `${what} not found in your sites.`);
  ctx.requireSite(siteId);
}
