/**
 * Pure helpers for products and SKUs (US-1-22). No database access; unit-tested.
 */

/** Which event starts the shelf life (A-PRD-28: batch completion by default, switchable to release). */
export type ExpiryBasis = "completion" | "release";

/** The base date for a batch's expiry under the configured basis; null when that event has not happened. */
export function expiryBaseDate(dates: { completedOn: string | null; releasedOn: string | null }, basis: ExpiryBasis = "completion"): string | null {
  return basis === "release" ? dates.releasedOn : dates.completedOn;
}

/**
 * Expiry = base date + shelf life days (US-1-22 AC2), calendar arithmetic on YYYY-MM-DD dates (no
 * time zone drift). Null when the SKU has no shelf life.
 */
export function expiryFor(sku: { shelfLifeDays: number | null }, baseDate: string): string | null {
  if (sku.shelfLifeDays === null || sku.shelfLifeDays === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) throw new Error(`expiryFor: invalid base date ${baseDate}`);
  const d = new Date(`${baseDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + sku.shelfLifeDays);
  return d.toISOString().slice(0, 10);
}

/** GS1 check digit (mod 10) for GTIN-8/12/13/14. A data-format check, not a business rule. */
export function isValidGtin(gtin: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)) return false;
  const digits = gtin.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export const PRODUCT_STATUSES = ["draft", "active", "discontinued"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
/** Product and SKU lifecycle (US-1-22 AC1): draft → active → discontinued; discontinued is final. */
export const PRODUCT_TRANSITIONS: Record<ProductStatus, readonly ProductStatus[]> = {
  draft: ["active", "discontinued"],
  active: ["discontinued"],
  discontinued: [],
};
