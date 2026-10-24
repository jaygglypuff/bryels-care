import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, complaintLinks, complaintStateTransitions, complaints, containerContents, containers, deviations, inventoryLots, notifications, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { runExport } from "@/lib/export";
import {
  classifyComplaint,
  closeComplaint,
  getComplaint,
  getComplaintAcknowledgement,
  listComplaints,
  logComplaint,
  raiseComplaintDeviation,
  recallExport,
  recallScope,
  reopenComplaint,
  resolveComplaint,
  startComplaintInvestigation,
  updateComplaint,
} from "@/modules/quality";
import { COMPLAINT_TRANSITIONS, canMoveComplaint, toCustomerFacing } from "@/modules/quality/complaints-rules";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";
import { clearOrgSetting, customerByCode, salesAndWarehouse, setOrgSetting, shipToCustomer } from "../sales/w3f-fixtures";

let kit: Kit;
let sales: AuthContext;
let salesRvs: AuthContext;
let warehouse: AuthContext;
let qa: AuthContext;
let qaLead: AuthContext;
let owner: AuthContext;
let shipped: Awaited<ReturnType<typeof shipToCustomer>>;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  ({ sales, warehouse } = await salesAndWarehouse(kit));
  salesRvs = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.rvs]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  qaLead = await asUser(kit, "qa.lead@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  // Isla Spa Supplies (CUS-002) receives 24 Acapulco soap bars from the released batch-1 lot.
  shipped = await shipToCustomer(sales, warehouse, "CUS-002", [{ sku: "ACS-135", qty: "24" }]);
});

describe("US-4-15 complaints linked to shipment, lot and batch", () => {
  it("statemachine.complaint: only the listed transitions are allowed", () => {
    expect(COMPLAINT_TRANSITIONS.open).toEqual(["investigating"]);
    expect(canMoveComplaint("open", "closed")).toBe(false);
    expect(canMoveComplaint("resolved", "closed")).toBe(true);
    expect(canMoveComplaint("closed", "investigating")).toBe(false);
  });

  it("logs a complaint from the label's lot, verified against the shipment to that customer", async () => {
    const lot = shipped.lots[0];
    const r = await logComplaint(sales, {
      customerId: shipped.customer.id,
      code: `BC:LOT:${lot.lotNumber}`,
      category: "product_quality",
      channel: "phone",
      description: "Customer reports two bars with white spots on the surface.",
      internalNotes: "Customer is negotiating a price review; do not mention.",
      qtyAffected: "2",
      sampleReturned: true,
      idempotencyKey: "w3f-cmp-1",
    });
    expect(r.complaintNumber).toMatch(/^CMP-\d{2}-\d{4}$/);
    expect(r.traceMatch).toBe("verified");
    expect(r.shipmentId).toBe(shipped.shipment.id);
    const [c] = await db.select().from(complaints).where(eq(complaints.id, r.complaintId));
    expect(c.status).toBe("open");
    expect(c.lotId).toBe(lot.lotId);
    expect(c.salesOrderId).toBe(shipped.orderId);
    expect(c.siteId).toBe(kit.nfd.id);
    const tr = await db.select().from(complaintStateTransitions).where(eq(complaintStateTransitions.complaintId, r.complaintId));
    expect(tr.map((t) => t.toState)).toEqual(["open"]);
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, r.complaintId), eq(auditEvents.action, "quality.complaint.opened")));
    expect(ev).toHaveLength(1);
    const [qaUser] = await db.select().from(users).where(eq(users.email, "qa.nfd@bryels-care.test"));
    const n = await db.select().from(notifications).where(and(eq(notifications.recipientUserId, qaUser.id), eq(notifications.entityId, r.complaintId)));
    expect(n).toHaveLength(1);
    // Retry with the same key returns the first complaint.
    const again = await logComplaint(sales, { customerId: shipped.customer.id, code: lot.lotNumber, category: "product_quality", description: "Customer reports two bars with white spots on the surface.", idempotencyKey: "w3f-cmp-1" });
    expect(again.complaintId).toBe(r.complaintId);
    expect(again.replayed).toBe(true);
  });

  it("validates a box id: resolves the lot inside it and checks it against the customer's shipments", async () => {
    const lot = shipped.lots[0];
    const [box] = await db.insert(containers).values({ organizationId: kit.orgId, siteId: kit.nfd.id, containerNumber: "BX-W3F-TEST-1", status: "shipped", createdBy: sales.userId }).returning();
    await db.insert(containerContents).values({ organizationId: kit.orgId, siteId: kit.nfd.id, containerId: box.id, lotId: lot.lotId, qtyBase: "0", baseUom: "pcs" });
    const r = await logComplaint(sales, { customerId: shipped.customer.id, code: "BC:BOX:BX-W3F-TEST-1", category: "packaging", description: "Outer carton crushed on arrival." });
    expect(r.traceMatch).toBe("verified");
    const [c] = await db.select().from(complaints).where(eq(complaints.id, r.complaintId));
    expect(c.containerId).toBe(box.id);
    expect(c.lotId).toBe(lot.lotId);
  });

  it("refuses a lot that was not shipped to a customer with recorded shipments; accepts it as mismatch when the setting is off", async () => {
    // Luntian (CUS-001) has a seeded shipment, but not of the lotion lot at RVS.
    const luntian = await customerByCode("CUS-001");
    const [lotion] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.siteId, kit.rvs.id), eq(inventoryLots.itemKind, "product")));
    const e = await expectCode(logComplaint(sales, { customerId: luntian.id, code: lotion.lotNumber, category: "product_quality", description: "Lotion separated in the bottle." }), "validation");
    expect(e.details?.field).toBe("code");
    await setOrgSetting(kit.orgId, "quality.complaint.require_shipment_match", false);
    try {
      const r = await logComplaint(sales, { customerId: luntian.id, code: lotion.lotNumber, category: "product_quality", description: "Lotion separated in the bottle." });
      expect(r.traceMatch).toBe("mismatch");
      expect(r.shipmentId).toBeNull();
    } finally {
      await clearOrgSetting(kit.orgId, "quality.complaint.require_shipment_match");
    }
  });

  it("marks the match unverified when the customer has no recorded shipment yet, and refuses unknown codes", async () => {
    const mabuhay = await customerByCode("CUS-003");
    const r = await logComplaint(sales, { customerId: mabuhay.id, code: shipped.lots[0].lotNumber, category: "labelling", description: "Expiry date print smudged." });
    expect(r.traceMatch).toBe("unverified");
    const e = await expectCode(logComplaint(sales, { customerId: mabuhay.id, code: "L-NO-SUCH-LOT", category: "labelling", description: "Expiry date print smudged." }), "validation");
    expect(e.details?.field).toBe("code");
    await expectCode(logComplaint(sales, { customerId: mabuhay.id, category: "not_a_category", description: "Expiry date print smudged." }), "validation");
  });

  it("authz.cross_site.complaint: an RVS-only user cannot see NFD complaints or log against an NFD lot", async () => {
    const [c] = await db.select().from(complaints).where(eq(complaints.siteId, kit.nfd.id)).limit(1);
    await expectCode(getComplaint(salesRvs, c.id), "not_found");
    expect((await listComplaints(salesRvs, { status: "all" })).find((x) => x.id === c.id)).toBeUndefined();
    const e = await expectCode(logComplaint(salesRvs, { customerId: shipped.customer.id, code: shipped.lots[0].lotNumber, category: "product_quality", description: "Spots on the bar surface." }), "validation");
    expect(e.details?.field).toBe("code");
  });

  it("authz.role_escalation.complaint: warehouse cannot log; sales_cs cannot classify or close", async () => {
    const [c] = await db.select().from(complaints).where(eq(complaints.idempotencyKey, "w3f-cmp-1"));
    await expectCode(logComplaint(warehouse, { customerId: shipped.customer.id, category: "packaging", description: "Crushed carton reported." }), "forbidden");
    await expectCode(classifyComplaint(sales, { complaintId: c.id, severity: "major" }), "forbidden");
    await expectCode(startComplaintInvestigation(sales, { complaintId: c.id, severity: "major", investigation: "Check retained samples." }), "forbidden");
    await expectCode(closeComplaint(sales, { complaintId: c.id }), "forbidden");
  });

  it("runs open → investigating → resolved → closed; closure needs qa_qc and a classified severity", async () => {
    const [c] = await db.select().from(complaints).where(eq(complaints.idempotencyKey, "w3f-cmp-1"));
    await expectCode(resolveComplaint(sales, { complaintId: c.id, resolution: "Replaced the bars." }), "state");
    await startComplaintInvestigation(sales, { complaintId: c.id, investigation: "Request photos and the returned sample; check retained samples of the lot." });
    await updateComplaint(sales, { complaintId: c.id, internalNotes: "Customer prefers email replies.", customerResponse: "Thank you; we are examining the sample you returned." });
    await resolveComplaint(sales, { complaintId: c.id, resolution: "Spots are soda ash bloom (cosmetic); bars replaced.", rootCause: "Curing room humidity above target during cure." });
    await expectCode(closeComplaint(qa, { complaintId: c.id }), "validation"); // severity not classified yet
    await classifyComplaint(qa, { complaintId: c.id, severity: "minor" });
    await reopenComplaint(sales, { complaintId: c.id, reason: "Customer sent more photos." });
    await resolveComplaint(sales, { complaintId: c.id, resolution: "Spots are soda ash bloom (cosmetic); bars replaced." });
    await closeComplaint(qa, { complaintId: c.id, note: "Reviewed; no further action." });
    const [after] = await db.select().from(complaints).where(eq(complaints.id, c.id));
    expect(after.status).toBe("closed");
    expect(after.closedBy).toBe(qa.userId);
    const tr = await db.select().from(complaintStateTransitions).where(eq(complaintStateTransitions.complaintId, c.id)).orderBy(complaintStateTransitions.occurredAt);
    expect(tr.map((t) => t.toState)).toEqual(["open", "investigating", "resolved", "investigating", "resolved", "closed"]);
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, c.id), eq(auditEvents.action, "quality.complaint.closed")));
    expect(ev).toHaveLength(1);
    await expectCode(updateComplaint(sales, { complaintId: c.id, internalNotes: "late note" }), "state");
  });

  it("internal notes never reach the customer-facing acknowledgement", async () => {
    const [c] = await db.select().from(complaints).where(eq(complaints.idempotencyKey, "w3f-cmp-1"));
    const ack = await getComplaintAcknowledgement(sales, c.id);
    const text = JSON.stringify(ack);
    expect(text).toContain(c.complaintNumber);
    expect(text).toContain("examining the sample");
    for (const secret of ["price review", "prefers email", "Curing room humidity", "soda ash bloom", "minor"]) expect(text).not.toContain(secret);
    // The projection is a whitelist: extra fields passed in are dropped.
    const p = toCustomerFacing({ ...ack.document, status: "investigating", internalNotes: "SECRET" } as never);
    expect(JSON.stringify(p)).not.toContain("SECRET");
  });

  it("a severity in quality.complaint.recall_review_severities flags a recall assessment and notifies the owner", async () => {
    const r = await logComplaint(sales, { customerId: shipped.customer.id, code: shipped.lots[0].lotNumber, category: "skin_reaction", description: "Customer reports redness after use." });
    const out = await classifyComplaint(qa, { complaintId: r.complaintId, severity: "critical" });
    expect(out.recallReviewFlagged).toBe(true);
    const [ownerUser] = await db.select().from(users).where(eq(users.email, "owner@bryels-care.test"));
    const n = await db.select().from(notifications).where(and(eq(notifications.recipientUserId, ownerUser.id), eq(notifications.entityId, r.complaintId)));
    expect(n.length).toBe(1);
    await expectCode(classifyComplaint(qa, { complaintId: r.complaintId, severity: "catastrophic" }), "validation");
  });

  it("raises a deviation linked to the complaint's lot (source complaint) once", async () => {
    const r = await logComplaint(sales, { customerId: shipped.customer.id, code: shipped.lots[0].lotNumber, category: "foreign_matter", description: "Small dark particle inside one bar." });
    await expectCode(raiseComplaintDeviation(sales, { complaintId: r.complaintId, description: "Particle found by customer." }), "forbidden");
    const d = await raiseComplaintDeviation(qa, { complaintId: r.complaintId, description: "Customer found a dark particle inside one bar; check sieve records." });
    const [dev] = await db.select().from(deviations).where(eq(deviations.id, d.deviationId));
    expect(dev.source).toBe("complaint");
    expect(dev.lotId).toBe(shipped.lots[0].lotId);
    const links = await db.select().from(complaintLinks).where(and(eq(complaintLinks.complaintId, r.complaintId), eq(complaintLinks.linkKind, "deviation")));
    expect(links).toHaveLength(1);
    await expectCode(raiseComplaintDeviation(qa, { complaintId: r.complaintId, description: "Second try at raising." }), "state");
    const view = await getComplaint(qa, r.complaintId);
    expect(view.deviation?.number).toBe(dev.deviationNumber);
  });
});

describe("US-4-17 genealogy forward to customer and recall explorer", () => {
  it("genealogy.forward_and_backward: from the supplier lot, every shipment, customer and quantity downstream", async () => {
    const t0 = Date.now();
    const r = await recallScope(qa, { supplierLot: "LOS-24871" });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.subject?.kind).toBe("supplier_lot");
    const customers = r.customers.map((c) => c.customerName);
    expect(customers).toContain("Luntian Wellness Stores");
    expect(customers).toContain("Isla Spa Supplies");
    const isla = r.shipments.find((s) => s.shipmentId === shipped.shipment.id)!;
    expect(isla.qtyShipped).toBe("24");
    expect(isla.qtyOutstanding).toBe("24");
    expect(isla.drNumber).toBe(shipped.shipment.deliveryReceiptNumber);
    expect(r.batches.length).toBeGreaterThanOrEqual(2);
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "quality.genealogy.viewed"), eq(auditEvents.actorId, qa.userId)));
    expect(ev.length).toBeGreaterThan(0);
  });

  it("reverse from a complaint lists the source batch, sibling batches sharing input lots and their customers", async () => {
    const [c] = await db.select().from(complaints).where(eq(complaints.idempotencyKey, "w3f-cmp-1"));
    const r = await recallScope(qa, { complaintId: c.id });
    expect(r.mode).toBe("reverse");
    const relations = new Set(r.batches.map((b) => b.relation));
    expect(relations.has("source")).toBe(true);
    expect(relations.has("sibling")).toBe(true); // the Guava batch used the same oil lots
    expect(r.lots.some((l) => l.role === "upstream" && l.itemKind === "material")).toBe(true);
    expect(r.customers.map((x) => x.customerName)).toContain("Isla Spa Supplies");
    // Forward-only from the same finished lot stays on that lot.
    const fwd = await recallScope(qa, { code: shipped.lots[0].lotNumber, mode: "forward" });
    expect(fwd.batches.filter((b) => b.relation === "sibling")).toHaveLength(0);
  });

  it("authz.cross_site.genealogy: an RVS-only user sees nothing of an NFD lot (same message as not found)", async () => {
    const rvsQa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.rvs]);
    const r = await recallScope(rvsQa, { code: shipped.lots[0].lotNumber });
    expect(r.subject).toBeNull();
    expect(r.shipments).toHaveLength(0);
    const nf = await recallScope(rvsQa, { code: "L-NO-SUCH" });
    expect(nf.notFoundMessage).toBe(r.notFoundMessage);
    await expectCode(recallScope(warehouse, { code: shipped.lots[0].lotNumber }), "forbidden");
  });

  it("exports the recall list through the export layer (S, audited); others are refused", async () => {
    await expectCode(runExport(sales, recallExport, { code: shipped.lots[0].lotNumber }, "csv"), "forbidden");
    const f = await runExport(qa, recallExport, { code: shipped.lots[0].lotNumber }, "csv");
    const text = f.body.toString("utf8");
    expect(text).toContain("Isla Spa Supplies");
    expect(text).toContain(shipped.shipment.deliveryReceiptNumber);
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.actorId, qa.userId), inArray(auditEvents.action, ["platform.export.created", "quality.genealogy.exported"])));
    expect(new Set(ev.map((e) => e.action))).toEqual(new Set(["platform.export.created", "quality.genealogy.exported"]));
    // Owner sees every site.
    const o = await recallScope(owner, { supplierLot: "LOS-24871" });
    expect(o.siteCodes.sort()).toEqual(["NFD", "RVS"]);
    void qaLead;
  });
});
