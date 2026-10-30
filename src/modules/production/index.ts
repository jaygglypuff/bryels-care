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
// ADR-080 G3: Finish batch (one transaction over the yield, rejects, packaging and hold-area bodies).
export { finishBatch, getFinishView, defaultHoldLocation, type FinishBatchInput, type FinishReject, type FinishPackaging, type FinishView } from "./finish";
export { recordYield, approveYield, recordScrapRework, decideScrapRework } from "./yield";
export { postBatchToQuarantine, quarantineLocations, transferBlockers, type PostToQuarantineInput } from "./output";
export { getBatchExecution, batchSiteId, equipmentOptions, packagingLotOptions, signerOptions, type BatchExecution, type ExecStep } from "./execution-queries";
// Wave 2 W2D: BMR documents, closure and controlled reopen/amend, hybrid paper pages (E-3-06).
export { buildBmrDataset, generateBmr, generateBmrInTx, bmrPrintView, bmrDocuments, bmrWatermark, BMR_KIND, PAPER_PAGE_KIND, type BmrPrintView } from "./bmr";
export {
  closeBatch,
  closureChecks,
  autoCloseReleasedBatch,
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
// ADR-074 (S2) + ADR-080 (G1): one production order (work order + batches) with status v2, one next action, one-step approve and a daily log.
export {
  PRODUCTION_ORDER_STATUSES,
  PRODUCTION_ORDER_LABEL,
  PRODUCTION_ORDER_CHIP,
  PRODUCTION_ORDER_STEPS,
  OPEN_STATUSES,
  productionOrderStatus,
  batchStatusView,
  progressSteps,
  isLate,
  piecesText,
  pieceWord,
  shortDay,
  type ProductionOrderStatus,
  type ProductionOrderStatusView,
  type BatchFact,
} from "./production-order-status";
export { productionOrderActions, batchNextAction, type NextAction } from "./production-order-next";
export {
  createProductionOrder,
  approveProductionOrder,
  getProductionOrder,
  listProductionOrders,
  listProductionOrderBoard,
  loadBatchFacts,
  batchStepWord,
  shortageLines,
  salesOrderShortfalls,
  makeForSalesLine,
  productionOrdersForSalesOrder,
  MAKE_FOR_SALES_STATUSES,
  type ProductionOrderInput,
  type ProductionOrderView,
  type ProductionOrderRow,
  type ApproveResult,
  type MakeForLine,
} from "./production-orders";
export { batchLogCounts } from "./daily-log";
export { addDailyLog, correctDailyLog, listDailyLogs, listSiteDailyLogs, defectSummary, defectTypes, type DailyLogEntryInput, type DailyLogRow, type DefectSummary, type DefectSummaryRow, type SiteDailyLog } from "./daily-log";
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
// ADR-080 stage G2: Materials list, Weigh cards, Step cards, curing (production flow v2, slices V2-3..V2-5).
export { getMaterialsList, confirmPicked, canTickMaterials, type MaterialsListView, type MaterialsListLine, type PickInput, type PickResult } from "./materials-list";
export { getWeighView, type WeighView } from "./weigh-cards";
export { getStepCard, stepDone, STEP_CARD_MAX_FIELDS, type StepCardView, type StepDoneInput, type StepDoneResult } from "./step-cards";
export {
  batchFlowFacts,
  getBatchFlowFacts,
  orderBatchFacts,
  nextBatchScreen,
  currentStepOf,
  batchExpiryDates,
  mixingDateOf,
  waitLabel,
  flowPath,
  WAIT_STEP_KINDS,
  type BatchFlowFacts,
  type CurrentStepFacts,
  type NextScreen,
  type PickProgress,
} from "./flow-facts";
export { remindCuringReady, dueWaits } from "./curing";
export { confirmLot } from "./dispensing";
