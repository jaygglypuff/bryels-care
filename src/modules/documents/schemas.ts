import { z } from "zod";
import { DOCUMENT_TEMPLATE_KINDS, LABEL_APPLIES_TO, LABEL_SYMBOLOGIES } from "@/db/schema/documents";

/**
 * Zod schemas of the documents module (ADR-008). `document_template/v1` is the JSON definition of
 * docs/reports-and-templates.md §1.2: configuration of a code renderer, never HTML (A-RPT-01).
 * Unknown keys fail validation; text values that look like markup are rejected.
 */

const MARKUP = /<\s*[a-z!\/?]|javascript:|on[a-z]+\s*=|url\s*\(/i;
const plainText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !MARKUP.test(v), { message: "Plain text only: HTML, scripts and links are not allowed in templates." });
const ident = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/, "Use lower-case letters, digits and underscores.");
const mm = z.number().min(0).max(60);

export const sectionSchema = z
  .object({
    id: ident,
    enabled: z.boolean(),
    columns: z.array(ident).max(40).optional(),
    group_by: ident.optional(),
    break_before: z.enum(["page"]).optional(),
    handwritten_lines: z.boolean().optional(),
    show_instruction_text: z.boolean().optional(),
  })
  .strict();

export const templateDefinitionSchema = z
  .object({
    schema_version: z.literal("document_template/v1"),
    renderer: z.object({ id: ident, version: z.number().int().min(1).max(99) }).strict(),
    dataset: z.string().regex(/^[a-z_]+(\/[a-z0-9_]+)?\/v\d+$/, "Dataset ids look like label/material/v1."),
    page: z
      .object({
        size: z.enum(["A4", "Letter", "label"]),
        orientation: z.enum(["portrait", "landscape"]),
        margin_mm: z.object({ top: mm, right: mm, bottom: mm, left: mm }).strict(),
      })
      .strict(),
    header: z
      .object({ show_logo: z.boolean(), title: plainText(120), identity_fields: z.array(ident).max(10) })
      .strict()
      .optional(),
    footer: z
      .object({ show_qr: z.boolean(), uncontrolled_copy_text: plainText(200), show_hash: z.boolean() })
      .strict()
      .optional(),
    sections: z.array(sectionSchema).max(50),
    labels: z.record(z.string().regex(/^[a-z]{2}$/), z.record(ident, plainText(120))).optional(),
    options: z
      .object({
        display_decimals_by_uom: z.record(z.string().regex(/^[A-Za-z]{1,6}$/), z.number().int().min(0).max(6)).optional(),
        totals_from_unrounded: z.boolean().optional(),
        print_percentages: z.boolean().optional(),
        watermarks: z.enum(["default", "none"]).optional(),
        show_ruler: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    // A-PM-16 / A-RPT-22: production documents never print formula percentages.
    if (["bmr", "dispensing_sheet"].includes(d.renderer.id) && d.options?.print_percentages) {
      ctx.addIssue({ code: "custom", path: ["options", "print_percentages"], message: "Production documents never print formula percentages." });
    }
  });

export type TemplateDefinition = z.infer<typeof templateDefinitionSchema>;

/** label_fields/v1: which optional fields a label prints (docs/data-model.md §1.7, reports §8.3). */
export const LABEL_FIELD_KEYS = [
  "item_name",
  "inci_name",
  "supplier",
  "supplier_lot",
  "received",
  "manufactured",
  "expiry",
  "quantity",
  "storage",
  "batch",
  "status_word",
  "scan_to_verify",
  "location_name",
  "warehouse",
  "location_kind",
  "allowed_statuses",
  // W3E: box / carton labels (docs/reports-and-templates.md §8.3)
  "packed",
  "packer",
  "customer_marks",
  "box_of",
  // ADR-076: brand of a received material lot
  "brand",
] as const;
export type LabelFieldKey = (typeof LABEL_FIELD_KEYS)[number];

export const labelFieldsSchema = z
  .object({
    schema_version: z.literal("label_fields/v1"),
    show: z.array(z.enum(LABEL_FIELD_KEYS)).max(LABEL_FIELD_KEYS.length),
  })
  .strict();
export type LabelFields = z.infer<typeof labelFieldsSchema>;

/** Default field sets per applies_to (docs/reports-and-templates.md §8.3). */
export const DEFAULT_LABEL_FIELDS: Record<(typeof LABEL_APPLIES_TO)[number], LabelFieldKey[]> = {
  material: ["item_name", "inci_name", "supplier", "brand", "supplier_lot", "received", "expiry", "quantity", "storage", "status_word", "scan_to_verify"],
  wip: ["item_name", "batch", "manufactured", "expiry", "quantity", "storage", "status_word", "scan_to_verify"],
  finished_good: ["item_name", "batch", "manufactured", "expiry", "quantity", "storage", "status_word", "scan_to_verify"],
  product: ["item_name", "batch", "manufactured", "expiry", "storage"],
  carton: ["item_name", "batch", "expiry", "quantity", "packed", "packer", "customer_marks", "box_of", "status_word", "scan_to_verify"],
  pallet: ["item_name", "quantity"],
  location: ["location_name", "warehouse", "location_kind", "allowed_statuses"],
  equipment: ["item_name"],
  sample: ["item_name", "quantity"],
};

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/, "Use A-Z, 0-9, dot, underscore and hyphen (max 64), starting with a letter or digit.");

export const createTemplateInput = z.object({
  code: codeSchema,
  name: plainText(120).pipe(z.string().min(2, "Enter a name.")),
  templateKind: z.enum(DOCUMENT_TEMPLATE_KINDS),
  pageSize: z.enum(["A4", "Letter", "label"]).default("A4"),
  orientation: z.enum(["portrait", "landscape"]).default("portrait"),
});

export const labelTemplateInput = z
  .object({
    code: codeSchema,
    name: plainText(120).pipe(z.string().min(2, "Enter a name.")),
    documentTemplateId: z.string().uuid("Choose the layout template."),
    appliesTo: z.enum(LABEL_APPLIES_TO),
    symbology: z.enum(LABEL_SYMBOLOGIES),
    copiesDefault: z.coerce.number().int().min(1).max(99),
    mediaWidthMm: z.coerce.number().min(20).max(220),
    mediaHeightMm: z.coerce.number().min(15).max(300),
    dpi: z.coerce.number().int().refine((v) => [203, 300, 600].includes(v), "Choose 203, 300 or 600 dpi."),
    fields: z.array(z.enum(LABEL_FIELD_KEYS)),
    siteId: z.string().uuid().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.symbology === "ean13") ctx.addIssue({ code: "custom", path: ["symbology"], message: "EAN-13 is reserved for retail barcodes in a later phase (ADR-017)." });
    if (v.symbology === "code128" && v.mediaWidthMm < 80)
      ctx.addIssue({ code: "custom", path: ["symbology"], message: "Code 128 needs a label at least 80 mm wide (X-dimension 0.25 mm). Use QR on small labels." });
  });
export type LabelTemplateInput = z.infer<typeof labelTemplateInput>;

export const printStationInput = z.object({
  code: codeSchema,
  name: plainText(120).pipe(z.string().min(2, "Enter a name.")),
  printerName: plainText(120).pipe(z.string().min(1, "Enter the printer name as shown on the station.")),
  notes: plainText(500).optional().nullable(),
  isActive: z.boolean().default(true),
});

const uuid = z.string().uuid();
export const idempotencyKey = z.string().uuid("The form is missing its submission key. Reload the page and try again.");

export const createLabelJobInput = z
  .object({
    labelTemplateId: uuid,
    entityType: z.enum(["inventory_lot", "location", "container", "batch"]),
    entityId: uuid,
    // ADR-088 §3: a batch's product labels are one per piece (up to 999 in one job); other labels at most 99.
    copies: z.coerce.number().int().min(1, "At least 1 copy.").max(999, "At most 999 labels per job."),
    printStationId: uuid.optional().nullable(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .refine((v) => v.entityType === "batch" || v.copies <= 99, { message: "At most 99 copies per job.", path: ["copies"] });
export type CreateLabelJobInput = z.input<typeof createLabelJobInput>;

export const reprintInput = z.object({
  reasonCode: z.string().min(1, "Choose a reason for the reprint."),
  note: z.string().trim().max(500).optional().nullable(),
  copies: z.coerce.number().int().min(1).max(99).optional(),
  idempotencyKey: z.string().min(8).max(200),
});
export type ReprintInput = z.input<typeof reprintInput>;
