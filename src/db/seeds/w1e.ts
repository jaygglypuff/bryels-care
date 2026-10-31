/**
 * W1E demo data: document/label templates (approved by the demo QA user), label templates and a
 * print station at NFD. RVS deliberately has no print station so the "Label printing isn't set
 * up" state can be demonstrated. Fictional only; called from src/db/seed.ts.
 */
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../schema";
import { definitionChecksum } from "../../modules/documents/checksum";
import { labelRendererV2 } from "../../modules/documents/renderers/label-v2"; // ADR-099: demo layouts use v2
import { testPageRendererV1 } from "../../modules/documents/renderers/test-page-v1";
import { DEFAULT_LABEL_FIELDS } from "../../modules/documents/schemas";

type Db = PostgresJsDatabase<typeof s>;

export async function seedW1e(db: Db) {
  const [org] = await db.select().from(s.organizations).limit(1);
  if (!org) return;
  const O = org.id;
  const user = async (email: string) => (await db.select().from(s.users).where(and(eq(s.users.organizationId, O), eq(s.users.email, email))).limit(1))[0].id;
  const admin = await user("admin@bryels-care.test");
  const manager = await user("manager.nfd@bryels-care.test");
  const qa = await user("qa.nfd@bryels-care.test");
  const [nfd] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, "NFD"))).limit(1);
  const approvedAt = new Date(Date.now() - 14 * 86_400_000);

  async function layout(code: string, name: string, kind: "label" | "test_page", dataset?: string) {
    const definition = kind === "label" ? labelRendererV2.defaultDefinition("label", dataset) : testPageRendererV1.defaultDefinition("test_page");
    const [t] = await db
      .insert(s.documentTemplates)
      .values({ organizationId: O, code, name, templateKind: kind, pageSize: kind === "label" ? "label" : "A4", orientation: "portrait", createdBy: admin, createdAt: approvedAt })
      .returning();
    await db.insert(s.documentTemplateVersions).values({
      documentTemplateId: t.id,
      versionNo: 1,
      status: "approved",
      definition,
      definitionChecksum: definitionChecksum(definition),
      changeNote: "First version (demo)",
      createdBy: admin,
      createdAt: approvedAt,
      submittedBy: manager,
      submittedAt: approvedAt,
      approvedBy: qa,
      approvedAt,
      effectiveFrom: approvedAt,
    });
    return t.id;
  }

  const rm = await layout("LBL-RM", "Raw material container label layout", "label", "label/material/v1");
  const wip = await layout("LBL-WIP", "Intermediate (WIP) label layout", "label", "label/wip/v1");
  const fg = await layout("LBL-FG", "Finished goods lot label layout", "label", "label/finished_good/v1");
  const loc = await layout("LBL-LOC", "Storage location label layout", "label", "label/location/v1");
  // ADR-099: the product label stuck on each bar or jar (no status bar, no bulk quantity).
  const prod = await layout("LBL-PROD", "Product label layout (on each piece)", "label", "label/product/v1");
  await layout("TEST-A4", "A4 printer test page", "test_page");

  const lt = (code: string, name: string, documentTemplateId: string, appliesTo: keyof typeof DEFAULT_LABEL_FIELDS, w: string, h: string, symbology: "qr" | "code128" = "qr") => ({
    organizationId: O,
    code,
    name,
    documentTemplateId,
    appliesTo,
    symbology,
    copiesDefault: 1,
    fields: { schema_version: "label_fields/v1", show: DEFAULT_LABEL_FIELDS[appliesTo] },
    mediaWidthMm: w,
    mediaHeightMm: h,
    dpi: 203,
    status: "approved",
    createdBy: admin,
    updatedBy: admin,
    approvedBy: qa,
    approvedAt,
  });
  await db.insert(s.labelTemplates).values([
    lt("LT-RM-100X50", "Raw material 100 × 50 mm (drums, sacks)", rm, "material", "100", "50"),
    lt("LT-RM-50X30", "Raw material 50 × 30 mm (small containers)", rm, "material", "50", "30"),
    lt("LT-WIP-100X50", "Intermediate 100 × 50 mm", wip, "wip", "100", "50"),
    lt("LT-FG-100X50", "Finished goods lot label 100 × 50 mm (bulk stock)", fg, "finished_good", "100", "50"),
    lt("LT-PROD-70X40", "Product label 70 × 40 mm (one on each bar)", prod, "product", "70", "40"),
    lt("LT-LOC-100X50", "Rack / bin location 100 × 50 mm", loc, "location", "100", "50"),
    lt("LT-LOC-C128", "Location 100 × 50 mm, Code 128 (linear scanners)", loc, "location", "100", "50", "code128"),
  ]);

  await db.insert(s.printStations).values({
    organizationId: O,
    siteId: nfd.id,
    code: "WH1-DESK",
    name: "Warehouse 1 label desk (PC)",
    printerName: "Label printer, Warehouse 1",
    notes: "Fictional demo station. Set media 100 × 50 mm and 'Actual size' in the print dialog.",
    createdBy: admin,
  });
}
