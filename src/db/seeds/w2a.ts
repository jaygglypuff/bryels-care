/**
 * Wave 2 W2A demo seed: production lines, the dispensing sheet and traveler templates (approved by
 * the demo QA user), minimum finished-goods stock for planning, and two demo work orders (one
 * draft, one planned and waiting for release). Fictional data only; called from src/db/seed.ts.
 *
 * No reservations are seeded: releasing the planned work order in the demo reserves stock live
 * through the FEFO rules, and the seeded batches of the MVP stay without a work order.
 */
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { uuidv7 } from "uuidv7";
import * as s from "../schema";
import { definitionChecksum } from "../../modules/documents/checksum";
import { dispensingSheetRendererV1 } from "../../modules/documents/renderers/dispensing-sheet-v1";
import { travelerRendererV1 } from "../../modules/documents/renderers/traveler-v1";

type Db = PostgresJsDatabase<typeof s>;

const manilaDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const yy = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }).slice(2, 4);

export async function seedW2a(db: Db) {
  const [org] = await db.select().from(s.organizations).limit(1);
  if (!org) return;
  const O = org.id;
  const user = async (email: string) => (await db.select().from(s.users).where(and(eq(s.users.organizationId, O), eq(s.users.email, email))).limit(1))[0]?.id;
  const admin = (await user("admin@bryels-care.test"))!;
  const manager = (await user("manager.nfd@bryels-care.test"))!;
  const qa = (await user("qa.nfd@bryels-care.test"))!;
  const planner = (await user("planner.nfd@bryels-care.test")) ?? manager;
  const [nfd] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, "NFD"))).limit(1);
  const approvedAt = new Date(Date.now() - 10 * 86_400_000);

  // Production lines (W05-02 "line"; data-model §3.1 production_lines).
  const [soap1] = await db
    .insert(s.productionLines)
    .values([
      { organizationId: O, siteId: nfd.id, code: "SOAP-1", name: "Soap line 1 (cold process)", departmentLabel: "Soap production" },
      { organizationId: O, siteId: nfd.id, code: "SOAP-2", name: "Soap line 2 (moulding and cutting)", departmentLabel: "Soap production" },
    ])
    .returning();

  // Approved templates for the production sheets (US-3-08).
  for (const [code, name, kind, renderer] of [
    ["DISP-SHEET", "Dispensing sheet (A4 landscape)", "dispensing_sheet", dispensingSheetRendererV1],
    ["TRAVELER", "Batch traveler (A4)", "traveler", travelerRendererV1],
  ] as const) {
    const definition = renderer.defaultDefinition(kind);
    const [t] = await db
      .insert(s.documentTemplates)
      .values({ organizationId: O, code, name, templateKind: kind, pageSize: "A4", orientation: definition.page.orientation, createdBy: admin, createdAt: approvedAt })
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
  }

  // Minimum finished-goods stock per SKU at NFD (planning input; owner-maintained, A-W2A-06).
  const prods = await db.select().from(s.products).where(eq(s.products.organizationId, O));
  const P = (sku: string) => prods.find((p) => p.skuCode === sku);
  const mins: [string, string][] = [
    ["ACS-135", "240"],
    ["GBS-135", "240"],
  ];
  for (const [sku, units] of mins) {
    const p = P(sku);
    if (p) await db.insert(s.productMinStock).values({ organizationId: O, siteId: nfd.id, productId: p.id, minStockUnits: units, updatedBy: manager });
  }

  // Two demo work orders: a draft for next week and a planned one waiting for release by the site manager.
  const forms = await db.select().from(s.formulas).where(eq(s.formulas.organizationId, O));
  const revs = await db.select().from(s.formulaRevisions).where(eq(s.formulaRevisions.status, "approved"));
  const routingRevs = await db
    .select({ rev: s.routingRevisions, productId: s.routings.productId })
    .from(s.routingRevisions)
    .innerJoin(s.routings, eq(s.routings.id, s.routingRevisions.routingId))
    .where(eq(s.routingRevisions.status, "approved"));
  let seq = 0;
  const insertWo = async (sku: string, status: "draft" | "planned", startOffset: number, batchCount: number) => {
    const p = P(sku);
    const f = forms.find((x) => x.productId === p?.id);
    if (!p || !f) return;
    const rev = revs.filter((r) => r.formulaId === f.id).sort((a, z) => z.revisionNo - a.revisionNo)[0];
    const rr = routingRevs.filter((r) => r.productId === p.id).sort((a, z) => z.rev.revisionNo - a.rev.revisionNo)[0];
    if (!rev || (status === "planned" && !rr)) return;
    seq += 1;
    const number = `WO-${yy()}-${String(seq).padStart(5, "0")}`;
    const id = uuidv7();
    const size = rev.referenceBatchSizeG;
    await db.insert(s.workOrders).values({
      id,
      organizationId: O,
      siteId: nfd.id,
      workOrderNumber: number,
      status,
      productId: p.id,
      formulaId: f.id,
      formulaRevisionId: status === "planned" ? rev.id : null,
      routingRevisionId: status === "planned" ? rr!.rev.id : null,
      productionLineId: soap1.id,
      qtyPlannedBase: (Number(size) * batchCount).toFixed(6),
      batchCount,
      batchSizeBase: size,
      plannedStart: manilaDay(startOffset),
      plannedEnd: manilaDay(startOffset + 1),
      assignedPlannerId: planner,
      assignedSupervisorId: manager,
      notes: "Demo work order (fictional).",
      submittedBy: status === "planned" ? planner : null,
      submittedAt: status === "planned" ? new Date() : null,
      statusChangedBy: planner,
      createdBy: planner,
      updatedBy: planner,
    });
    await db.insert(s.workOrderStateTransitions).values({ organizationId: O, siteId: nfd.id, workOrderId: id, fromState: null, toState: "draft", actorId: planner, correlationId: uuidv7() });
    if (status === "planned") await db.insert(s.workOrderStateTransitions).values({ organizationId: O, siteId: nfd.id, workOrderId: id, fromState: "draft", toState: "planned", actorId: planner, correlationId: uuidv7() });
    await db.insert(s.auditEvents).values({ organizationId: O, siteId: nfd.id, actorId: planner, action: "production.work_order.created", entityType: "work_order", entityId: id, entityNumber: number, after: { product: sku, batchCount, demo: true } });
  };
  await insertWo("ACS-135", "planned", 2, 1);
  await insertWo("GBS-135", "draft", 7, 2);
  // Numbering continues after the seeded work orders.
  if (seq) await db.insert(s.numberingRules).values({ organizationId: O, documentType: "WO", prefix: "WO", sequenceWidth: 5, periodKey: yy(), nextValue: seq + 1 });
}
