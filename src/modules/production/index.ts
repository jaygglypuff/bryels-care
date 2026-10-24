import "server-only";

/** Public API of the production module. Other modules import only from here. */
export { createBatch, startBatch, type CreateBatchInput } from "./batches";
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

// Wave 2 W2B: batch execution (US-3-09..13)
export { STEP_STATUSES, STEP_TRANSITIONS, canStepTransition, checkStep, returnStep, eligibleSigners, checkPermission, performPermission, type StepStatus } from "./execution";
export { registerExecutionHooks, resetExecutionHooks, DEVIATION_UNAVAILABLE, type ExecutionHooks, type OpenDeviationInput, type DeviationKind, type InProcessQcStatus } from "./execution-hooks";
export { submitChecklist, type ClearanceAnswer, type SubmitChecklistInput } from "./line-clearance";
export { recordDispense, checkDispense, voidDispense, toleranceRange, toBaseQty, type DispenseInput } from "./dispensing";
export { recordReading, selectEquipment, approveStepException, evaluateReading, limitsLabel } from "./process";
export { startStep, completeStep, type CompleteStepInput } from "./steps";
export { issuePackaging, countPackaging } from "./packaging";
export { recordYield, approveYield, recordScrapRework, decideScrapRework } from "./yield";
export { postBatchToQuarantine, quarantineLocations, transferBlockers, type PostToQuarantineInput } from "./output";
export { getBatchExecution, batchSiteId, equipmentOptions, packagingLotOptions, signerOptions, type BatchExecution, type ExecStep } from "./execution-queries";
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
// Wave 2 W2A: work orders, batch creation from work orders, staging by scan (US-3-05..08)
export {
  createWorkOrder,
  editWorkOrder,
  planWorkOrder,
  releaseWorkOrder,
  reserveWorkOrderShortages,
  cancelWorkOrder,
  createBatchFromWorkOrder,
  syncWorkOrderProgress,
  workOrderInputSchema,
  type WorkOrderInput,
} from "./work-orders";
export { WORK_ORDER_STATUSES, WORK_ORDER_TRANSITIONS, canWorkOrderTransition, type WorkOrderStatus } from "./work-orders-state";
export { listWorkOrders, getWorkOrder, workOrderFormOptions, listProductionLines, type WorkOrderListRow, type WorkOrderDetail, type WorkOrderFilter } from "./work-orders-queries";
export { workOrderRequirements, type Shortage } from "./work-orders-reserve";
export { stageMaterial, approveMaterialSubstitution, releaseBatchStagingReservations, getStagingView, listBatchesToStage, canSeeStaging, type StageInput, type SubstitutionInput, type StagingView } from "./staging";
export { generateBatchSheet, batchSheetData, batchSheets, type BatchSheetKind } from "./staging-documents";
export { getProductionBoard, moveBoardCard, boardMove, type ProductionBoard, type BoardCard, type BoardColumn, type MoveVerdict, type BoardFilter } from "./board";
export {
  buildProductionPlan,
  approveProductionPlan,
  closeProductionPlan,
  convertPlanLine,
  setMinStock,
  listProductionPlans,
  getProductionPlan,
  planningOverview,
  demandSnapshot,
  PLAN_TRANSITIONS,
  type ProductionPlanDetail,
} from "./planning";
