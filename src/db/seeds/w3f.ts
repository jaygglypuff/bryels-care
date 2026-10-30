/**
 * Wave 3 W3F fictional demo data (complaints, customer returns; runs inside the ALLOW_DEMO_SEED-guarded
 * seed): a customer-returns quarantine location RET-01 at NFD, one complaint under investigation and one
 * closed complaint on the seeded Luntian Wellness Stores shipment, and one customer return of six damaged
 * bars received into RET-01 in quarantine (a new lot re-lotted from the shipped lot, waiting for QA).
 * The return lot number is outside the LOT sequence so the demo numbering stays as before.
 */
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../schema";

type Db = PostgresJsDatabase<typeof s>;

async function nextNo(db: Db, organizationId: string, type: string, prefix: string, width: number, period: string) {
  const rows = await db.execute<{ value: string }>(sql`
    INSERT INTO numbering_rules (id, organization_id, document_type, prefix, sequence_width, period_key, next_value)
    VALUES (gen_random_uuid(), ${organizationId}, ${type}, ${prefix}, ${width}, ${period}, 2)
    ON CONFLICT (organization_id, document_type, period_key) DO UPDATE SET next_value = numbering_rules.next_value + 1
    RETURNING (next_value - 1)::text AS value`);
  return [prefix, period, String(rows[0].value).padStart(width, "0")].filter(Boolean).join("-");
}

export async function seedW3F(db: Db) {
  const [org] = await db.select().from(s.organizations).limit(1);
  const O = org.id;
  const YY = String(new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" })).getFullYear()).slice(2);
  const [nfd] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, "NFD")));
  const user = async (email: string) => (await db.select().from(s.users).where(eq(s.users.email, email)))[0];
  const sales = await user("sales@bryels-care.test");
  const qa = await user("qa.nfd@bryels-care.test");
  const warehouse = await user("warehouse.nfd@bryels-care.test");
  const manager = await user("manager.nfd@bryels-care.test");
  if (!nfd || !sales || !qa || !warehouse || !manager) return;
  const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000);

  // 1. Customer-returns cage (quarantine class) next to the quarantine cage.
  const [qua] = await db.select().from(s.locations).where(and(eq(s.locations.siteId, nfd.id), eq(s.locations.code, "QUA-01")));
  if (!qua) return;
  const [ret] = await db.insert(s.locations).values({ siteId: nfd.id, warehouseId: qua.warehouseId, code: "RET-01", name: "Customer returns cage", kind: "quarantine", section: "returns" }).returning();

  // The seeded, delivered shipment to Luntian Wellness Stores (48 bars of the batch-1 lot).
  const [luntian] = await db.select().from(s.customers).where(and(eq(s.customers.organizationId, O), eq(s.customers.code, "CUS-001")));
  if (!luntian) return;
  const [sh] = await db
    .select({ shipment: s.shipments })
    .from(s.shipments)
    .innerJoin(s.salesOrders, eq(s.salesOrders.id, s.shipments.salesOrderId))
    .where(and(eq(s.shipments.siteId, nfd.id), eq(s.salesOrders.customerId, luntian.id)))
    .limit(1);
  if (!sh) return;
  const [mv] = await db.select().from(s.stockMovements).where(and(eq(s.stockMovements.sourceDocumentId, sh.shipment.id), eq(s.stockMovements.movementType, "shipment"))).limit(1);
  const [lot] = await db.select().from(s.inventoryLots).where(eq(s.inventoryLots.id, mv.lotId));

  // 2. Complaint under investigation (classified minor by QA).
  const n1 = await nextNo(db, O, "CMP", "CMP", 4, YY);
  const [c1] = await db
    .insert(s.complaints)
    .values({
      organizationId: O,
      siteId: nfd.id,
      complaintNumber: n1,
      status: "investigating",
      category: "product_quality",
      severity: "minor",
      channel: "phone",
      customerId: luntian.id,
      customerReference: "LWS-CS-118",
      productId: lot.productId,
      lotId: lot.id,
      salesOrderId: sh.shipment.salesOrderId,
      shipmentId: sh.shipment.id,
      reportedCode: lot.lotNumber,
      traceMatch: "verified",
      description: "Store reports a few bars with white powdery spots on the surface; customers asked whether they are safe to use.",
      qtyAffected: "6",
      sampleReturned: true,
      internalNotes: "Buyer Bea Ramos prefers a call before any email (fictional demo note).",
      investigation: "Compare the returned bars with the retained sample; check curing-room humidity records for the batch.",
      receivedAt: at(50),
      receivedBy: sales.id,
      classifiedBy: qa.id,
      classifiedAt: at(30),
      statusChangedAt: at(30),
      statusChangedBy: qa.id,
      createdAt: at(50),
    })
    .returning();
  await db.insert(s.complaintStateTransitions).values([
    { organizationId: O, siteId: nfd.id, complaintId: c1.id, fromState: null, toState: "open", actorId: sales.id, occurredAt: at(50) },
    { organizationId: O, siteId: nfd.id, complaintId: c1.id, fromState: "open", toState: "investigating", actorId: qa.id, reason: c1.investigation, occurredAt: at(30) },
  ]);

  // 3. Closed complaint (delivery paperwork), resolved by sales, closed by QA.
  const n2 = await nextNo(db, O, "CMP", "CMP", 4, YY);
  const [c2] = await db
    .insert(s.complaints)
    .values({
      organizationId: O,
      siteId: nfd.id,
      complaintNumber: n2,
      status: "closed",
      category: "delivery",
      severity: "minor",
      channel: "email",
      customerId: luntian.id,
      productId: lot.productId,
      lotId: lot.id,
      salesOrderId: sh.shipment.salesOrderId,
      shipmentId: sh.shipment.id,
      reportedCode: lot.lotNumber,
      traceMatch: "verified",
      description: "The delivery receipt copy for the store was missing from the carton.",
      internalNotes: "Driver confirmed he kept both copies by mistake.",
      resolution: "Copy re-sent by email; drivers reminded to hand over the customer copy.",
      rootCause: "Customer copy not separated at delivery.",
      customerResponse: "We have sent a copy of the delivery receipt by email. Thank you for telling us.",
      receivedAt: at(140),
      receivedBy: sales.id,
      classifiedBy: qa.id,
      classifiedAt: at(130),
      resolvedBy: sales.id,
      resolvedAt: at(120),
      closedBy: qa.id,
      closedAt: at(110),
      statusChangedAt: at(110),
      statusChangedBy: qa.id,
      createdAt: at(140),
    })
    .returning();
  await db.insert(s.complaintStateTransitions).values([
    { organizationId: O, siteId: nfd.id, complaintId: c2.id, fromState: null, toState: "open", actorId: sales.id, occurredAt: at(140) },
    { organizationId: O, siteId: nfd.id, complaintId: c2.id, fromState: "open", toState: "investigating", actorId: sales.id, reason: "Asked the driver about the copies.", occurredAt: at(130) },
    { organizationId: O, siteId: nfd.id, complaintId: c2.id, fromState: "investigating", toState: "resolved", actorId: sales.id, reason: c2.resolution, occurredAt: at(120) },
    { organizationId: O, siteId: nfd.id, complaintId: c2.id, fromState: "resolved", toState: "closed", actorId: qa.id, occurredAt: at(110) },
  ]);

  // 4. Customer return of the six spotted bars, posted into RET-01 in quarantine (waiting for QA disposition).
  const rtNo = await nextNo(db, O, "RT", "RT", 4, YY);
  const [rt] = await db
    .insert(s.customerReturns)
    .values({
      organizationId: O,
      siteId: nfd.id,
      returnNumber: rtNo,
      status: "received",
      customerId: luntian.id,
      salesOrderId: sh.shipment.salesOrderId,
      shipmentId: sh.shipment.id,
      complaintId: c1.id,
      reasonCode: "quality_complaint",
      reasonNote: `Bars named in complaint ${n1}.`,
      toLocationId: ret.id,
      createdBy: warehouse.id,
      submittedBy: warehouse.id,
      submittedAt: at(28),
      approvedBy: manager.id,
      approvedAt: at(27),
      receivedBy: manager.id,
      receivedAt: at(26),
      statusChangedAt: at(26),
      statusChangedBy: manager.id,
      createdAt: at(29),
    })
    .returning();
  const [rl] = await db
    .insert(s.inventoryLots)
    .values({ organizationId: O, siteId: nfd.id, lotNumber: "L-DEMO-W3F-01", itemKind: lot.itemKind, productId: lot.productId, manufacturedOn: lot.manufacturedOn, expiresOn: lot.expiresOn, qualityStatus: "quarantine", originLotId: lot.id, baseUom: lot.baseUom, createdBy: manager.id, createdAt: at(26) })
    .returning();
  const [rmv] = await db
    .insert(s.stockMovements)
    .values({ organizationId: O, siteId: nfd.id, movementType: "return", lotId: rl.id, toLocationId: ret.id, qtyBase: "6", baseUom: lot.baseUom, qtyEntered: "6", enteredUom: lot.baseUom, qualityStatusAtPosting: "quarantine", sourceDocumentType: "customer_return", sourceDocumentId: rt.id, sourceDocumentNumber: rtNo, reason: `Customer return from ${luntian.name} (${sh.shipment.deliveryReceiptNumber})`, postedBy: manager.id, postedAt: at(26), meta: { originLotId: lot.id, originLotNumber: lot.lotNumber, shipmentId: sh.shipment.id, condition: "damaged" } })
    .returning();
  await db.insert(s.inventoryBalances).values({ siteId: nfd.id, lotId: rl.id, locationId: ret.id, qtyBase: "6" });
  await db.insert(s.customerReturnLines).values({ organizationId: O, siteId: nfd.id, customerReturnId: rt.id, lineNo: 1, productId: lot.productId, lotId: lot.id, qtyBase: "6", baseUom: lot.baseUom, condition: "damaged", toLocationId: ret.id, returnLotId: rl.id, stockMovementId: rmv.id, scanPayload: `BC:LOT:${lot.lotNumber}`, createdBy: warehouse.id, createdAt: at(29) });
  await db.insert(s.customerReturnStateTransitions).values([
    { organizationId: O, siteId: nfd.id, customerReturnId: rt.id, fromState: null, toState: "draft", actorId: warehouse.id, occurredAt: at(29) },
    { organizationId: O, siteId: nfd.id, customerReturnId: rt.id, fromState: "draft", toState: "submitted", actorId: warehouse.id, occurredAt: at(28) },
    { organizationId: O, siteId: nfd.id, customerReturnId: rt.id, fromState: "submitted", toState: "approved", actorId: manager.id, occurredAt: at(27) },
    { organizationId: O, siteId: nfd.id, customerReturnId: rt.id, fromState: "approved", toState: "received", actorId: manager.id, occurredAt: at(26) },
  ]);
  await db.insert(s.complaintLinks).values({ organizationId: O, complaintId: c1.id, linkKind: "customer_return", entityId: rt.id, entityNumber: rtNo, createdBy: warehouse.id, createdAt: at(29) });
}
