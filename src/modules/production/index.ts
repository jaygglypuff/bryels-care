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
