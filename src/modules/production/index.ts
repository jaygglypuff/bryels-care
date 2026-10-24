import "server-only";

/** Public API of the production module. Other modules import only from here. */
export { createBatch, startBatch, type CreateBatchInput } from "./batches";
export { recordDispense, toleranceRange, type DispenseInput } from "./dispensing";
export { completeStep, type CompleteStepInput } from "./steps";
export { completeBatch, type CompleteBatchInput } from "./completion";
export {
  listBatches,
  getBatchRecord,
  usableLotsForBatch,
  checkerOptions,
  approvedFormulaOptions,
  listProducts,
  progressLabel,
  type BatchListRow,
  type BatchRecord,
  type LotOption,
} from "./queries";
export { BATCH_STATUSES, BATCH_TRANSITIONS, canTransition, transitionBatch, isBatchStatus, type BatchStatus } from "./state";
export { type FormulaSnapshot, manilaToday, addDays, CHECKER_PERMISSION, isWeighingStep } from "./shared";
// Wave 2 W2D: BMR documents, closure and controlled reopen/amend, hybrid paper pages (E-3-06).
export { buildBmrDataset, generateBmr, generateBmrInTx, bmrPrintView, bmrDocuments, bmrWatermark, BMR_KIND, PAPER_PAGE_KIND, type BmrPrintView } from "./bmr";
export {
  closeBatch,
  closureChecks,
  requestReopen,
  decideReopen,
  withdrawReopen,
  recordAmendment,
  getClosureView,
  BATCH_REOPEN_POLICY,
  REOPEN_TRANSITIONS,
  type ClosureView,
  type ClosureCheck,
  type ReopenInput,
  type AmendmentInput,
} from "./closure";
export {
  issuePaperPage,
  attachPaperScan,
  reviewPaperRecord,
  voidPaperPage,
  paperRecordBlockers,
  assertPaperRecordsReviewed,
  listPaperRecords,
  paperScanDownloadUrl,
  redeemPaperScan,
  PAPER_STATUS_TRANSITIONS,
  NEVER_PAPER_ONLY_STEP_KINDS,
} from "./bmr-paper";
export { bmrLineClearanceChecks, bmrProcessReadings, bmrEquipmentUses, bmrYieldRecord, bmrBatchOutputs, bmrInspections, bmrDeviations, openDeviationNumbers } from "./bmr-sources";
