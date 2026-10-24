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
