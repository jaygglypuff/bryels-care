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

export const OrderLineSchema = z.object({
  productId: z.string().uuid("Choose a product."),
  qtyUnits: z
    .string()
    .trim()
    .regex(/^\d+$/, "Whole pieces only.")
    .refine((v) => Number(v) > 0, "Must be at least 1 pc.")
    .refine((v) => v.length <= 7, "Too large."),
  unitPrice: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, "Price in pesos, up to 2 decimals."),
});

export const NewOrderSchema = z.object({
  customerId: z.string().uuid("Choose a customer."),
  customerPoNumber: optionalText(60),
  requestedDeliveryOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.")
    .refine((v) => v >= manilaToday(), "The requested delivery date cannot be in the past."),
  notes: optionalText(1000),
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

export const CustomerSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, "2–20 letters, digits or dashes."),
  name: z.string().trim().min(2, "Enter the customer name.").max(120),
  contactName: optionalText(80),
  phone: optionalText(40),
  email: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.string().email("Enter a valid email.").nullable()),
  shipToAddress: z.string().trim().min(5, "Enter the ship-to address.").max(300),
  minShelfLifeDays: z.coerce.number().int("Whole days.").min(0, "Cannot be negative.").max(3650, "At most 3650 days."),
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
