import Decimal from "decimal.js";

/**
 * How much of a material an order still misses (Materials tab). What is already in the batch — ticked as taken on
 * Get materials (counted at the batch's needed amount, since the tick records no amount), weighed in, or moved by the
 * older staging — counts once (the largest of the three, since they describe the same material at different steps);
 * what is still set aside adds to it. Owner 2026-11-07: "Missing 270 g" showed for an ingredient fully weighed in.
 */
export function materialShort(a: { required: Decimal; reserved: Decimal; staged: Decimal; consumed: Decimal; ticked: Decimal }): Decimal {
  const inBatch = Decimal.max(a.staged, a.consumed, a.ticked);
  return Decimal.max(a.required.minus(a.reserved).minus(inBatch), 0);
}
