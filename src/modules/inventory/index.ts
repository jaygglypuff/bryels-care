/** Public API of the inventory module (other modules import only from here). */
export { postMovement, assertLotUsable, BLOCKED_STATUSES, type MovementType, type PostMovementInput } from "./ledger";
export { allowedDestinationKinds, isPastExpiry, getLotDetail, listLots, lotKpis, LOT_STATUSES, EXPIRY_WARN_DAYS } from "./lots";
export { resolveScan, normalizeScan, type ScanResult } from "./lookup";
export { listMovements, transferStock, documentHref } from "./movements";
export { postGoodsReceipt, getReceipt, receivingFormData } from "./receiving";
// Wave 1 W1C: scan-move, undo, containers, counts, adjustments, reservations and FEFO/FIFO
export { scanMove, undoMove, interSiteTransfer, looseQty, boxedQty, listRecentTransfers, listSiteLocations, type MoveResult, type ScanMoveInput, type UndoResult } from "./moves";
export { describeBoxForScan, describeLocationForScan, describeLotForScan, type ScanCard } from "./moves-scan-cards";
export { createBox, splitBox, mergeBoxes, repackBox, setBoxStatus, getContainer, listContainers, findContainerByNumber, boxAllowedActions, containerLineageGraph, type AllowedAction, type ContainerDetail } from "./containers";
export { assertLocationsNotFrozen, activeCountsForLocations, createCount, releaseCount, cancelCount, recordCount, submitCount, recordRecount, approveCount, rejectCountLines, postCount, listCounts, getCount, eligibleCounters, findLotForCount, type CountDetail } from "./counts";
export { createAdjustment, submitAdjustment, approveAdjustment, rejectAdjustment, cancelAdjustment, postAdjustment, listAdjustments, getAdjustment, type AdjustmentDetail } from "./adjustments";
export {
  recommendLots,
  createReservation,
  releaseReservation,
  expireReservations,
  listReservations,
  reservedByLotLocation,
  resolveAllocationStrategy,
  sortCandidates,
  compareCandidates,
  convertReservationsForDemands,
  candidatesFor,
  recommendableItems,
} from "./reservations";
export { getInventorySetting, effectiveInventorySettings, INVENTORY_SETTINGS } from "./policy";
export { editLotAttributes, expiryAlerts, listLocationsWithStock, getLocationDetail } from "./lots-admin";
