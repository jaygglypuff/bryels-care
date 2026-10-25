import { z } from "zod";
import { DomainError } from "@/lib/errors";

/**
 * Zod command schemas of the maintenance module (ADR-008): services parse their input with parse(), so
 * server actions and future /api/v1 handlers share one validation. Quantities stay decimal strings (ADR-010).
 */
const uuid = z.string().uuid("Choose a valid option.");
const optUuid = z.union([uuid, z.literal(""), z.null(), z.undefined()]).transform((v) => (v ? v : null));
const optText = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (v ?? "").trim())
    .refine((v) => v.length <= max, `Use at most ${max} characters.`)
    .transform((v) => (v ? v : null));
const reqText = (label: string, max: number) => z.string().trim().min(1, `Enter ${label}.`).max(max, `Use at most ${max} characters.`);
const reason = z.string().trim().min(5, "Give a reason of at least 5 characters.").max(1000, "Use at most 1,000 characters.");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date as YYYY-MM-DD.");
const optDate = z.union([isoDate, z.literal(""), z.null(), z.undefined()]).transform((v) => (v ? v : null));
const dec = (label: string) => z.string().trim().regex(/^\d{1,12}(\.\d{1,6})?$/, `Enter ${label} as a number with at most 6 decimals.`);
const optInt = (label: string, min: number, max: number) =>
  z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= min && v <= max), `${label}: a whole number from ${min} to ${max}.`);
const optKey = z.union([z.string().max(200), z.null(), z.undefined()]).transform((v) => (v ? v : null));

export const CreatePlanInput = z
  .object({
    equipmentId: uuid,
    title: reqText("the plan title", 200),
    instructions: optText(4000),
    triggerKind: z.enum(["time", "usage"], { message: "Choose time or usage." }),
    intervalDays: optInt("Interval (days)", 1, 3650),
    firstDueOn: optDate,
    usageMetric: z.union([z.enum(["batches", "hours"]), z.literal(""), z.null(), z.undefined()]).transform((v) => (v ? v : null)),
    usageInterval: z.union([dec("the usage interval"), z.literal(""), z.null(), z.undefined()]).transform((v) => (v ? v : null)),
    leadDays: optInt("Lead days", 0, 365),
    takesEquipmentDown: z.boolean().default(true),
    responsibleUserId: optUuid,
  })
  .strict()
  .superRefine((v, c) => {
    if (v.triggerKind === "time" && !v.intervalDays) c.addIssue({ code: "custom", path: ["intervalDays"], message: "Enter the interval in days." });
    if (v.triggerKind === "usage") {
      if (!v.usageMetric) c.addIssue({ code: "custom", path: ["usageMetric"], message: "Choose batches or hours." });
      if (!v.usageInterval || Number(v.usageInterval) <= 0) c.addIssue({ code: "custom", path: ["usageInterval"], message: "Enter the usage interval (more than 0)." });
    }
  });

export const UpdatePlanInput = z
  .object({
    planId: uuid,
    title: reqText("the plan title", 200).optional(),
    instructions: optText(4000).optional(),
    intervalDays: optInt("Interval (days)", 1, 3650).optional(),
    nextDueOn: optDate.optional(),
    usageInterval: z.union([dec("the usage interval"), z.literal(""), z.null(), z.undefined()]).transform((v) => (v ? v : null)).optional(),
    leadDays: optInt("Lead days", 0, 365).optional(),
    takesEquipmentDown: z.boolean().optional(),
    responsibleUserId: optUuid.optional(),
  })
  .strict();

export const PlanStatusInput = z.object({ planId: uuid, toStatus: z.enum(["active", "paused", "retired"]), reason: z.union([reason, z.literal(""), z.null(), z.undefined()]).transform((v) => (v ? v : null)) }).strict();

export const CreateWorkOrderInput = z
  .object({
    equipmentId: uuid,
    kind: z.enum(["corrective", "inspection"], { message: "Choose corrective or inspection (preventive work orders come from a PM plan)." }),
    title: reqText("a title", 200),
    description: optText(4000),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    dueDate: optDate,
    assignedTo: optUuid,
    takesEquipmentDown: z.boolean().default(true),
    reportedDown: z.boolean().default(false),
    idempotencyKey: optKey,
  })
  .strict();

export const PlanWorkOrderInput = z.object({ planId: uuid, dueDate: optDate, assignedTo: optUuid, priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"), idempotencyKey: optKey }).strict();

export const WorkOrderTransitionInput = z
  .object({
    workOrderId: uuid,
    to: z.enum(["in_progress", "on_hold", "cancelled"]),
    reason: z.union([z.string().trim().max(1000), z.null(), z.undefined()]).transform((v) => (v ? v : null)),
  })
  .strict();

export const CompleteWorkOrderInput = z
  .object({
    workOrderId: uuid,
    workDone: reqText("the work done", 4000).refine((v) => v.length >= 5, "Describe the work done (at least 5 characters)."),
    result: z.enum(["completed", "pass", "fail"], { message: "Choose the result." }),
    referenceNumber: optText(80),
    performedByExternal: optText(120),
    idempotencyKey: optKey,
  })
  .strict();

export const AssignWorkOrderInput = z.object({ workOrderId: uuid, assignedTo: optUuid, dueDate: optDate.optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional() }).strict();

export const IssuePartInput = z
  .object({
    workOrderId: uuid,
    lotId: uuid,
    fromLocationId: uuid,
    qty: dec("the quantity"),
    idempotencyKey: z.string().min(1, "Missing request key; reload the page.").max(200),
  })
  .strict();

export const SparePartInput = z
  .object({
    siteId: uuid,
    materialId: uuid,
    equipmentId: optUuid,
    minQty: z.union([dec("the minimum stock"), z.literal(""), z.null(), z.undefined()]).transform((v) => (v ? v : null)),
    note: optText(500),
  })
  .strict();

export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = i.path.length ? i.path.join(".") : "form";
    fieldErrors[k] ??= i.message;
  }
  const first = r.error.issues[0];
  throw new DomainError("validation", first ? first.message : "Check the highlighted fields.", { fieldErrors });
}
