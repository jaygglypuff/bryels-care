import { z } from "zod";

/** Today's date in Manila as YYYY-MM-DD (business dates are site-local, Asia/Manila). */
export function manilaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters.`)
    .optional()
    .transform((v) => (v ? v : null));

const optionalInt = (min: number, max: number, msg: string) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v, c) => {
      if (v === undefined || v === null || String(v).trim() === "") return null;
      const n = Number(String(v).trim());
      if (!Number.isInteger(n) || n < min || n > max) {
        c.addIssue({ code: "custom", message: msg });
        return z.NEVER;
      }
      return n;
    });

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
const PRICE = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, "Price in pesos, up to 2 decimals.");
const QTY = z
  .string()
  .trim()
  .regex(/^\d+$/, "Whole pieces only.")
  .refine((v) => Number(v) > 0, "Must be at least 1 pc.")
  .refine((v) => v.length <= 7, "Too large.");

export const OrderLineSchema = z.object({
  productId: z.string().uuid("Choose a product."),
  qtyUnits: QTY,
  /** Empty = the approved price list price. */
  unitPrice: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(PRICE.nullable()),
});

export const NewOrderSchema = z.object({
  customerId: z.string().uuid("Choose a customer."),
  customerPoNumber: optionalText(60),
  requestedDeliveryOn: DATE.refine((v) => v >= manilaToday(), "The requested delivery date cannot be in the past."),
  notes: optionalText(1000),
  shipToAddressId: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.string().uuid("Choose an address.").nullable()),
  billToAddressId: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.string().uuid("Choose an address.").nullable()),
  lines: z.array(OrderLineSchema).min(1, "Add at least one line.").max(50, "At most 50 lines."),
});

export const DispatchSchema = z.object({
  carrier: z.string().trim().min(1, "Enter the carrier (e.g. Own truck).").max(80),
  driverName: z.string().trim().min(1, "Enter the driver's name.").max(80),
  vehiclePlate: z.string().trim().min(2, "Enter the vehicle plate.").max(20),
  packageCount: z.coerce.number().int("Whole number.").min(1, "At least 1 package.").max(10000),
});

export const DeliverySchema = z.object({
  receivedByName: z.string().trim().min(2, "Enter who received the goods.").max(80),
  deliveredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter the date and time."),
});

const emailField = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.string().email("Enter a valid email.").nullable());

/** MVP single-line customer form (kept for the legacy action). */
export const CustomerSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, "2–20 letters, digits or dashes."),
  name: z.string().trim().min(2, "Enter the customer name.").max(120),
  contactName: optionalText(80),
  phone: optionalText(40),
  email: emailField,
  shipToAddress: z.string().trim().min(5, "Enter the ship-to address.").max(300),
  minShelfLifeDays: z.coerce.number().int("Whole days.").min(0, "Cannot be negative.").max(3650, "At most 3650 days."),
});

export const AddressSchema = z.object({
  label: z.string().trim().min(2, "Name the address (e.g. Main warehouse).").max(60),
  line1: z.string().trim().min(3, "Enter the street address.").max(200),
  line2: optionalText(200),
  city: z.string().trim().min(2, "Enter the city or municipality.").max(80),
  province: optionalText(80),
  postalCode: optionalText(12),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => v || "PH")
    .pipe(z.string().regex(/^[A-Z]{2}$/, "Two-letter country code.")),
  contactName: optionalText(80),
  phone: optionalText(40),
});

/** Customer type: a code of the editable list `customer_segment` (Master data → Lists, ADR-076); the service checks it. */

/** Structured customer form (US-4-01). */
export const CustomerCreateSchema = z.object({
  /** ADR-075: blank = the next CUS-nnnn is assigned. */
  code: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), CustomerSchema.shape.code.nullable().optional()),
  name: CustomerSchema.shape.name,
  status: z.enum(["prospect", "active"]).default("active"),
  segment: z
    .string()
    .optional()
    .transform((v) => (v ? v.trim() || null : null))
    .pipe(z.string().max(40, "Choose a customer type from the list.").nullable()),
  contactName: optionalText(80),
  phone: optionalText(40),
  email: emailField,
  minShelfLifeDays: CustomerSchema.shape.minShelfLifeDays,
  defaultLeadTimeDays: optionalInt(0, 365, "Lead time: 0 to 365 days."),
  notesInternal: optionalText(1000),
  /** ADR-088: "days to pay" on the new-customer form; the service accepts it only with finance.credit_terms.approve. */
  paymentTermsDays: optionalInt(0, 365, "Days to pay: 0 to 365."),
  shipTo: AddressSchema,
});

export const CustomerProfileSchema = z.object({
  name: CustomerSchema.shape.name,
  segment: CustomerCreateSchema.shape.segment,
  minShelfLifeDays: CustomerSchema.shape.minShelfLifeDays,
  defaultLeadTimeDays: optionalInt(0, 365, "Lead time: 0 to 365 days."),
  notesInternal: optionalText(1000),
});

export const ContactSchema = z.object({
  name: z.string().trim().min(2, "Enter the contact's name.").max(80),
  email: emailField,
  phone: optionalText(40),
  roleLabel: optionalText(60),
  isPrimary: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true"),
});

export const CreditTermsSchema = z.object({
  creditLimitAmount: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.replace(/,/g, "") : null))
    .pipe(z.string().regex(/^\d{1,14}(\.\d{1,2})?$/, "Pesos, up to 2 decimals.").nullable()),
  paymentTermsDays: optionalInt(0, 365, "0 to 365 days."),
  taxIdentifier: optionalText(40),
  reason: z.string().trim().min(3, "Give a reason for the change.").max(300),
});

export const RequirementSchema = z.object({
  customerId: z.string().uuid(),
  productId: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.string().uuid("Choose a product.").nullable()),
  requirementKind: z.enum([
    "label_artwork",
    "carton_count",
    "coa_required",
    "moq",
    "lead_time",
    "packaging",
    "document",
    "lot_age_max_days",
    "min_remaining_shelf_life_days",
    "full_shipment_required",
    "shipping_marks",
    "other",
  ]),
  valueNumeric: optionalText(12),
  valueText: optionalText(500),
  artworkVersionId: z
    .string()
    .optional()
    .transform((v) => (v ? v : null)),
  effectiveFrom: DATE,
  changeSummary: optionalText(300),
});

export const ArtworkSchema = z.object({
  customerId: z
    .string()
    .optional()
    .transform((v) => (v ? v : null)),
  productId: z.string().uuid("Choose a product."),
  /** ADR-088: optional; blank = ART-<product code>, decided by the service. */
  artworkCode: optionalText(40),
  /** Optional; blank = the next vN of the design. */
  versionLabel: optionalText(20),
  description: optionalText(300),
});

export const PriceLineSchema = z.object({
  productId: z.string().uuid("Choose a product."),
  minQtyUnits: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || "0")
    .pipe(z.string().regex(/^\d{1,9}$/, "Whole pieces.")),
  unitAmount: PRICE,
});

export const PriceListSchema = z.object({
  /** ADR-088: optional; blank = the party's existing list code, else PL-<customer number> (decided by the service). */
  code: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{1,29}$/, "2–30 letters, digits or dashes.")
      .nullable()
      .optional(),
  ),
  /** Optional; blank = "Prices for <customer>" / "General prices". */
  name: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().min(3, "Enter a name.").max(120).nullable().optional()),
  partyKind: z.enum(["customer", "general"]),
  customerId: z
    .string()
    .optional()
    .transform((v) => (v ? v : null)),
  effectiveFrom: DATE,
  changeSummary: optionalText(300),
  lines: z.array(PriceLineSchema).min(1, "Add at least one product price.").max(500),
});

export const QuoteSchema = z.object({
  customerId: z.string().uuid("Choose a customer."),
  validUntil: DATE.refine((v) => v >= manilaToday(), "Valid until must be today or later."),
  shipToAddressId: NewOrderSchema.shape.shipToAddressId,
  notesCustomer: optionalText(1000),
  notesInternal: optionalText(1000),
  lines: z.array(OrderLineSchema).min(1, "Add at least one line.").max(50, "At most 50 lines."),
});

/** Maps zod issues to field keys like "lines.0.qtyUnits". */
export function issuesToFieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = i.path.map(String).join(".") || "form";
    if (!out[k]) out[k] = i.message;
  }
  return out;
}
