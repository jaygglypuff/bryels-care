/** Public API of the inventory module (other modules import only from here). */
export { postMovement, assertLotUsable, BLOCKED_STATUSES, type MovementType, type PostMovementInput } from "./ledger";
export { allowedDestinationKinds, isPastExpiry, getLotDetail, listLots, lotKpis, LOT_STATUSES, EXPIRY_WARN_DAYS } from "./lots";
export { resolveScan, normalizeScan, type ScanResult } from "./lookup";
export { listMovements, transferStock, documentHref } from "./movements";
export { postGoodsReceipt, getReceipt, receivingFormData } from "./receiving";
