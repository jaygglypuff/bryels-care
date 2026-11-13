/**
 * Message titles lead with names and places, not codes (round 5 leftovers, ADR-132 §3; B report #9): "Put the Coconut
 * Oil (lot …0017) on shelf A-01" instead of "Coconut Oil lot L-2611-00017 is ready — put it on A-01". The record
 * number stays in the body (or after the words, short) so the person can still match a label. Pure, unit-tested; the
 * title builders at the source call these.
 */

/** The last four digits of a record number: "L-2611-00017" → "…0017". Numbers without digits stay as they are. */
export function shortNo(no: string | null | undefined): string {
  const digits = (no ?? "").replace(/\D/g, "");
  if (!digits) return no ?? "";
  return `…${digits.slice(-4)}`;
}

/** "lot …0017" (or "" when there is no lot number). */
export const lotWords = (lotNumber: string | null | undefined) => (lotNumber ? `lot ${shortNo(lotNumber)}` : "");

/** "Coconut Oil (lot …0017)". */
export function itemWithLot(itemName: string, lotNumber: string | null | undefined): string {
  const l = lotWords(lotNumber);
  return l ? `${itemName} (${l})` : itemName;
}

export const MessageTitle = {
  putAway: (itemName: string, lotNumber: string, shelf: string | null) => `Put the ${itemWithLot(itemName, lotNumber)} ${shelf ? `on shelf ${shelf}` : "on a shelf"}`,
  lotToCheck: (itemName: string, lotNumber: string, supplier: string | null) => `Check the ${itemWithLot(itemName, lotNumber)}${supplier ? ` from ${supplier}` : ""}`,
  productionOrderToApprove: (productName: string) => `Approve making ${productName}`,
  batchToDecide: (productName: string, batchNumber: string) => `Decide on the batch of ${productName} (batch ${shortNo(batchNumber)})`,
  weighingToCheck: (productName: string, weigher: string | null) => (weigher ? `Check ${weigher}'s weighing: ${productName}` : `Check a weighing: ${productName}`),
  stepToCheck: (stepName: string, productName: string) => `Check "${stepName}": ${productName}`,
  orderToSetAside: (customer: string) => `Set aside the order for ${customer}`,
  orderToPick: (customer: string) => `Get the order for ${customer} from the shelf`,
  boxesToCheck: (customer: string) => `Check the boxes for ${customer}`,
  deliveryToSend: (customer: string) => `Send out the delivery to ${customer}: the boxes are checked`,
  purchaseOrderToApprove: (supplier: string) => `Approve the purchase order to ${supplier}`,
  purchaseOrderToSend: (supplier: string) => `Send the purchase order to ${supplier}`,
} as const;
