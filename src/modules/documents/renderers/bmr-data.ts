import { z } from "zod";

/**
 * Dataset contract of the BMR renderer (`bmr/v1`, docs/reports-and-templates.md §1.3, §2.1, §2.2).
 *
 * Built by the production module (`buildBmrDataset`) under the caller's AuthContext and frozen
 * into generated_documents.dataset. Every value is pre-formatted text, so the renderer is a pure
 * function with no database access, no clock and no locale (batch snapshot rule: the renderer
 * reads only the batch snapshot and the batch's own records; A-RPT-22: quantities, never formula
 * percentages or costs).
 *
 * Sections fed by tables of other Wave 2 streams carry `available`: false means "not captured
 * electronically in this version" (printed as such), which is different from "none recorded".
 */

const text = z.string().max(4000);
const opt = text.nullable();
const sig = z.object({ name: text, at: opt }).nullable();

const dispenseRow = z.object({
  lotNumber: text,
  supplierLot: opt,
  expiryText: text,
  actualText: text,
  withinTolerance: z.boolean(),
  scale: opt,
  operator: text,
  at: text,
  checker: opt,
  exceptionReason: opt,
  /** Voided or superseded weighing: printed struck through with the reason (append-only). */
  struck: z.boolean(),
  struckReason: opt,
});

const materialLine = z.object({
  lineNo: z.number().int(),
  name: text,
  inci: opt,
  code: text,
  toleranceText: text,
  theoreticalText: text,
  actualText: text,
  status: text,
  records: z.array(dispenseRow).max(50),
});

const section = <T extends z.ZodTypeAny>(row: T) => z.object({ available: z.boolean(), rows: z.array(row).max(2000) });

export const bmrDataSchema = z.object({
  schema: z.literal("bmr/v1"),
  batch: z.object({
    id: z.string().uuid(),
    number: text,
    statusCode: text,
    statusLabel: text,
    productName: text,
    productCode: text,
    department: text,
    formulaLabel: text,
    routingLabel: opt,
    inspectionPlanLabel: opt,
    batchSizeText: text,
    plannedStartText: opt,
    startText: opt,
    endText: opt,
    siteCode: text,
    createdBy: text,
    snapshotTakenText: text,
    reopenCount: z.number().int().min(0),
    closedText: opt,
  }),
  summary: z.object({
    stepsDone: z.number().int(),
    stepsTotal: z.number().int(),
    openDeviations: z.number().int().nullable(),
    holds: z.array(text).max(50),
  }),
  materials: z.object({
    groups: z.array(z.object({ phase: opt, lines: z.array(materialLine).max(200), totalTheoreticalText: text, totalActualText: text })).max(20),
    totalTheoreticalText: text,
    totalActualText: text,
    roundingNote: opt,
    toleranceNote: text,
  }),
  steps: z
    .array(
      z.object({
        stepNo: z.number().int(),
        name: text,
        kindLabel: text,
        mode: text,
        instruction: opt,
        workInstruction: opt,
        readings: opt,
        conducted: sig,
        checked: sig,
      }),
    )
    .max(200),
  lineClearance: section(z.object({ stepNo: z.number().int(), stepName: text, itemNo: z.number().int(), text, answer: text, note: opt, by: opt, at: opt })),
  parameters: section(
    z.object({ stepNo: z.number().int(), parameter: text, uom: opt, limits: text, value: text, within: z.boolean().nullable(), by: opt, at: opt, struck: z.boolean(), struckReason: opt }),
  ),
  equipment: section(z.object({ stepNo: z.number().int().nullable(), code: text, name: text, calibrationDue: opt, cleaning: opt, operator: opt, at: opt, exception: opt })),
  packaging: section(z.object({ label: text, value: text })),
  outputYield: z.object({
    theoreticalText: text,
    actualText: opt,
    detailText: opt,
    expiryText: opt,
    outputLot: opt,
    yieldRecord: section(z.object({ label: text, value: text })),
    outputs: section(z.object({ kind: text, item: text, lot: opt, qty: text, location: opt })),
  }),
  qc: z.object({
    tests: z.array(z.object({ name: text, spec: text, result: text, passed: z.boolean(), testedBy: opt, at: opt })).max(200),
    testDateText: opt,
    conductedBy: opt,
    checkedBy: opt,
    inspections: section(z.object({ number: text, plan: opt, status: text, sampledBy: opt, reviewedBy: opt, at: opt })),
  }),
  deviations: section(z.object({ number: text, kind: text, severity: text, status: text, description: text, raisedBy: opt, raisedAt: opt, closedBy: opt, closedAt: opt })),
  exceptions: z.array(text).max(200),
  disposition: z
    .object({
      decision: z.enum(["release", "reject", "other"]),
      label: text,
      decidedBy: text,
      decidedAt: text,
      reason: opt,
      /** ADR-080 §8: the releaser worked on the batch; owner override with this typed reason. */
      overrideReason: opt.optional(),
      /** ADR-080 §8: the releaser also entered the test results (quality.release.tester_may_release). */
      testerReleased: z.boolean().optional(),
      /** ADR-080 §8: the "batch record reviewed" tick on Check quality. */
      recordReviewed: z.boolean().optional(),
    })
    .nullable(),
  remarks: opt,
  amendments: z
    .array(z.object({ no: z.number().int(), reopenNo: z.number().int().nullable(), section: text, reference: text, previous: text, corrected: text, reason: text, by: text, at: text, superseded: z.boolean() }))
    .max(500),
  reopens: z.array(z.object({ reopenNo: z.number().int(), reason: text, scope: text, requestedBy: text, approvals: text, at: text, target: text })).max(50),
  attachments: z
    .array(z.object({ reference: text, stepLabel: text, status: text, fileName: opt, sha8: opt, transcribedBy: opt, reviewedBy: opt, reviewedAt: opt }))
    .max(500),
  audit: z.array(z.object({ at: text, actor: text, event: text, detail: opt })).max(2000),
  documents: z.array(z.object({ number: text, label: text, status: text, by: text, at: text })).max(500),
  controlledRecord: z.enum(["paper", "electronic"]),
  notice: text,
});

export type BmrData = z.infer<typeof bmrDataSchema>;

/** Blank hybrid paper page (`bmr_paper_page/v1`, docs/reports-and-templates.md §2.5). */
export const bmrPaperPageDataSchema = z.object({
  schema: z.literal("bmr_paper_page/v1"),
  batch: z.object({ id: z.string().uuid(), number: text, productName: text, productCode: text, formulaLabel: text, routingLabel: opt, siteCode: text, batchSizeText: text }),
  page: z.object({
    reference: text,
    pageNo: z.number().int(),
    stepNo: z.number().int(),
    stepName: text,
    kindLabel: text,
    mode: text,
    instruction: opt,
    workInstruction: opt,
    parameters: z.array(z.object({ name: text, uom: opt, limits: text })).max(50),
    checklist: z.array(z.object({ itemNo: z.number().int(), text })).max(50),
    issuedBy: text,
    issuedAt: text,
  }),
  notice: text,
});
export type BmrPaperPageData = z.infer<typeof bmrPaperPageDataSchema>;

/** Section ids of the BMR template definition (docs/reports-and-templates.md §2.2 A–M). */
export const BMR_SECTIONS = {
  header_block: "A Header",
  batch_summary: "B Batch summary and state",
  materials: "C Dispensing and weighing",
  process_steps: "D Procedure (process steps)",
  checklist: "E Checklist and sign-off",
  line_clearance: "D Line clearance checklist answers",
  process_parameters: "D Process parameters",
  equipment: "D Equipment used",
  packaging_reconciliation: "F Packaging and label reconciliation",
  output_yield: "G Output and yield",
  qc: "H QC results",
  deviations: "I Deviations and controlled exceptions",
  disposition_signatures: "J Disposition and signatures",
  remarks: "K Remarks and amendments",
  attachments: "L Attachments (paper pages)",
  audit_appendix: "M Audit trail appendix",
} as const;
export type BmrSectionId = keyof typeof BMR_SECTIONS;

/** Sections that can never be disabled in a `bmr` template (US-3-17 AC1: C, E, H, J). */
export const BMR_REQUIRED_SECTIONS: readonly BmrSectionId[] = ["materials", "checklist", "qc", "disposition_signatures"];
