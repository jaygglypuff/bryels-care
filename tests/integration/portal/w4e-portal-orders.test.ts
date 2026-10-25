/**
 * US-8-02 approved catalogue, order placement into the internal sales-order state machine, status
 * tracking, own documents and reorder (W4E). Tests: authz.portal.tenant_isolation (orders, prices,
 * documents), portal orders never bypass credit/approval, prices only from approved price lists,
 * idempotency (sequential and concurrent), order size caps, viewer cannot order, read-only mode,
 * DTO allow-lists (no internal notes, approval reasons, credit status, staff names, driver/plate/boxes).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { auditEvents, deliveryReceipts, priceListLines, priceLists, products, quotes, salesOrderStateTransitions, salesOrders, shipments, users } from "@/db/schema";
import {
  addPortalCatalogItem,
  getPortalAccess,
  getPortalDocument,
  getPortalOrder,
  listPortalDocuments,
  listPortalOrders,
  placePortalOrder,
  portalCatalogue,
  portalDocumentHref,
  registerPortalDocumentSource,
  removePortalCatalogItem,
  reorderCart,
  setPortalCatalogMode,
  type PortalAuthContext,
} from "@/modules/portal";
import { approveOrder } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { clearOrgSetting, inDays, productId, setOrgSetting } from "../../support/w3d";
import { loadW4e, portalSignIn, type W4e } from "../../support/w4e";

let w: W4e;
let joy: PortalAuthContext; // Mabuhay buyer
let ramil: PortalAuthContext; // Mabuhay viewer
let carla: PortalAuthContext; // Salon Amihan buyer (credit hold)
let acs: string;
let gbs: string;
let ahl: string;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW4e();
  joy = (await portalSignIn("portal.mabuhay@bryels-care.test")).ctx;
  ramil = (await portalSignIn("portal.mabuhay.viewer@bryels-care.test")).ctx;
  carla = (await portalSignIn("portal.salon@bryels-care.test")).ctx;
  acs = await productId("ACS-135");
  gbs = await productId("GBS-135");
  ahl = await productId("AHL-250");
});

const order = (lines: { productId: string; qty: string }[], extra: Record<string, unknown> = {}) => ({ lines, requestedDeliveryOn: inDays(10), ...extra });

describe("approved catalogue", () => {
  it("Mabuhay (own price list) sees its contract prices and breaks, never stock or costs", async () => {
    const cat = await portalCatalogue(joy);
    const a = cat.find((i) => i.sku === "ACS-135")!;
    expect(a.priceBreaks).toEqual([
      { minQty: "0", unitAmount: "72.50" },
      { minQty: "960", unitAmount: "70.00" },
    ]);
    expect(Object.keys(a).sort()).toEqual(["currency", "customerItemCode", "leadTimeDays", "moq", "name", "priceBreaks", "productId", "sku", "unitsPerBox", "uom"].sort());
    expect(cat.map((i) => i.sku).sort()).toEqual(["ACS-135", "AHL-250", "GBS-135"]);
  });

  it("only active products with an approved, effective price: unpriced and discontinued products never appear", async () => {
    // A new active product priced only on a draft (unapproved) customer list.
    const [p] = await db.insert(products).values({ organizationId: w.orgId, skuCode: "W4E-UNP-01", name: "Fictional unpriced serum", family: "serum", unitNetMassG: "30" }).returning();
    const [pl] = await db.select().from(priceLists).where(and(eq(priceLists.code, "PL-GENERAL"), eq(priceLists.status, "approved")));
    expect((await portalCatalogue(carla)).some((i) => i.productId === p.id)).toBe(false);
    // Priced on the approved general list: Salon Amihan (mode all_priced) sees it, Mabuhay (own list only) does not.
    await db.insert(priceListLines).values({ priceListId: pl.id, productId: p.id, unitAmount: "99.00" });
    expect((await portalCatalogue(carla)).find((i) => i.productId === p.id)?.priceBreaks).toEqual([{ minQty: "0", unitAmount: "99.00" }]);
    expect((await portalCatalogue(joy)).some((i) => i.productId === p.id)).toBe(false);
    await db.update(products).set({ status: "discontinued" }).where(eq(products.id, p.id));
    expect((await portalCatalogue(carla)).some((i) => i.productId === p.id)).toBe(false);
    // ...and an order for it is refused although it exists.
    await expectCode(placePortalOrder(carla, order([{ productId: p.id, qty: "10" }])), "validation");
  });

  it("curated mode: staff (sales.portal_catalog.admin) choose the items; each must be priced", async () => {
    await expectCode(setPortalCatalogMode(w.warehouse, w.salonTenantId, "curated"), "forbidden");
    await expectCode(setPortalCatalogMode(w.salesRvs, w.salonTenantId, "curated"), "not_found");
    await setPortalCatalogMode(w.sales, w.salonTenantId, "curated");
    expect(await portalCatalogue(carla)).toEqual([]);
    await addPortalCatalogItem(w.sales, w.salonTenantId, gbs);
    expect((await portalCatalogue(carla)).map((i) => i.sku)).toEqual(["GBS-135"]);
    await expectCode(placePortalOrder(carla, order([{ productId: acs, qty: "24" }])), "validation");
    const [unpriced] = await db.insert(products).values({ organizationId: w.orgId, skuCode: "W4E-UNP-02", name: "Fictional unpriced toner", family: "toner", unitNetMassG: "50" }).returning();
    await expectCode(addPortalCatalogItem(w.sales, w.salonTenantId, unpriced.id), "validation");
    const view = await getPortalAccess(w.sales, w.salonId);
    expect(view.catalog?.items.map((i) => i.sku)).toEqual(["GBS-135"]);
    await removePortalCatalogItem(w.sales, w.salonTenantId, gbs);
    await setPortalCatalogMode(w.sales, w.salonTenantId, "all_priced");
    expect((await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, w.salonTenantId), eq(auditEvents.action, "sales.portal_catalog.mode_changed")))).length).toBe(2);
  });
});

describe("order placement enters the internal sales-order state machine", () => {
  it("within limits: draft → submitted → confirmed by the W3D rules, source portal, prices from the list, audited as the portal user", async () => {
    const r = await placePortalOrder(joy, order([{ productId: acs, qty: "480" }, { productId: gbs, qty: "240" }], { customerPoNumber: "MPG-PO-9001", note: "Please deliver before noon." }), { idempotencyKey: uuidv7() });
    expect(r.status).toBe("confirmed");
    expect((await listPortalOrders(joy)).find((x) => x.id === r.orderId)).toMatchObject({ lineCount: 2, totalAmount: "51600.00", statusLabel: "Confirmed", fromPortal: true });
    expect(r.statusLabel).toBe("Confirmed");
    const [o] = await db.select().from(salesOrders).where(eq(salesOrders.id, r.orderId));
    expect(o).toMatchObject({ source: "portal", portalUserId: joy.portalUserId, customerId: w.mabuhayId, siteId: w.nfd.id, creditCheckStatus: "passed", customerPoNumber: "MPG-PO-9001" });
    expect(o.subtotalAmount).toBe("51600.0000"); // 480 × 72.50 + 240 × 70.00
    const [sys] = await db.select().from(users).where(eq(users.email, "system@bryels-care.invalid"));
    expect(o.createdBy).toBe(sys.id);
    const ts = await db.select().from(salesOrderStateTransitions).where(eq(salesOrderStateTransitions.salesOrderId, o.id)).orderBy(asc(salesOrderStateTransitions.occurredAt));
    expect(ts.map((t) => `${t.fromState ?? "∅"}>${t.toState}`)).toEqual(["∅>draft", "draft>submitted", "submitted>confirmed"]);
    const ev = await db.select().from(auditEvents).where(eq(auditEvents.entityId, o.id));
    const placed = ev.find((e) => e.action === "sales.sales_order.placed_in_portal")!;
    expect(placed.actorLabel).toBe(`portal_user:${joy.portalUserId}`);
    expect(placed.actorId).toBeNull();
    const submitted = ev.find((e) => e.action === "sales.sales_order.submitted")!;
    expect(submitted.actorLabel).toBe("system:portal.order_intake");
    expect(submitted.correlationId).toBe(placed.correlationId);
  });

  it("never bypasses credit/approval: Salon Amihan (credit hold) stops at pending approval and staff approve it", async () => {
    const r = await placePortalOrder(carla, order([{ productId: gbs, qty: "48" }]));
    expect(r.status).toBe("pending_approval");
    expect(r.statusLabel).toBe("Under review");
    const d = await getPortalOrder(carla, r.orderId);
    // The customer never sees why (credit) or internal notes.
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/credit|approvalReasons|notes|Placed in the customer portal/i);
    expect(Object.keys(d)).not.toContain("creditCheckStatus");
    const finance = await (await import("../../support/kit")).asUser(w, "finance@bryels-care.test", "finance", [w.nfd, w.rvs]);
    await approveOrder(finance, r.orderId, { note: "Payment plan agreed (fictional)" });
    expect((await getPortalOrder(carla, r.orderId)).statusLabel).toBe("Confirmed");
  });

  it("an order above the approval threshold also waits for approval (internal rules unchanged)", async () => {
    const r = await placePortalOrder(joy, order([{ productId: ahl, qty: "4800" }]));
    expect(r.status).toBe("pending_approval");
  });

  it("prices never come from the browser; input is strict; quantities and caps are checked", async () => {
    await expectCode(placePortalOrder(joy, { ...order([{ productId: acs, qty: "24" }]), unitPrice: "1.00" } as never), "validation");
    await expectCode(placePortalOrder(joy, order([{ productId: acs, qty: "24", unitPrice: "1.00" } as never])), "validation");
    const e = await expectCode(placePortalOrder(joy, order([{ productId: acs, qty: "2.5" }])), "validation");
    expect(e.details?.fieldErrors).toMatchObject({ "lines.0.qty": expect.any(String) });
    await expectCode(placePortalOrder(joy, order([{ productId: acs, qty: "24" }, { productId: acs, qty: "24" }])), "validation");
    await expectCode(placePortalOrder(joy, { lines: [{ productId: acs, qty: "24" }], requestedDeliveryOn: "2020-01-01" }), "validation");
    await setOrgSetting(w.orgId, "portal.order.max_qty_per_line", 100);
    await expectCode(placePortalOrder(joy, order([{ productId: acs, qty: "101" }])), "validation");
    await clearOrgSetting(w.orgId, "portal.order.max_qty_per_line");
    await setOrgSetting(w.orgId, "portal.order.max_lines", 1);
    await expectCode(placePortalOrder(joy, order([{ productId: acs, qty: "24" }, { productId: gbs, qty: "24" }])), "validation");
    await clearOrgSetting(w.orgId, "portal.order.max_lines");
  });

  it("a foreign ship-to address is refused", async () => {
    const { customerAddresses } = await import("@/db/schema");
    const [salonAddr] = await db.select().from(customerAddresses).where(eq(customerAddresses.customerId, w.salonId));
    await expectCode(placePortalOrder(joy, order([{ productId: acs, qty: "24" }], { shipToAddressId: salonAddr.id })), "validation");
  });

  it("authz.role_escalation: a Viewer cannot place orders or reorder", async () => {
    await expectCode(placePortalOrder(ramil, order([{ productId: acs, qty: "24" }])), "forbidden");
    const [any] = await listPortalOrders(ramil);
    await expectCode(reorderCart(ramil, any.id), "forbidden");
  });

  it("idempotency: the same key returns the first order, sequentially and concurrently", async () => {
    const key = uuidv7();
    const a = await placePortalOrder(joy, order([{ productId: gbs, qty: "24" }]), { idempotencyKey: key });
    const b = await placePortalOrder(joy, order([{ productId: gbs, qty: "24" }]), { idempotencyKey: key });
    expect(b).toMatchObject({ orderId: a.orderId, replayed: true });
    const k2 = uuidv7();
    const both = await Promise.all([placePortalOrder(joy, order([{ productId: gbs, qty: "36" }]), { idempotencyKey: k2 }), placePortalOrder(joy, order([{ productId: gbs, qty: "36" }]), { idempotencyKey: k2 })]);
    expect(both[0].orderId).toBe(both[1].orderId);
    // The same key used by another portal user is a different command: no foreign result is ever returned.
    const c = await placePortalOrder(carla, order([{ productId: gbs, qty: "24" }]), { idempotencyKey: key });
    expect(c.orderId).not.toBe(a.orderId);
    expect((await db.select().from(salesOrders).where(eq(salesOrders.id, c.orderId)))[0].customerId).toBe(w.salonId);
  });

  it("read-only maintenance stops portal orders too", async () => {
    await setOrgSetting(w.orgId, "platform.maintenance.read_only", { enabled: true, allowed_role_codes: [] });
    try {
      await expectCode(placePortalOrder(joy, order([{ productId: gbs, qty: "24" }])), "read_only");
    } finally {
      await clearOrgSetting(w.orgId, "platform.maintenance.read_only");
    }
  });

  it("portal.ratelimit: signed-in portal requests are limited per portal user", async () => {
    await setOrgSetting(w.orgId, "portal.rate_limits", { unauthenticated_per_minute: 30, authenticated_per_minute: 10 });
    try {
      const fresh = (await portalSignIn("portal.mabuhay@bryels-care.test")).ctx;
      // Start a new window: the earlier tests consumed from a bucket sized by the default limit.
      await db.execute((await import("drizzle-orm")).sql`delete from rate_limit_buckets where scope = 'portal_user'`);
      const { limitPortalUser } = await import("@/modules/portal");
      let refused = 0;
      for (let i = 0; i < 12; i++) await limitPortalUser(fresh).catch(() => (refused += 1));
      expect(refused).toBeGreaterThan(0);
      await expectCode(placePortalOrder(fresh, order([{ productId: gbs, qty: "24" }])), "rate_limited");
    } finally {
      await clearOrgSetting(w.orgId, "portal.rate_limits");
      await db.execute((await import("drizzle-orm")).sql`delete from rate_limit_buckets where scope = 'portal_user'`);
    }
  });
});

describe("authz.portal.tenant_isolation", () => {
  it("orders: lists show only the own customer's orders (internal drafts hidden); a foreign id is 404", async () => {
    const mine = await listPortalOrders(joy);
    const orderCustomers = new Set((await db.select({ id: salesOrders.id, c: salesOrders.customerId, s: salesOrders.status, src: salesOrders.source }).from(salesOrders)).filter((o) => mine.some((m) => m.id === o.id)).map((o) => o.c));
    expect([...orderCustomers]).toEqual([w.mabuhayId]);
    // The W3D seed's internal Mabuhay draft is not shown.
    const internalDraft = await db.select().from(salesOrders).where(and(eq(salesOrders.customerId, w.mabuhayId), eq(salesOrders.status, "draft"), eq(salesOrders.source, "internal")));
    expect(internalDraft.length).toBeGreaterThan(0);
    for (const d of internalDraft) {
      expect(mine.some((m) => m.id === d.id)).toBe(false);
      await expectCode(getPortalOrder(joy, d.id), "not_found");
    }
    const salonOrders = await listPortalOrders(carla);
    expect(salonOrders.length).toBeGreaterThan(0);
    for (const o of salonOrders) {
      await expectCode(getPortalOrder(joy, o.id), "not_found");
      await expectCode(reorderCart(joy, o.id), "not_found");
    }
    await expectCode(getPortalOrder(joy, "not-a-uuid"), "not_found");
    await expectCode(getPortalOrder(joy, uuidv7()), "not_found");
  });

  it("prices: each customer sees only its own price list prices", async () => {
    const mine = (await portalCatalogue(joy)).find((i) => i.sku === "ACS-135")!;
    const theirs = (await portalCatalogue(carla)).find((i) => i.sku === "ACS-135")!;
    expect(mine.priceBreaks[0].unitAmount).toBe("72.50"); // Mabuhay contract
    expect(theirs.priceBreaks[0].unitAmount).toBe("75.00"); // general list
  });

  it("documents: quotations and delivery receipts of the own customer only; the link is one function; foreign ids are 404", async () => {
    const docs = await listPortalDocuments(joy);
    const q = docs.find((d) => d.kind === "quotation")!;
    expect(q.href).toBe(portalDocumentHref("quotation", q.id));
    const view = await getPortalDocument(joy, "quotation", q.id);
    expect(view.rows[0]).toEqual(["ACS-135", expect.any(String), "960 pcs", "PHP 70.00", "PHP 67,200.00"]);
    expect(JSON.stringify(view)).not.toMatch(/notesInternal|discount/i);
    // Another customer's quotation (Bayanihan, sent) is invisible.
    const [foreignQuote] = await db.select().from(quotes).where(and(eq(quotes.status, "sent"), eq(quotes.customerId, (await db.query.customers.findFirst({ where: (c, { eq }) => eq(c.code, "CUS-004") }))!.id)));
    await expectCode(getPortalDocument(joy, "quotation", foreignQuote.id), "not_found");
    expect((await listPortalDocuments(carla)).some((d) => d.id === q.id)).toBe(false);
    await expectCode(getPortalDocument(carla, "quotation", q.id), "not_found");
    await expectCode(getPortalDocument(joy, "payroll", q.id), "not_found");

    // A dispatched shipment with an issued DR on a Mabuhay portal order (fixture rows; dispatch itself is W3E's).
    const [o] = await db.select().from(salesOrders).where(and(eq(salesOrders.customerId, w.mabuhayId), eq(salesOrders.source, "portal"))).limit(1);
    const [staff] = await db.select().from(users).where(eq(users.email, "warehouse.nfd@bryels-care.test"));
    const [s] = await db
      .insert(shipments)
      .values({ organizationId: w.orgId, siteId: o.siteId, salesOrderId: o.id, status: "dispatched", shipmentNumber: "SH-W4E-0001", deliveryReceiptNumber: "DR-W4E-0001", dispatchedAt: new Date(), dispatchedBy: staff.id, driverName: "Jun Dela Cruz", vehiclePlate: "NFD 2468", carrier: "Own truck", packageCount: 2 })
      .returning();
    const [dr] = await db.insert(deliveryReceipts).values({ organizationId: w.orgId, siteId: o.siteId, shipmentId: s.id, drNumber: "DR-W4E-0001", status: "issued", issuedAt: new Date(), issuedBy: staff.id, createdBy: staff.id }).returning();
    const drs = await listPortalDocuments(joy, { kind: "delivery_receipt" });
    expect(drs.map((d) => d.id)).toContain(dr.id);
    const drView = await getPortalDocument(joy, "delivery_receipt", dr.id);
    const drJson = JSON.stringify(drView);
    expect(drJson).toContain("DR-W4E-0001");
    expect(drJson).not.toMatch(/Jun Dela Cruz|NFD 2468/);
    await expectCode(getPortalDocument(carla, "delivery_receipt", dr.id), "not_found");
    // The order page links the DR through the same function.
    const detail = await getPortalOrder(joy, o.id);
    expect(detail.shipments.find((x) => x.deliveryReceiptNumber === "DR-W4E-0001")?.documentHref).toBe(portalDocumentHref("delivery_receipt", dr.id));
    expect(JSON.stringify(detail.shipments)).not.toMatch(/Jun Dela Cruz|NFD 2468/);
  });

  it("finance can register invoices later through the same registry (capability-gated)", async () => {
    registerPortalDocumentSource({ kind: "test_invoice", label: "Invoices", capability: "portal.document.view", list: async (ctx) => [{ kind: "test_invoice", id: ctx.customerId, number: "INV-T", title: "Invoice INV-T", date: new Date(), statusLabel: null, reference: null, href: portalDocumentHref("test_invoice", ctx.customerId) }], view: async () => null });
    expect((await listPortalDocuments(joy)).some((d) => d.kind === "test_invoice")).toBe(true);
    await expectCode(getPortalDocument(joy, "test_invoice", joy.customerId), "not_found");
  });
});

describe("status tracking and reorder", () => {
  it("the order page shows a customer timeline without staff names and the shipments", async () => {
    const [mine] = (await listPortalOrders(joy)).filter((o) => o.fromPortal);
    const d = await getPortalOrder(joy, mine.id);
    expect(d.timeline[0].label).toBe("Received");
    expect(d.timeline.map((t) => t.label)).toContain("Under review");
    expect(JSON.stringify(d)).not.toMatch(/Paulo|Rosa|system@|createdBy|confirmedBy/);
  });

  it("reorder from history: lines still in the catalogue at today's prices; nothing is created", async () => {
    const before = (await db.select().from(salesOrders)).length;
    const [hist] = (await listPortalOrders(joy)).filter((o) => o.fromPortal);
    const cart = await reorderCart(joy, hist.id);
    expect(cart.lines.length).toBeGreaterThan(0);
    expect(cart.lines.every((l) => l.unitPrice !== null)).toBe(true);
    expect((await db.select().from(salesOrders)).length).toBe(before);
    const placed = await placePortalOrder(joy, order(cart.lines.map((l) => ({ productId: l.productId, qty: l.qty }))));
    expect((await getPortalOrder(joy, placed.orderId)).lines.map((l) => l.sku).sort()).toEqual(cart.lines.map((l) => l.sku).sort());
  });
});
