import { z } from "zod";
import { DomainError } from "@/lib/errors";

/**
 * Zod command schemas for production engineering master data (ADR-008). Services parse their
 * input with parseInput(), so server actions, future /api/v1 handlers and offline replay share one
 * validation. Quantities stay decimal strings end to end (ADR-010).
 */
const uuid = z.string().uuid("Choose a valid option.");
const dec = (label: string, dp = 6) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{1,12}(\\.\\d{1,${dp}})?$`), `Enter ${label} as a number with at most ${dp} decimals.`);
const optDec = (label: string, dp = 6) =>
  z
    .union([dec(label, dp), z.literal(""), z.null(), z.undefined()])
    .transform((v) => (v ? v : null));
const signedDec = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^-?\d{1,12}(\.\d{1,6})?$/, `Enter ${label} as a number.`);
const optSignedDec = (label: string) =>
  z
    .union([signedDec(label), z.literal(""), z.null(), z.undefined()])
    .transform((v) => (v ? v : null));
const optText = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (v ?? "").trim())
    .refine((v) => v.length <= max, `Use at most ${max} characters.`)
    .transform((v) => (v ? v : null));
const reqText = (label: string, max: number) => z.string().trim().min(1, `Enter ${label}.`).max(max, `Use at most ${max} characters.`);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date as YYYY-MM-DD.");
const optDate = z
  .union([isoDate, z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null));
export const codeSchema = (label: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9._-]{0,39}$/, `${label} uses capital letters, digits, dot, dash or underscore (max 40).`);

/** Turns a ZodError into a 422 DomainError with field errors (first message per field). */
export function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = i.path.length ? i.path.join(".") : "form";
    fieldErrors[k] ??= i.message;
  }
  const first = r.error.issues[0];
  throw new DomainError("validation", first ? `${first.path.length ? first.path.join(".") + ": " : ""}${first.message}` : "Check the highlighted fields.", { fieldErrors });
}

/* ------------------------------------------------------------------ formulas */

export const BomLineInput = z
  .object({
    materialId: uuid,
    quantityG: dec("the quantity in grams"),
    tolerancePct: optDec("the tolerance %"),
    toleranceAbsG: optDec("the tolerance in grams"),
    phaseCode: optText(40),
    scaling: z.enum(["proportional", "fixed"]).default("proportional"),
    isCritical: z.boolean().default(true),
    requiresChecker: z.boolean().default(true),
  })
  .strict()
  .superRefine((l, ctx) => {
    if ((l.tolerancePct === null) === (l.toleranceAbsG === null)) {
      ctx.addIssue({ code: "custom", path: ["tolerancePct"], message: "Enter exactly one tolerance per line: a percentage or an absolute amount in grams." });
    }
    if (Number(l.quantityG) <= 0) ctx.addIssue({ code: "custom", path: ["quantityG"], message: "Quantity must be greater than zero." });
  });
export type BomLineInput = z.input<typeof BomLineInput>;

export const CreateFormulaInput = z
  .object({
    productId: uuid,
    code: codeSchema("Formula code"),
    name: reqText("the formula name", 120),
    referenceBatchSizeG: dec("the reference batch size in grams"),
    theoreticalYieldPct: dec("the theoretical yield %"),
    changeSummary: optText(1000),
  })
  .strict();

export const SaveFormulaDraftInput = z
  .object({
    revisionId: uuid,
    referenceBatchSizeG: dec("the reference batch size in grams"),
    theoreticalYieldPct: dec("the theoretical yield %"),
    effectiveFrom: optDate,
    changeSummary: optText(1000),
    notes: optText(2000),
    lines: z.array(BomLineInput).max(200, "A formula can have at most 200 lines."),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Number(v.referenceBatchSizeG) <= 0) ctx.addIssue({ code: "custom", path: ["referenceBatchSizeG"], message: "Batch size must be greater than zero." });
    const y = Number(v.theoreticalYieldPct);
    if (!(y > 0 && y <= 100)) ctx.addIssue({ code: "custom", path: ["theoreticalYieldPct"], message: "Theoretical yield must be above 0 and at most 100 %." });
  });

export const DecisionInput = z
  .object({
    id: uuid,
    decision: z.enum(["approved", "rejected"]),
    note: optText(1000),
    effectiveFrom: optDate,
  })
  .strict();

export const RetireInput = z.object({ id: uuid, reason: reqText("the reason", 1000) }).strict();

/* ------------------------------------------------------------------ routings */

export const STEP_KINDS = ["line_clearance", "dispensing", "process", "in_process_qc", "filling", "cutting", "curing", "hold", "packaging", "reconciliation", "transfer", "checklist"] as const;
export const AREAS = ["weighing", "production", "packaging", "filling", "other"] as const;
export const EQUIPMENT_KINDS = ["scale", "mixer", "heater", "kettle", "homogenizer", "mould", "cutter", "filler", "labeller", "other"] as const;

export const ParameterInput = z
  .object({
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9_]{0,39}$/, "Parameter code: lower-case letters, digits and underscore."),
    name: reqText("the parameter name", 120),
    valueKind: z.enum(["numeric", "text", "boolean"]),
    uom: optText(20),
    minValue: optSignedDec("the minimum"),
    targetValue: optSignedDec("the target"),
    maxValue: optSignedDec("the maximum"),
    isRequired: z.boolean().default(true),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.valueKind === "numeric" && !p.uom) ctx.addIssue({ code: "custom", path: ["uom"], message: `Parameter ${p.code}: a numeric parameter needs a unit.` });
    if (p.valueKind !== "numeric" && (p.minValue || p.maxValue || p.targetValue)) {
      ctx.addIssue({ code: "custom", path: ["minValue"], message: `Parameter ${p.code}: limits apply to numeric parameters only.` });
    }
    const n = (v: string | null) => (v === null ? null : Number(v));
    const [mi, ta, ma] = [n(p.minValue), n(p.targetValue), n(p.maxValue)];
    if (mi !== null && ma !== null && mi > ma) ctx.addIssue({ code: "custom", path: ["minValue"], message: `Parameter ${p.code}: minimum is above maximum.` });
    if (ta !== null && ((mi !== null && ta < mi) || (ma !== null && ta > ma))) ctx.addIssue({ code: "custom", path: ["targetValue"], message: `Parameter ${p.code}: target is outside the limits.` });
  });

export const ChecklistItemInput = z
  .object({ text: reqText("the checklist item", 300), requiresPhoto: z.boolean().default(false), isBlocking: z.boolean().default(true) })
  .strict();

export const StepInput = z
  .object({
    code: optText(40),
    name: reqText("the step name", 120),
    stepKind: z.enum(STEP_KINDS),
    area: z
      .union([z.enum(AREAS), z.literal(""), z.null(), z.undefined()])
      .transform((v) => (v ? v : null)),
    instruction: optText(2000),
    workInstructionRevisionId: z
      .union([uuid, z.literal(""), z.null(), z.undefined()])
      .transform((v) => (v ? v : null)),
    requiresChecker: z.boolean().default(true),
    blocksUntilComplete: z.boolean().default(true),
    requiresEquipment: z.boolean().default(false),
    equipmentKind: z
      .union([z.enum(EQUIPMENT_KINDS), z.literal(""), z.null(), z.undefined()])
      .transform((v) => (v ? v : null)),
    minDurationMinutes: z.number().int().positive().max(100_000).nullable().default(null),
    parameters: z.array(ParameterInput).max(30).default([]),
    checklistItems: z.array(ChecklistItemInput).max(40).default([]),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.stepKind === "line_clearance" && !s.area) ctx.addIssue({ code: "custom", path: ["area"], message: `${s.name}: a line clearance needs its area (weighing, production, packaging…).` });
    if (s.requiresEquipment && !s.equipmentKind) ctx.addIssue({ code: "custom", path: ["equipmentKind"], message: `${s.name}: choose the equipment type the step needs.` });
    const codes = s.parameters.map((p) => p.code);
    if (new Set(codes).size !== codes.length) ctx.addIssue({ code: "custom", path: ["parameters"], message: `${s.name}: parameter codes must be unique within the step.` });
  });
export type StepInput = z.input<typeof StepInput>;

export const CreateRoutingInput = z
  .object({ productId: uuid, code: codeSchema("Routing code"), name: reqText("the routing name", 120), changeSummary: optText(1000) })
  .strict();

export const SaveRoutingDraftInput = z
  .object({
    revisionId: uuid,
    effectiveFrom: optDate,
    changeSummary: optText(1000),
    notes: optText(2000),
    steps: z.array(StepInput).max(60, "A routing can have at most 60 steps."),
  })
  .strict();

/* ------------------------------------------------------------------ work instructions */

export const CreateWorkInstructionInput = z
  .object({ code: codeSchema("Instruction code"), name: reqText("the instruction name", 120), bodyMarkdown: reqText("the instruction text", 20000) })
  .strict();
export const SaveWorkInstructionDraftInput = z
  .object({ revisionId: uuid, bodyMarkdown: reqText("the instruction text", 20000), changeSummary: optText(1000) })
  .strict();

/* ------------------------------------------------------------------ inspection plans */

export const PlanTestInput = z
  .object({
    testCode: codeSchema("Test code"),
    name: reqText("the test name", 120),
    method: optText(500),
    valueKind: z.enum(["numeric", "text", "pass_fail"]),
    uom: optText(20),
    specMin: optSignedDec("the minimum"),
    specMax: optSignedDec("the maximum"),
    specText: optText(500),
    isRequired: z.boolean().default(true),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (t.valueKind === "numeric") {
      if (!t.uom) ctx.addIssue({ code: "custom", path: ["uom"], message: `${t.testCode}: a numeric test needs a unit.` });
      if (!t.specMin && !t.specMax) ctx.addIssue({ code: "custom", path: ["specMin"], message: `${t.testCode}: a numeric test needs a minimum, a maximum or both.` });
      if (t.specMin && t.specMax && Number(t.specMin) > Number(t.specMax)) ctx.addIssue({ code: "custom", path: ["specMin"], message: `${t.testCode}: minimum is above maximum.` });
    } else {
      if (t.specMin || t.specMax) ctx.addIssue({ code: "custom", path: ["specMin"], message: `${t.testCode}: limits apply to numeric tests only.` });
      if (!t.specText) ctx.addIssue({ code: "custom", path: ["specText"], message: `${t.testCode}: describe the acceptance criterion.` });
    }
  });
export type PlanTestInput = z.input<typeof PlanTestInput>;

export const CreateInspectionPlanInput = z
  .object({
    code: codeSchema("Plan code"),
    name: reqText("the plan name", 120),
    planKind: z.enum(["incoming", "in_process", "finished_product"]),
    productId: z
      .union([uuid, z.literal(""), z.null(), z.undefined()])
      .transform((v) => (v ? v : null)),
    materialId: z
      .union([uuid, z.literal(""), z.null(), z.undefined()])
      .transform((v) => (v ? v : null)),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.planKind === "incoming" && (!p.materialId || p.productId)) ctx.addIssue({ code: "custom", path: ["materialId"], message: "An incoming inspection plan applies to one material." });
    if (p.planKind !== "incoming" && (!p.productId || p.materialId)) ctx.addIssue({ code: "custom", path: ["productId"], message: "In-process and finished-product plans apply to one product." });
  });

export const SaveInspectionPlanDraftInput = z
  .object({
    planId: uuid,
    name: reqText("the plan name", 120),
    samplingInstructions: optText(4000),
    effectiveFrom: optDate,
    changeSummary: optText(1000),
    isPlaceholder: z.boolean().default(false),
    tests: z.array(PlanTestInput).max(60),
  })
  .strict()
  .superRefine((p, ctx) => {
    const codes = p.tests.map((t) => t.testCode.toUpperCase());
    if (new Set(codes).size !== codes.length) ctx.addIssue({ code: "custom", path: ["tests"], message: "Test codes must be unique within a plan." });
  });

/* ------------------------------------------------------------------ equipment */

export const CreateEquipmentInput = z
  .object({
    siteId: uuid,
    code: codeSchema("Equipment code"),
    name: reqText("the equipment name", 120),
    equipmentKind: z.enum(EQUIPMENT_KINDS),
    lineLabel: optText(80),
    calibrationIntervalDays: z.number().int().positive().max(3650).nullable().default(null),
    calibrationDueDate: optDate,
    maintenanceIntervalDays: z.number().int().positive().max(3650).nullable().default(null),
    maintenanceDueDate: optDate,
    cleaningRule: z.enum(["per_batch", "per_changeover", "none"]).default("per_batch"),
    qualificationStatus: z.enum(["not_required", "qualified", "pending", "failed"]).default("not_required"),
    blockingRule: z.enum(["block", "warn", "none"]).default("block"),
    capacityMin: optDec("the minimum capacity"),
    capacityMax: optDec("the maximum capacity"),
    capacityUom: optText(20),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.capacityMin && e.capacityMax && Number(e.capacityMin) > Number(e.capacityMax)) ctx.addIssue({ code: "custom", path: ["capacityMin"], message: "Minimum capacity is above maximum." });
    if ((e.capacityMin || e.capacityMax) && !e.capacityUom) ctx.addIssue({ code: "custom", path: ["capacityUom"], message: "Enter the capacity unit." });
  });

export const ServiceRecordInput = z
  .object({
    equipmentId: uuid,
    serviceKind: z.enum(["cleaning", "calibration", "preventive_maintenance", "repair", "qualification", "inspection"]),
    result: z.enum(["pass", "fail", "completed"]),
    performedAt: z.coerce.date().optional(),
    performedByExternal: optText(120),
    nextDueDate: optDate,
    referenceNumber: optText(80),
    notes: optText(2000),
    idempotencyKey: optText(100),
  })
  .strict();

export const EquipmentStatusInput = z
  .object({ equipmentId: uuid, toStatus: z.enum(["in_service", "maintenance", "out_of_service"]), reason: reqText("the reason", 500) })
  .strict();

export const OverrideRequestInput = z
  .object({
    equipmentId: uuid,
    reason: reqText("the risk assessment and reason", 2000),
    workReference: optText(80),
    validHours: z.number().int().min(1, "At least 1 hour.").max(72, "At most 72 hours; request again if more time is needed.").default(8),
  })
  .strict();
