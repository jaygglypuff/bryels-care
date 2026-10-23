import { z } from "zod";
import { DomainError } from "@/lib/errors";

export const SUPPLIER_QUALITY_STATUSES = ["new", "approved", "conditional", "suspended"] as const;
export type SupplierQualityStatus = (typeof SUPPLIER_QUALITY_STATUSES)[number];
export const SUPPLIER_QUALITY_LABELS: Record<SupplierQualityStatus, string> = {
  new: "New (not yet evaluated)",
  approved: "Approved",
  conditional: "Conditional",
  suspended: "Suspended (receipts blocked)",
};

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `Use at most ${max} characters.` })
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const optInt = (max: number, label: string) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v, c) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > max) {
        c.addIssue({ code: "custom", message: `${label} must be a whole number from 0 to ${max}.` });
        return z.NEVER;
      }
      return n;
    });

/** Supplier master fields (US-2-06). Codes are upper-case letters, digits, dot, dash or underscore. */
export const SupplierInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9._-]{1,31}$/, { message: "Use 2 to 32 letters, digits, dots, dashes or underscores, e.g. SUP-0004." }),
    name: z.string().trim().min(2, { message: "Enter the supplier name." }).max(200),
    contactName: optText(120),
    email: z
      .union([z.literal(""), z.email({ message: "Enter a valid email address." })])
      .optional()
      .nullable()
      .transform((v) => (v ? v.toLowerCase() : null)),
    phone: optText(40),
    addressLine1: optText(300),
    city: optText(120),
    country: optText(80),
    paymentTermsDays: optInt(365, "Payment terms"),
    defaultLeadTimeDays: optInt(365, "Lead time"),
    qualityStatus: z.enum(SUPPLIER_QUALITY_STATUSES, { message: "Choose a quality status." }),
    qualityStatusReason: optText(500),
    isActive: z.boolean().default(true),
    notes: optText(1000),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.qualityStatus === "suspended" && (!v.qualityStatusReason || v.qualityStatusReason.length < 5)) {
      c.addIssue({ code: "custom", path: ["qualityStatusReason"], message: "Give the reason for suspending this supplier (at least 5 characters)." });
    }
  });
export type SupplierInput = z.input<typeof SupplierInputSchema>;

/** Parses with a Zod schema and turns the first issue into a 422 DomainError naming the field. */
export function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const field = issue.path.map(String).join(".") || "form";
  throw new DomainError("validation", issue.message, { field, issues: r.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });
}
