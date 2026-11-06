import Decimal from "decimal.js";

/**
 * ADR-110 C7 (pure; assumption A-LBL-SACK-01 for QA and the labelling reviewer): what a sack label says about the
 * quantity when one lot came in several containers. The whole-lot quantity is never printed on every sack.
 * - one container: the lot quantity as before;
 * - an even split (whole base units, e.g. 200 kg in 4 sacks = 50,000 g each): the quantity per sack;
 * - uneven, or stock already used: no quantity (each copy says "Sack 1 of 4", see `sackLine`).
 */
export function perContainerQuantity(received: Decimal.Value, containers: number | null | undefined, onHand: Decimal.Value): { perContainer: Decimal | null; containers: number } {
  const n = containers && containers > 1 ? containers : 1;
  if (n === 1) return { perContainer: new Decimal(onHand), containers: 1 };
  const total = new Decimal(received);
  if (!new Decimal(onHand).eq(total)) return { perContainer: null, containers: n };
  const per = total.div(n);
  return { perContainer: per.isInteger() ? per : null, containers: n };
}

/** The quantity row on copy `copyNo` of `copies` (numbered only when one label is printed per container). */
export function sackLine(quantityText: string | null | undefined, containerCount: number | null | undefined, copyNo: number, copies: number): string | null {
  if (!containerCount || containerCount < 2 || copies !== containerCount) return quantityText ?? null;
  return quantityText ? `${quantityText} · sack ${copyNo} of ${containerCount}` : `Sack ${copyNo} of ${containerCount}`;
}
