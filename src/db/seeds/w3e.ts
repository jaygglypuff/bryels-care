/**
 * Wave 3 W3E demo seed: approved templates for the fulfilment documents (boxing note / packing list,
 * pick list, delivery receipt) and the box (carton) label layout + 100 × 50 mm label template, approved
 * by the demo QA user. No stock is boxed here so the seeded MVP lots keep their loose-stock demo flow;
 * boxes appear when a pack is started in the demo. Fictional data only; called from src/db/seed.ts.
 */
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../schema";
import { definitionChecksum } from "../../modules/documents/checksum";
import { boxingNoteRendererV1 } from "../../modules/documents/renderers/boxing-note-v1";
import { deliveryReceiptRendererV1 } from "../../modules/documents/renderers/delivery-receipt-v1";
import { labelRendererV1 } from "../../modules/documents/renderers/label-v1";
import { pickListRendererV1 } from "../../modules/documents/renderers/pick-list-v1";
import { DEFAULT_LABEL_FIELDS } from "../../modules/documents/schemas";
import type { Renderer } from "../../modules/documents/renderers/types";

type Db = PostgresJsDatabase<typeof s>;

export async function seedW3e(db: Db) {
  const [org] = await db.select().from(s.organizations).limit(1);
  if (!org) return;
  const O = org.id;
  const user = async (email: string) => (await db.select().from(s.users).where(and(eq(s.users.organizationId, O), eq(s.users.email, email))).limit(1))[0]?.id;
  const admin = (await user("admin@bryels-care.test"))!;
  const manager = (await user("manager.nfd@bryels-care.test"))!;
  const qa = (await user("qa.nfd@bryels-care.test"))!;
  const approvedAt = new Date(Date.now() - 7 * 86_400_000);

  const template = async (code: string, name: string, kind: string, renderer: Renderer, dataset?: string) => {
    const definition = renderer.defaultDefinition(kind, dataset);
    const [t] = await db
      .insert(s.documentTemplates)
      .values({ organizationId: O, code, name, templateKind: kind, pageSize: definition.page.size, orientation: definition.page.orientation, createdBy: admin, createdAt: approvedAt })
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
  };

  await template("BOXING-NOTE", "Boxing note / packing list (A4)", "boxing_note", boxingNoteRendererV1);
  await template("PICK-LIST", "Pick list (A4)", "pick_list", pickListRendererV1);
  await template("DR-STD", "Delivery receipt (A4, 3 copies)", "delivery_receipt", deliveryReceiptRendererV1);
  const boxLayout = await template("LBL-BOX", "Box / carton label layout", "label", labelRendererV1, "label/carton/v1");
  await db.insert(s.labelTemplates).values({
    organizationId: O,
    code: "LT-BOX-100X50",
    name: "Box / carton 100 × 50 mm",
    documentTemplateId: boxLayout,
    appliesTo: "carton",
    symbology: "qr",
    copiesDefault: 1,
    fields: { schema_version: "label_fields/v1", show: DEFAULT_LABEL_FIELDS.carton },
    mediaWidthMm: "100",
    mediaHeightMm: "50",
    dpi: 203,
    status: "approved",
    createdBy: admin,
    updatedBy: admin,
    approvedBy: qa,
    approvedAt,
  });
}
