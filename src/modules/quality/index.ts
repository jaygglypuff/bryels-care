/** Public surface of the quality module (other modules import only from here). */
export { getQaQueue, getLotDisposition, decideLot, getBatchRelease, decideBatch } from "./dispositions";
export type { DecideLotInput, DecideBatchInput } from "./dispositions";
export { recordTestResult } from "./tests";
export type { RecordTestResultInput } from "./tests";
export { traceGenealogy, genealogyExport, flattenTrace } from "./genealogy";
export type { TraceNode, TraceResult, AffectedCustomer } from "./genealogy";
export * from "./rules";
// Wave 2 W2C (US-3-14, US-3-15, US-3-21, US-2-23, US-2-24)
export {
  createInspection,
  ensureBatchInspection,
  inProcessQcStatus,
  recordSample,
  recordInspectionResult,
  correctInspectionResult,
  submitInspection,
  reviewInspection,
  cancelInspection,
  listInspections,
  inspectionCandidates,
  getInspection,
  type RecordSampleInput,
  type RecordResultInput,
  type CorrectResultInput,
  type ReviewDecision,
} from "./inspections";
export { INSPECTION_STATUS_LABEL, INSPECTION_TRANSITIONS, evaluateResult, specLabel } from "./inspection-rules";
export {
  openDeviation,
  startInvestigation,
  updateInvestigation,
  closeDeviation,
  containDeviation,
  listDeviations,
  getDeviation,
  deviationFormContext,
  deviationExport,
  DEVIATION_TRANSITIONS,
  DEVIATION_SOURCE_LABEL,
  type OpenDeviationInput,
  type CloseDeviationInput,
  type DeviationSource,
} from "./deviations";
export { requestConditionalRelease, decideConditionalRelease, cancelConditionalRelease, conditionalReleaseState } from "./conditional-release";
export { bulkDispositionCandidates, applyBulkDisposition, BULK_REASON_CODES, type BulkDispositionInput, type BulkFilter } from "./bulk-disposition";
export { labelVerificationZone, verifyLabelScan, labelVerificationLocations } from "./label-verification";
// Wave 3 W3F: complaints (US-4-15) and the recall explorer (US-4-17)
export {
  logComplaint,
  classifyComplaint,
  startComplaintInvestigation,
  updateComplaint,
  resolveComplaint,
  reopenComplaint,
  closeComplaint,
  raiseComplaintDeviation,
  listComplaints,
  getComplaint,
  complaintFormContext,
  getComplaintAcknowledgement,
  type LogComplaintInput,
} from "./complaints";
export { COMPLAINT_TRANSITIONS, COMPLAINT_STATUS_LABEL, COMPLAINT_CHANNEL_LABEL, TRACE_MATCH_LABEL, toCustomerFacing, type ComplaintStatus, type CustomerFacingComplaint } from "./complaints-rules";
export { recallScope, recallExport, flattenRecall, type RecallScope, type RecallQuery, type RecallMode } from "./recall";
// Wave 4 W4C: CAPA, change control and recall cases (US-6-18)
export {
  openCapa,
  updateCapa,
  addCapaAction,
  completeCapaAction,
  verifyCapaAction,
  reopenOrCancelCapaAction,
  submitCapaForClosure,
  recordEffectivenessCheck,
  closeCapa,
  cancelCapa,
  listCapas,
  getCapa,
  capaFormContext,
  capaExport,
  overdueCapaActionCandidates,
  type OpenCapaInput,
  type AddCapaActionInput,
} from "./capa";
export {
  createChangeControl,
  updateChangeControl,
  submitChangeControl,
  decideChangeControl,
  implementChangeControl,
  closeChangeControl,
  cancelChangeControl,
  listChangeControls,
  getChangeControl,
  changeControlFormContext,
  changeControlApprovalCandidates,
  type CreateChangeControlInput,
} from "./change-control";
export {
  openRecallCase,
  refreshRecallScope,
  updateRecallCase,
  submitRecallCase,
  decideRecallCase,
  markRecallCaseLots,
  startRecallDrill,
  recordRecallNotification,
  startRecallRecovery,
  recordRecallAccounted,
  closeRecallCase,
  cancelRecallCase,
  listRecallCases,
  getRecallCase,
  recallCaseCandidates,
  recallNotificationExport,
  recallCasesForLot,
  type OpenRecallCaseInput,
} from "./recall-cases";
export * from "./capa-rules";
// ADR-080 G3: Check quality (one page per finished batch) and the release hook.
export {
  getQualityCheck,
  listWaitingForCheck,
  decideQualityCheck,
  batchMakers,
  batchExceptions,
  QUALITY_CHECK_DECISIONS,
  QUALITY_CHECK_LABEL,
  type QualityCheckDecision,
  type QualityCheckInput,
  type QualityCheckView,
  type ExceptionItem,
} from "./check-quality";
export { registerQualityReleaseHooks, resetQualityReleaseHooks, type QualityReleaseHooks, type AutoCloseResult } from "./release-hooks";
export { changeControlApprovalVerdicts, recallCaseApprovalVerdicts } from "./approval-gates"; // ADR-075 "To approve"
