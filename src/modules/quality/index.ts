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
