/**
 * Wave 4 W4E fictional demo data: the customer portal (US-8-01, US-8-02). Runs inside the
 * ALLOW_DEMO_SEED / DEMO_MODE guarded seed after W3D (customers, price lists). Demo addresses only
 * (@bryels-care.test), password demo1234, so the "Try the demo" panel can offer them:
 *
 * - Mabuhay Pharmacy Group (CUS-003): portal on, fulfilled by NFD, catalogue = its own approved price
 *   list. portal.mabuhay@bryels-care.test "Joy Castillo" (Buyer) and portal.mabuhay.viewer@bryels-care.test
 *   "Ramil Ocampo" (Viewer: sees everything, cannot order). History: one portal order (confirmed) to
 *   reorder from and one quotation sent to them.
 * - Salon Amihan (CUS-006, on credit hold): portal on, catalogue = every priced product (general list).
 *   portal.salon@bryels-care.test "Carla Dizon" (Buyer): an order placed here stops at credit
 *   approval, showing that portal orders never bypass the internal checks.
 * - one invitation waiting for acceptance (portal.newbuyer@bryels-care.test) for the staff panel.
 *
 * Money and quantities are strings (numeric). Nothing here is a real person or company.
 */
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { createHash, randomBytes } from "node:crypto";
import { uuidv7 } from "uuidv7";
import * as s from "../schema";

type Db = PostgresJsDatabase<typeof s>;

const manilaDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const ago = (days: number, hour = 10) => {
  const d = new Date(Date.now() - days * 86_400_000);
  d.setUTCHours(hour - 8, 0, 0, 0);
  return d;
};

export async function seedW4e(db: Db, a: { passwordHash: string }) {
  const [org] = await db.select().from(s.organizations).limit(1);
  if (!org) return;
  const O = org.id;
  const yy = manilaDay(0).slice(2, 4);
  const user = async (email: string) => (await db.select().from(s.users).where(and(eq(s.users.organizationId, O), eq(s.users.email, email))).limit(1))[0]?.id;
  const customer = async (code: string) => (await db.select().from(s.customers).where(and(eq(s.customers.organizationId, O), eq(s.customers.code, code))).limit(1))[0];
  const [nfd] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, "NFD")));
  const sales = await user("sales@bryels-care.test");
  const system = await user("system@bryels-care.invalid");
  const mabuhay = await customer("CUS-003");
  const salon = await customer("CUS-006");
  if (!nfd || !sales || !system || !mabuhay || !salon) return;

  const audit = (action: string, entityType: string, entityId: string, entityNumber: string | null, actor: { id?: string; label?: string }, siteId: string | null, when: Date, after?: object) =>
    db.insert(s.auditEvents).values({ organizationId: O, siteId, actorId: actor.id ?? null, actorLabel: actor.label ?? null, action, entityType, entityId, entityNumber, after: after ?? null, occurredAt: when });
  const nextNo = async (documentType: string, prefix: string, width: number) => {
    const rows = await db.execute<{ value: string }>(sql`
      INSERT INTO numbering_rules (id, organization_id, document_type, prefix, sequence_width, period_key, next_value)
      VALUES (gen_random_uuid(), ${O}, ${documentType}, ${prefix}, ${width}, ${yy}, 2)
      ON CONFLICT (organization_id, document_type, period_key) DO UPDATE SET next_value = numbering_rules.next_value + 1
      RETURNING (next_value - 1)::text AS value`);
    return `${prefix}-${yy}-${String(rows[0].value).padStart(width, "0")}`;
  };

  // ---------------------------------------------------------------- tenants
  const tenant = async (c: typeof mabuhay, catalogMode: string) => {
    const [t] = await db.insert(s.customerPortalTenants).values({ organizationId: O, customerId: c.id, siteId: nfd.id, catalogMode, status: "active", createdBy: sales, updatedBy: sales, createdAt: ago(20), updatedAt: ago(20) }).returning();
    await audit("sales.portal_tenant.enabled", "customer_portal_tenant", t.id, c.code, { id: sales }, nfd.id, ago(20), { customerId: c.id, siteId: nfd.id, catalogMode, status: "active" });
    return t;
  };
  const tMabuhay = await tenant(mabuhay, "customer_price_list");
  const tSalon = await tenant(salon, "all_priced");

  // ---------------------------------------------------------------- portal users
  const portalUser = async (t: typeof tMabuhay, email: string, displayName: string, portalRole: string, opts: { invited?: boolean } = {}) => {
    const [u] = await db
      .insert(s.portalUsers)
      .values({
        organizationId: O,
        tenantId: t.id,
        email,
        displayName,
        portalRole,
        passwordHash: opts.invited ? "!" : a.passwordHash,
        status: opts.invited ? "invited" : "active",
        passwordChangedAt: opts.invited ? null : ago(19),
        lastLoginAt: opts.invited ? null : ago(2),
        createdBy: sales,
        createdAt: ago(20),
        updatedAt: ago(19),
      })
      .returning();
    // The invitation that was (or still is to be) accepted; tokens are random and never printed.
    const tokenHash = createHash("sha256").update(randomBytes(32).toString("base64url")).digest("hex");
    await db.insert(s.portalInvitations).values({ organizationId: O, tenantId: t.id, portalUserId: u.id, email, tokenHash, expiresAt: opts.invited ? new Date(Date.now() + 48 * 3_600_000) : ago(17), acceptedAt: opts.invited ? null : ago(19), createdBy: sales, createdAt: opts.invited ? ago(1) : ago(20) });
    await audit("sales.portal_user.invited", "portal_user", u.id, email, { id: sales }, nfd.id, opts.invited ? ago(1) : ago(20), { tenantId: t.id, portalRole });
    if (!opts.invited) await audit("sales.portal_user.invitation_accepted", "portal_user", u.id, email, { label: `portal_user:${u.id}` }, null, ago(19), { status: "active" });
    return u;
  };
  const joy = await portalUser(tMabuhay, "portal.mabuhay@bryels-care.test", "Joy Castillo", "portal_buyer");
  await portalUser(tMabuhay, "portal.mabuhay.viewer@bryels-care.test", "Ramil Ocampo", "portal_viewer");
  await portalUser(tSalon, "portal.salon@bryels-care.test", "Carla Dizon", "portal_buyer");
  await portalUser(tMabuhay, "portal.newbuyer@bryels-care.test", "Lea Bautista", "portal_buyer", { invited: true });

  // ---------------------------------------------------------------- Mabuhay history: a confirmed portal order
  const products = await db.select().from(s.products).where(eq(s.products.organizationId, O));
  const P = (sku: string) => products.find((p) => p.skuCode === sku);
  const acs = P("ACS-135");
  const gbs = P("GBS-135");
  const [ship] = await db.select().from(s.customerAddresses).where(and(eq(s.customerAddresses.customerId, mabuhay.id), eq(s.customerAddresses.isDefaultShipTo, true))).limit(1);
  const [bill] = await db.select().from(s.customerAddresses).where(and(eq(s.customerAddresses.customerId, mabuhay.id), eq(s.customerAddresses.isDefaultBillTo, true))).limit(1);
  const [plLine] = acs ? await db.select({ line: s.priceListLines, pl: s.priceLists }).from(s.priceListLines).innerJoin(s.priceLists, eq(s.priceLists.id, s.priceListLines.priceListId)).where(and(eq(s.priceLists.customerId, mabuhay.id), eq(s.priceLists.status, "approved"), eq(s.priceListLines.productId, acs.id), eq(s.priceListLines.minQtyUnits, "0"))).limit(1) : [];
  if (acs && gbs && ship) {
    const number = await nextNo("SO", "SO", 5);
    const when = ago(6, 9);
    const lines = [
      { p: acs, qty: "480", price: "72.50" },
      { p: gbs, qty: "240", price: "70.00" },
    ];
    const subtotal = lines.reduce((t, l) => t + Number(l.qty) * Number(l.price), 0).toFixed(2);
    const [o] = await db
      .insert(s.salesOrders)
      .values({
        organizationId: O,
        siteId: nfd.id,
        orderNumber: number,
        customerId: mabuhay.id,
        customerPoNumber: "MPG-PO-7731",
        requestedDeliveryOn: manilaDay(4),
        status: "confirmed",
        notes: "Placed in the customer portal by Joy Castillo.",
        createdBy: system,
        confirmedBy: system,
        createdAt: when,
        shipToAddressId: ship.id,
        billToAddressId: bill?.id ?? ship.id,
        shipToText: [ship.line1, ship.city].filter(Boolean).join(", "),
        subtotalAmount: subtotal,
        totalAmount: subtotal,
        creditCheckStatus: "passed",
        approvalBasis: { amount: subtotal, credit_check_failed: false, discount_pct: "0" },
        submittedBy: system,
        submittedAt: when,
        statusChangedAt: when,
        statusChangedBy: system,
        updatedAt: when,
        source: "portal",
        portalUserId: joy.id,
      })
      .returning();
    await db.insert(s.salesOrderLines).values(
      lines.map((l, i) => ({ salesOrderId: o.id, lineNo: i + 1, productId: l.p.id, qtyUnits: l.qty, unitPrice: l.price, listUnitPrice: l.price, priceSource: "price_list", priceListId: plLine?.pl.id ?? null, priceListLineId: i === 0 ? (plLine?.line.id ?? null) : null })),
    );
    const corr = uuidv7();
    for (const [from, to] of [[null, "draft"], ["draft", "submitted"], ["submitted", "confirmed"]] as const) {
      await db.insert(s.salesOrderStateTransitions).values({ organizationId: O, siteId: nfd.id, salesOrderId: o.id, fromState: from, toState: to, actorId: system, occurredAt: when, correlationId: corr });
    }
    await audit("sales.sales_order.placed_in_portal", "sales_order", o.id, number, { label: `portal_user:${joy.id}` }, nfd.id, when, { source: "portal", tenantId: tMabuhay.id, lines: 2 });
    await audit("sales.sales_order.confirmed", "sales_order", o.id, number, { label: "system:portal.order_intake" }, nfd.id, when, { status: "confirmed", auto: true, creditCheck: "passed" });
  }

  // ---------------------------------------------------------------- a quotation sent to Mabuhay
  const [mbAddr] = ship ? [ship] : [];
  if (acs && mbAddr) {
    const number = await nextNo("QT", "QT", 5);
    const [q] = await db
      .insert(s.quotes)
      .values({
        organizationId: O,
        siteId: nfd.id,
        quoteNumber: number,
        status: "sent",
        customerId: mabuhay.id,
        shipToAddressId: mbAddr.id,
        validUntil: manilaDay(21),
        subtotalAmount: "67200.00",
        totalAmount: "67200.00",
        notesCustomer: "Volume price for the new branch opening (fictional).",
        submittedBy: sales,
        submittedAt: ago(3),
        sentAt: ago(3),
        statusChangedBy: sales,
        statusChangedAt: ago(3),
        createdBy: sales,
        updatedBy: sales,
        createdAt: ago(4),
      })
      .returning();
    await db.insert(s.quoteLines).values({ quoteId: q.id, lineNo: 1, productId: acs.id, qtyUnits: "960", unitAmount: "70.00", listUnitAmount: "70.00", discountPct: "0" });
    await audit("sales.quote.sent", "quote", q.id, number, { id: sales }, nfd.id, ago(3), { status: "sent" });
  }
}
