/**
 * ADR-138 §1 "Made for": what a production order with no customer order is made for (owner 2026-11-21: "items that
 * don't need work orders … just need an inventory for Shopee or online or sample customers"). Information on the
 * order, the lists and the plan; the cover rule still counts such an order as "for stock" (order-cover-rule.ts).
 * Pure (unit tested in tests/unit/takeout-rules.test.ts).
 */
export const MADE_FOR = ["stock", "online_shop", "samples", "other"] as const;
export type MadeFor = (typeof MADE_FOR)[number];

export const MADE_FOR_WORDS: Record<MadeFor, string> = {
  stock: "For stock",
  online_shop: "For the online shop",
  samples: "For samples",
  other: "Other",
};

export const isMadeFor = (v: unknown): v is MadeFor => typeof v === "string" && (MADE_FOR as readonly string[]).includes(v);

/** "For SO-26-00012" / "For the online shop" / "Other: trade fair" / "For stock" (no choice made). */
export function madeForText(o: { madeFor?: string | null; madeForNote?: string | null; salesOrderNumber?: string | null }): string {
  if (o.salesOrderNumber) return `For ${o.salesOrderNumber}`;
  if (o.madeFor === "other") return `Other: ${o.madeForNote?.trim() || "no note"}`;
  return isMadeFor(o.madeFor) ? MADE_FOR_WORDS[o.madeFor] : MADE_FOR_WORDS.stock;
}
