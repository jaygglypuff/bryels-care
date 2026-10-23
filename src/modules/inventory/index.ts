/** Public API of the inventory module (other modules import only from here). */
export { postMovement, assertLotUsable, BLOCKED_STATUSES, type MovementType, type PostMovementInput } from "./ledger";
export { allowedDestinationKinds, isPastExpiry, getLotDetail, listLots, lotKpis, LOT_STATUSES, EXPIRY_WARN_DAYS } from "./lots";
export { resolveScan, normalizeScan, type ScanResult } from "./lookup";
export { listMovements, transferStock, documentHref } from "./movements";
export { postGoodsReceipt, getReceipt, receivingFormData } from "./receiving";
export { postMovements, lockLots } from "./ledger";
export { reverseMovement, getMovementDetail, correctionLocations, REVERSIBLE_MOVEMENT_TYPES, REVERSAL_CONFIRMATION_WORD, type ReverseMovementInput } from "./reversal";
export {
  findLedgerDifferences,
  requestReconciliation,
  requestBalanceRebuild,
  listReconciliationRuns,
  getReconciliationRun,
  type LedgerDifference,
} from "./reconciliation";
export { inventoryReconcileJob, inventoryRebuildBalancesJob } from "./jobs";
export { availabilityRows, availabilityTotals, computeAvailability, bucketOf, manilaToday, type AvailabilityRow } from "./availability";
export { getStockCard, type StockCard } from "./stock-card";
export { availabilityExport, stockCardExport } from "./exports";
