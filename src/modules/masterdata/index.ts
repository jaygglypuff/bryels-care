import "server-only";

/**
 * Public API of the masterdata module: production engineering master data (Wave 1 W1D,
 * US-3-01..04). Other modules and the app layer import only from here.
 *
 * Wave 2 entry points: getEffectiveFormulaRevision, getEffectiveRouting, getInspectionPlan,
 * equipmentAvailability (all take AuthContext first and accept { tx } to run inside a caller's
 * transaction).
 */
export {
  createFormula,
  createFormulaRevision,
  saveFormulaRevisionDraft,
  submitFormulaRevision,
  withdrawFormulaRevision,
  decideFormulaRevision,
  retireFormulaRevision,
  discardFormulaDraft,
  getEffectiveFormulaRevision,
  loadFormulaRevisionForSnapshot,
  isEffectiveOn,
  listFormulas,
  getFormula,
  getFormulaRevision,
  formulaFormOptions,
  approvedFormulaRevisionOptions,
  canSeeFormulaPercentages,
  diffLines,
  type FormulaListRow,
  type FormulaRevisionView,
} from "./formulas";
export {
  createRouting,
  createRoutingRevision,
  saveRoutingRevisionDraft,
  submitRoutingRevision,
  withdrawRoutingRevision,
  decideRoutingRevision,
  retireRoutingRevision,
  getEffectiveRouting,
  loadRoutingSteps,
  computeChangeScope,
  listRoutings,
  getRouting,
  getRoutingRevision,
  routingFormOptions,
  type EffectiveRouting,
  type RoutingStepFull,
  type RoutingRevisionView,
} from "./routings";
export {
  createWorkInstruction,
  createWorkInstructionRevision,
  saveWorkInstructionDraft,
  submitWorkInstructionRevision,
  decideWorkInstructionRevision,
  listWorkInstructions,
  getWorkInstruction,
  approvedWorkInstructionOptions,
} from "./work-instructions";
export {
  createInspectionPlan,
  createInspectionPlanRevision,
  saveInspectionPlanDraft,
  submitInspectionPlan,
  decideInspectionPlan,
  getInspectionPlan,
  listInspectionPlans,
  getInspectionPlanDetail,
  inspectionPlanFormOptions,
} from "./inspection-plans";
export {
  EQUIPMENT_STATUSES,
  EQUIPMENT_TRANSITIONS,
  deriveAvailability,
  createEquipment,
  recordServiceRecord,
  reviewServiceRecord,
  changeEquipmentStatus,
  requestEquipmentOverride,
  decideEquipmentOverride,
  equipmentAvailability,
  listEquipment,
  getEquipment,
  type AvailabilityReason,
  type EquipmentAvailability,
  type EquipmentListRow,
} from "./equipment";
export { APPROVAL_POLICIES, ROUTING_SEQUENCING_ONLY_POLICY, type ApprovalRecordType, type ApprovalStepPolicy } from "./approval-policy";
export { VERSION_STATUSES, VERSION_TRANSITIONS, canVersionTransition, businessToday, effectiveLabel, type VersionStatus } from "./versioning";
export { STEP_KINDS, AREAS, EQUIPMENT_KINDS } from "./schemas";

// Wave 1 W1B: suppliers (US-2-06)
export { listSuppliers, supplierOptions, getSupplier, createSupplier, updateSupplier, exportSuppliersCsv, type SupplierFilter } from "./suppliers";
export { SUPPLIER_QUALITY_STATUSES, SUPPLIER_QUALITY_LABELS, SupplierInputSchema, parseOrThrow, type SupplierInput, type SupplierQualityStatus } from "./supplier-schemas";
export { toCsv, neutralizeCell } from "./csv";
