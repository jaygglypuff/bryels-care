import "server-only";
import { and, eq, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import type { DbOrTx, Tx } from "@/db/client";
import { idempotencyKeys } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";

/**
 * Shared helpers of the W3D commercial services (customers, requirements, price lists, quotes, orders).
 * Masking happens here in the service DTO layer (docs/permissions-matrix.md §6): a hidden field is
 * omitted from the object (not set to null) and listed in `_masked`, so API, page and export all obey
 * the same rule.
 */

export type Masked<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>> & { _masked?: K[] };

/** Removes `fields` unless the caller holds `permission`; lists what was removed in `_masked`. */
export function maskFields<T extends object, K extends keyof T>(ctx: AuthContext, permission: Permission, row: T, fields: readonly K[]): Masked<T, K> {
  if (ctx.can(permission)) return row as Masked<T, K>;
  const out = { ...row } as Record<string, unknown>;
  for (const f of fields) delete out[f as string];
  out._masked = [...fields];
  return out as Masked<T, K>;
}

/** Customer credit terms and tax id (finance.credit_terms.view, US-4-01 AC1). */
export const CREDIT_FIELDS = ["creditLimitAmount", "paymentTermsDays", "taxIdentifier"] as const;

/** Prices and amounts (sales.price_list.view, US-4-03 AC1). */
export const canSeePrices = (ctx: AuthContext) => ctx.can("sales.price_list.view");

/**
 * Idempotent command wrapper (ADR-006, data-model §1.10): the first call stores its result under
 * (organization, key); a repeat with the same key returns the stored result without running again.
 * Same contract as the production and masterdata helpers, kept inside the sales module.
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

/** Today's business date in Asia/Manila (YYYY-MM-DD). */
export function businessDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Money rounded half-up to 2 decimals as a string (amounts are stored numeric(18,4)). */
export const money = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

/** Discount of a price against the list price in percent (0 when there is no list price or no discount). */
export function discountPct(listPrice: Decimal.Value | null | undefined, price: Decimal.Value): string {
  if (listPrice === null || listPrice === undefined) return "0";
  const l = new Decimal(listPrice);
  if (l.lte(0)) return "0";
  const d = l.minus(price).div(l).times(100);
  return d.lte(0) ? "0" : d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString();
}

/**
 * Wave 4 W4B: the sales tax rate of quotes and orders comes from finance's reviewed tax configuration
 * (finance.tax.default_sales_code → an approved, effective tax_configurations row; US-6-14), which replaced
 * the setting `sales.tax.rate_pct` (A-W3D-01). Finance registers the resolver in src/modules/wiring.ts
 * (sales must not import finance, which imports sales); no resolver or no configured code = 0 % (no tax line).
 */
export type SalesTaxRateResolver = (q: DbOrTx, organizationId: string, onDate: string) => Promise<Decimal.Value>;
const TAX_RESOLVER_KEY = "__bc_sales_tax_rate_resolver__";
export function registerSalesTaxRateResolver(fn: SalesTaxRateResolver) {
  (globalThis as unknown as Record<string, SalesTaxRateResolver>)[TAX_RESOLVER_KEY] = fn;
}
export async function salesTaxRatePct(q: DbOrTx, organizationId: string, now = new Date()): Promise<Decimal> {
  const fn = (globalThis as unknown as Record<string, SalesTaxRateResolver | undefined>)[TAX_RESOLVER_KEY];
  return new Decimal(fn ? await fn(q, organizationId, businessDate(now)) : 0);
}

/** Subtotal, tax at `ratePct` (finance tax configuration, see salesTaxRatePct) and total of priced lines. */
export function totals(lines: { qty: Decimal.Value; price: Decimal.Value }[], ratePct: Decimal.Value) {
  const subtotal = lines.reduce((s, l) => s.plus(new Decimal(l.qty).times(l.price)), new Decimal(0));
  const tax = subtotal.times(ratePct).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { subtotal: money(subtotal), tax: money(tax), total: money(subtotal.plus(tax)) };
}

/** One-line rendering of a structured address. */
export function formatAddress(a: { line1: string; line2?: string | null; city?: string | null; province?: string | null; postalCode?: string | null; country?: string | null }): string {
  const parts = [a.line1, a.line2, [a.city, a.province].filter(Boolean).join(", "), a.postalCode].map((p) => (p ?? "").trim()).filter(Boolean);
  return parts.join(", ");
}
