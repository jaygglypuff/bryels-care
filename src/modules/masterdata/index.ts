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
  registerEquipmentAvailabilityProvider,
  syncMaintenanceDueDate,
  type AvailabilityProvider,
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
export { APPROVAL_POLICIES, ROUTING_SEQUENCING_ONLY_POLICY, loadApprovalPolicy, type ApprovalRecordType, type ApprovalRuleType, type ApprovalStepPolicy } from "./approval-policy";
export { VERSION_STATUSES, VERSION_TRANSITIONS, canVersionTransition, businessToday, effectiveLabel, type VersionStatus } from "./versioning";
export { STEP_KINDS, AREAS, EQUIPMENT_KINDS } from "./schemas";

// Wave 1 W1B: suppliers (US-2-06)
export { listSuppliers, supplierOptions, getSupplier, createSupplier, updateSupplier, exportSuppliersCsv, type SupplierFilter } from "./suppliers";
export { SUPPLIER_QUALITY_STATUSES, SUPPLIER_QUALITY_LABELS, SupplierInputSchema, parseOrThrow, type SupplierInput, type SupplierQualityStatus } from "./supplier-schemas";
export { toCsv, neutralizeCell } from "./csv";

// Wave 2 W2G: master data administration (US-1-20..US-1-24)
export { SITE_CODE_RE, listSites, getSite, createSite, updateSite, setSiteActive, type SiteInput } from "./sites";
export { listDepartments, createDepartment, updateDepartment } from "./org-departments";
export {
  WAREHOUSE_KINDS,
  WAREHOUSE_KIND_LABELS,
  SPECIAL_ROLE_LABELS,
  SPECIAL_ROLE_KIND,
  listWarehouses,
  getWarehouse,
  createWarehouse,
  updateWarehouse,
  setWarehouseActive,
  designateSpecialLocation,
  missingSpecialLocations,
  specialLocationFor,
  locationsHoldStock,
  type SpecialRole,
} from "./warehouses";
export {
  LOCATION_KINDS,
  LOCATION_KIND_LABELS,
  LOCATION_STATUSES,
  LOCATION_TRANSITIONS,
  listLocations,
  getLocation,
  createLocation,
  updateLocation,
  changeLocationStatus,
  assertLocationsOpen,
  locationFormOptions,
  type LocationFilter,
  type LocationKind,
  type LocationStatus,
} from "./locations";
export { LINE_STATUSES, LINE_TRANSITIONS, listLines, getLine, createLine, updateLine, changeLineStatus, lineFormOptions } from "./lines";
export { assignEquipmentToLine, changeEquipmentBlockingRule } from "./lines-equipment";
export {
  UOM_CONVERSION_TRANSITIONS,
  listUoms,
  uomOptions,
  createUom,
  updateUom,
  listConversions,
  proposeConversion,
  decideConversion,
  findConversionStep,
  checkEnteredQuantity,
  toBaseQuantity,
  enterableUnits,
} from "./uom";
export { applyStep, enteredEqualsBase, toBasePair, DEFAULT_UOMS, METRIC_DEFAULT_CONVERSIONS, type ConversionStep, type Quantity } from "./uom-math";
export {
  listProducts,
  getProduct,
  productFamilies,
  createProduct,
  updateProduct,
  changeProductStatus,
  listSkus,
  getSku,
  createSku,
  updateSku,
  changeSkuStatus,
  productsExport,
  skusExport,
  type ProductFilter,
  type ProductInput,
  type SkuInput,
} from "./products";
export { expiryFor, expiryBaseDate, isValidGtin, PRODUCT_STATUSES, PRODUCT_TRANSITIONS, type ExpiryBasis, type ProductStatus } from "./products-shelf-life";
export {
  MATERIAL_CLASSES,
  MATERIAL_CLASS_LABELS,
  MATERIAL_STATUSES,
  MATERIAL_TRANSITIONS,
  materialWarnings,
  listMaterials as listMaterialMaster,
  getMaterial,
  createMaterial as createMaterialMaster,
  updateMaterial,
  changeMaterialStatus,
  materialsExport,
  type MaterialFilter,
  type MaterialInput,
  type MaterialClass,
  type MaterialStatus,
} from "./materials";
export { REASON_CATEGORY_LABELS, listReasonCodes, getReasonCode, reasonCodeOptions, reasonLabels, assertReasonCode, createReasonCode, updateReasonCode } from "./reason-codes";
export { DEFAULT_REASON_CODES, REASON_NOTE_MAX, reasonCodesFor } from "./reason-codes-defaults";
export { installReferenceData } from "./org-reference";
export { installSoapExample } from "./templates";
