/**
 * W2D demo data: the BMR template (paper BMR layout, renderer `bmr` v1) and the hybrid paper page
 * template (renderer `bmr_paper_page` v1), both approved by the demo QA user after submission by
 * the demo site manager. Effective from well before the oldest seeded batch so every seeded batch
 * resolves "the version effective at batch creation". Fictional only; called from src/db/seed.ts.
 */
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../schema";
import { definitionChecksum } from "../../modules/documents/checksum";
import { defaultBmrDefinition } from "../../modules/documents/renderers/bmr-v1";
import { defaultBmrPaperPageDefinition } from "../../modules/documents/renderers/bmr-paper-page-v1";

type Db = PostgresJsDatabase<typeof s>;

export async function seedW2d(db: Db) {
  const [org] = await db.select().from(s.organizations).limit(1);
  if (!org) return;
  const O = org.id;
  const user = async (email: string) => (await db.select().from(s.users).where(and(eq(s.users.organizationId, O), eq(s.users.email, email))).limit(1))[0].id;
  const admin = await user("admin@bryels-care.test");
  const manager = await user("manager.nfd@bryels-care.test");
  const qa = await user("qa.nfd@bryels-care.test");
  const approvedAt = new Date(Date.now() - 400 * 86_400_000);

  const templates = [
    { code: "BMR-STD", name: "Batch Manufacturing Record (paper BMR layout)", definition: defaultBmrDefinition() },
    { code: "BMR-PAPER", name: "BMR hybrid paper page (blank, handwritten steps)", definition: defaultBmrPaperPageDefinition() },
  ];
  for (const t of templates) {
    const [row] = await db
      .insert(s.documentTemplates)
      .values({ organizationId: O, code: t.code, name: t.name, templateKind: "bmr", pageSize: "A4", orientation: "portrait", createdBy: admin, createdAt: approvedAt })
      .returning();
    await db.insert(s.documentTemplateVersions).values({
      documentTemplateId: row.id,
      versionNo: 1,
      status: "approved",
      definition: t.definition,
      definitionChecksum: definitionChecksum(t.definition),
      changeNote: "First version (demo): layout of the company's paper BMR. QA to confirm sections and wording before production use.",
      createdBy: admin,
      createdAt: approvedAt,
      submittedBy: manager,
      submittedAt: approvedAt,
      approvedBy: qa,
      approvedAt,
      effectiveFrom: approvedAt,
    });
  }
}
