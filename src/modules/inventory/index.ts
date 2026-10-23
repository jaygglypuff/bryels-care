/** Public API of the inventory module (other modules import only from here). */
export { postMovement, assertLotUsable, BLOCKED_STATUSES, type MovementType, type PostMovementInput } from "./ledger";
export { allowedDestinationKinds, isPastExpiry, getLotDetail, listLots, lotKpis, LOT_STATUSES, EXPIRY_WARN_DAYS } from "./lots";
export { resolveScan, normalizeScan, type ScanResult } from "./lookup";
export { listMovements, transferStock, documentHref } from "./movements";
export {
  postGoodsReceipt,
  receiveAndPost,
  createReceiptDraft,
  updateReceiptDraft,
  postReceipt,
  cancelReceiptDraft,
  reverseReceipt,
  recordLineDiscrepancy,
  approveLineDiscrepancy,
  linkReceiptSupplier,
  type ReceiptDraftInput,
  type ReceiptLineInput,
} from "./receiving";
export { getReceipt, receivingFormData, getReceiptDocument, listReceipts, exportReceiptsCsv, lotReleaseBlockers, openHoldsForLot, type ReceiptDocument } from "./receiving-queries";
export * from "./receiving-state";
export { uploadReceiptDocument, issueDownloadUrl, redeemDownload, voidAttachment, listLotDocuments, SUPPLIER_DOCUMENT_KINDS, SUPPLIER_DOCUMENT_LABELS, type SupplierDocumentKind } from "./receiving-documents";
export { putAwayLot, putAwayOptions } from "./receiving-putaway";
export {
  placeHold,
  liftHold,
  markHoldInvestigating,
  listHolds,
  getHold,
  holdFormData,
  issueHeldStock,
  assertLocationNotHeld,
  heldLocations,
  resolveLotRef,
  HOLD_REASON_CODES,
  HOLD_RESOLUTIONS,
  HELD_ISSUE_PURPOSES,
  type HoldResolution,
  type HeldIssuePurpose,
} from "./holds";
export { runExpiryCheck, runExpiryCheckAll, systemContext } from "./holds-expiry";
