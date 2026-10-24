/**
 * Wave 3 W3D fictional demo data (customers, requirements, price lists, quotations, orders). Runs inside
 * the ALLOW_DEMO_SEED-guarded seed, after every earlier wave. No real customer appears anywhere:
 *
 * - test accounts (password demo1234): finance@bryels-care.test "Rosa Lim" (finance, organization-wide:
 *   approves credit exceptions, price lists and quotes) and sales2@bryels-care.test "Paulo Garcia"
 *   (sales_cs at NFD; a second sales person for separation-of-duties demos);
 * - the three MVP customers get segments, structured addresses, contacts and credit terms; four new
 *   fictional customers: a distributor, an online reseller (small credit limit), a salon on credit hold
 *   and a second pharmacy chain (prospect);
 * - approved requirements (shelf life, carton count, label artwork, CoA, MOQ) and one pending version;
 * - an approved general price list, approved customer lists (Mabuhay ACS-135 at 72.50 so the demo
 *   rehearsal's order is priced from the list) and one version waiting for finance approval;
 * - quotations: one sent, one waiting for approval (discount above 10 %);
 * - orders in each W3D state: draft, pending approval (over credit limit), pending approval (credit
 *   hold), confirmed, allocated and shipped (lotion stock at RVS, so NFD soap stock used by the demo
 *   rehearsal and the MVP tests stays untouched), cancelled.
 * Money and quantities are strings (numeric). Movements and balances are written together so the
 * ledger reconciles.
 */
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { uuidv7 } from "uuidv7";
import * as s from "../schema";

type Db = PostgresJsDatabase<typeof s>;

const manilaDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const ago = (days: number, hour = 10) => {
  const d = new Date(Date.now() - days * 86_400_000);
  d.setUTCHours(hour - 8, 0, 0, 0);
  return d;
};

export async function seedW3d(db: Db, a: { passwordHash: string }) {
  const [org] = await db.select().from(s.organizations).limit(1);
  if (!org) return;
  const O = org.id;
  const yy = manilaDay(0).slice(2, 4);
  const user = async (email: string) => (await db.select().from(s.users).where(and(eq(s.users.organizationId, O), eq(s.users.email, email))).limit(1))[0]?.id;
  const role = async (code: string) => (await db.select().from(s.roles).where(and(eq(s.roles.organizationId, O), eq(s.roles.code, code))).limit(1))[0]?.id;
  const [nfd] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, "NFD")));
  const [rvs] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, "RVS")));
  const sales = (await user("sales@bryels-care.test"))!;
  const qa = (await user("qa.nfd@bryels-care.test"))!;
  const whRvs = (await user("warehouse.rvs@bryels-care.test"))!;
  if (!nfd || !rvs || !sales || !qa) return;

  // Test accounts
  const ensureUser = async (email: string, name: string, roleCode: string, siteId: string | null) => {
    const existing = await user(email);
    if (existing) return existing;
    const roleId = await role(roleCode);
    const [u] = await db.insert(s.users).values({ organizationId: O, email, displayName: name, passwordHash: a.passwordHash }).returning();
    if (roleId) await db.insert(s.userSiteAssignments).values(siteId ? { userId: u.id, roleId, siteId } : { userId: u.id, roleId, isOrganizationWide: true });
    return u.id;
  };
  const finance = await ensureUser("finance@bryels-care.test", "Rosa Lim", "finance", null);
  await ensureUser("sales2@bryels-care.test", "Paulo Garcia", "sales_cs", nfd.id);

  const nextNo = async (documentType: string, prefix: string, width: number) => {
    const rows = await db.execute<{ value: string }>(sql`
      INSERT INTO numbering_rules (id, organization_id, document_type, prefix, sequence_width, period_key, next_value)
      VALUES (gen_random_uuid(), ${O}, ${documentType}, ${prefix}, ${width}, ${yy}, 2)
      ON CONFLICT (organization_id, document_type, period_key) DO UPDATE SET next_value = numbering_rules.next_value + 1
      RETURNING (next_value - 1)::text AS value`);
    return `${prefix}-${yy}-${String(rows[0].value).padStart(width, "0")}`;
  };
  const audit = (action: string, entityType: string, entityId: string, entityNumber: string | null, actorId: string, siteId: string | null, when: Date, extra: { before?: object; after?: object; reason?: string } = {}) =>
    db.insert(s.auditEvents).values({ organizationId: O, siteId, actorId, action, entityType, entityId, entityNumber, before: extra.before ?? null, after: extra.after ?? null, reason: extra.reason ?? null, occurredAt: when });

  const products = await db.select().from(s.products).where(eq(s.products.organizationId, O));
  const P = (sku: string) => products.find((p) => p.skuCode === sku)!;

  // ---------------------------------------------------------------- customers
  type Addr = { label: string; line1: string; city: string; province: string; ship?: boolean; bill?: boolean; contactName?: string; phone?: string };
  type CustSpec = {
    code: string;
    name?: string;
    segment: string;
    status?: string;
    limit: string | null;
    terms: number | null;
    lead: number | null;
    minShelf?: number;
    tin: string;
    addresses: Addr[];
    contacts: { name: string; email?: string; phone?: string; role?: string }[];
    notes?: string;
  };
  const specs: CustSpec[] = [
    {
      code: "CUS-001", segment: "retail_store", limit: "150000", terms: 30, lead: 5, tin: "DEMO-TIN-0001",
      addresses: [{ label: "Main store", line1: "12 Mabini St.", city: "Quezon City", province: "Metro Manila", ship: true, bill: true }],
      contacts: [{ name: "Bea Ramos", email: "orders@luntian.test", phone: "+63 917 555 0101", role: "Purchasing" }],
    },
    {
      code: "CUS-002", segment: "salon_spa", limit: "1500000", terms: 30, lead: 7, tin: "DEMO-TIN-0002",
      addresses: [
        { label: "Cebu spa supply room", line1: "88 Osmeña Blvd.", city: "Cebu City", province: "Cebu", ship: true },
        { label: "Head office (billing)", line1: "5F Banilad Town Centre", city: "Cebu City", province: "Cebu", bill: true },
      ],
      contacts: [{ name: "Marco Tan", email: "buying@islaspa.test", phone: "+63 918 555 0144", role: "Buyer" }],
    },
    {
      code: "CUS-003", segment: "pharmacy_chain", limit: "2500000", terms: 45, lead: 3, tin: "DEMO-TIN-0003",
      addresses: [
        { label: "Makati distribution centre", line1: "3F Ayala Ave.", city: "Makati City", province: "Metro Manila", ship: true, bill: true },
        { label: "Pasig branch", line1: "21 Caruncho Ave.", city: "Pasig City", province: "Metro Manila" },
      ],
      contacts: [
        { name: "Joy Castillo", email: "po@mabuhayrx.test", phone: "+63 919 555 0177", role: "Category buyer" },
        { name: "Ramil Ocampo", email: "receiving@mabuhayrx.test", phone: "+63 919 555 0178", role: "Receiving" },
      ],
    },
    {
      code: "CUS-004", name: "Bayanihan Health Distributors", segment: "distributor", limit: "400000", terms: 60, lead: 10, minShelf: 365, tin: "DEMO-TIN-0004",
      addresses: [{ label: "Batangas warehouse", line1: "Km 4 National Hwy., Brgy. Tinga", city: "Batangas City", province: "Batangas", ship: true, bill: true }],
      contacts: [{ name: "Liza Mercado", email: "orders@bayanihan-dist.test", phone: "+63 920 555 0210", role: "Supply planner" }],
      notes: "Fictional distributor: palletised deliveries, full shipments only.",
    },
    {
      code: "CUS-005", name: "Sari Glow Online", segment: "online_reseller", limit: "20000", terms: 0, lead: 2, minShelf: 180, tin: "DEMO-TIN-0005",
      addresses: [{ label: "Fulfilment room", line1: "Unit 7 Kalayaan Commercial", city: "Taguig City", province: "Metro Manila", ship: true, bill: true }],
      contacts: [{ name: "Ivy Navarro", email: "hello@sariglow.test", phone: "+63 921 555 0333", role: "Owner" }],
    },
    {
      code: "CUS-006", name: "Salon Amihan", segment: "salon_spa", status: "on_hold", limit: "30000", terms: 15, lead: 3, minShelf: 180, tin: "DEMO-TIN-0006",
      addresses: [{ label: "Salon", line1: "44 Maginhawa St.", city: "Quezon City", province: "Metro Manila", ship: true, bill: true }],
      contacts: [{ name: "Carla Dizon", email: "salonamihan@demo.test", phone: "+63 922 555 0444", role: "Manager" }],
      notes: "Credit hold demo: overdue balance (fictional).",
    },
    {
      code: "CUS-007", name: "Botika Liwayway", segment: "pharmacy_chain", status: "prospect", limit: null, terms: null, lead: 5, minShelf: 270, tin: "DEMO-TIN-0007",
      addresses: [{ label: "Head office", line1: "9 Rizal Ave.", city: "Calamba", province: "Laguna", ship: true, bill: true }],
      contacts: [{ name: "Noel Santos", email: "buyer@liwayway.test", phone: "+63 923 555 0555", role: "Buyer" }],
    },
  ];
  const C: Record<string, typeof s.customers.$inferSelect> = {};
  const A: Record<string, string> = {};
  for (const sp of specs) {
    const ship = sp.addresses.find((x) => x.ship)!;
    const shipText = `${ship.line1}, ${ship.city}, ${ship.province}`;
    let [c] = await db.select().from(s.customers).where(and(eq(s.customers.organizationId, O), eq(s.customers.code, sp.code)));
    const values = {
      segment: sp.segment,
      status: sp.status ?? "active",
      creditLimitAmount: sp.limit,
      paymentTermsDays: sp.terms,
      defaultLeadTimeDays: sp.lead,
      taxIdentifier: sp.tin,
      notesInternal: sp.notes ?? null,
      shipToAddress: shipText,
      contactName: sp.contacts[0].name,
      phone: sp.contacts[0].phone ?? null,
      email: sp.contacts[0].email ?? null,
      updatedBy: sales,
    };
    if (c) [c] = await db.update(s.customers).set(values).where(eq(s.customers.id, c.id)).returning();
    else [c] = await db.insert(s.customers).values({ organizationId: O, code: sp.code, name: sp.name!, minShelfLifeDays: sp.minShelf ?? 180, ...values, createdAt: ago(40) }).returning();
    C[sp.code] = c;
    for (const ad of sp.addresses) {
      const [row] = await db
        .insert(s.customerAddresses)
        .values({ organizationId: O, customerId: c.id, label: ad.label, line1: ad.line1, city: ad.city, province: ad.province, country: "PH", isDefaultShipTo: !!ad.ship, isDefaultBillTo: !!ad.bill, createdBy: sales, updatedBy: sales })
        .returning();
      A[`${sp.code}:${ad.label}`] = row.id;
      if (ad.ship) A[`${sp.code}:ship`] = row.id;
      if (ad.bill) A[`${sp.code}:bill`] = row.id;
    }
    for (const [i, k] of sp.contacts.entries()) {
      await db.insert(s.customerContacts).values({ organizationId: O, customerId: c.id, name: k.name, email: k.email ?? null, phone: k.phone ?? null, roleLabel: k.role ?? null, isPrimary: i === 0, createdBy: sales, updatedBy: sales });
    }
    if (sp.limit) await audit("sales.customer.credit_terms_changed", "customer", c.id, c.code, finance, null, ago(30), { after: { creditLimitAmount: sp.limit, paymentTermsDays: sp.terms }, reason: "Opening credit terms (fictional demo)" });
    if (sp.status === "on_hold") await audit("sales.customer.credit_hold_placed", "customer", c.id, c.code, finance, null, ago(4), { before: { status: "active" }, after: { status: "on_hold" }, reason: "Balance overdue 45 days (fictional)" });
  }

  // Customer item codes (customer SKU mapping)
  await db.insert(s.customerItemCodes).values([
    { organizationId: O, customerId: C["CUS-003"].id, productId: P("ACS-135").id, customerItemCode: "MPG-88120", customerDescription: "Herbal bar soap 135 g", createdBy: sales },
    { organizationId: O, customerId: C["CUS-003"].id, productId: P("GBS-135").id, customerItemCode: "MPG-88121", customerDescription: "Guava bar soap 135 g", createdBy: sales },
    { organizationId: O, customerId: C["CUS-004"].id, productId: P("AHL-250").id, customerItemCode: "BHD-LOT-250", createdBy: sales },
  ]);

  // ---------------------------------------------------------------- requirements (approved by QA, drafted by sales)
  const [artwork] = await db
    .insert(s.artworkVersions)
    .values({ organizationId: O, customerId: C["CUS-003"].id, productId: P("ACS-135").id, artworkCode: "ART-MPG-ACS", versionLabel: "v3", description: "Mabuhay private-label wrapper, bilingual claims (fictional)", createdBy: sales, createdAt: ago(25) })
    .returning();
  type Req = { cust: string; sku?: string; kind: string; num?: string; text?: string; artwork?: string; status?: string };
  const reqs: Req[] = [
    { cust: "CUS-003", kind: "min_remaining_shelf_life_days", num: "270" },
    { cust: "CUS-003", sku: "ACS-135", kind: "label_artwork", artwork: artwork.id },
    { cust: "CUS-003", kind: "coa_required", text: "true" },
    { cust: "CUS-003", sku: "ACS-135", kind: "carton_count", num: "48" },
    { cust: "CUS-004", kind: "min_remaining_shelf_life_days", num: "365" },
    { cust: "CUS-004", kind: "full_shipment_required", text: "true" },
    { cust: "CUS-004", sku: "AHL-250", kind: "moq", num: "240" },
    { cust: "CUS-004", kind: "shipping_marks", text: "BAYANIHAN / BATANGAS WH / FRAGILE (fictional)" },
    { cust: "CUS-002", kind: "packaging", text: "Shrink-wrap each carton; no loose units (fictional)" },
    { cust: "CUS-005", sku: "GBS-135", kind: "moq", num: "24" },
    { cust: "CUS-001", kind: "min_remaining_shelf_life_days", num: "400", status: "pending_approval" },
  ];
  for (const r of reqs) {
    const pending = r.status === "pending_approval";
    const [row] = await db
      .insert(s.customerRequirements)
      .values({
        organizationId: O,
        customerId: C[r.cust].id,
        productId: r.sku ? P(r.sku).id : null,
        requirementKind: r.kind,
        valueNumeric: r.num ?? null,
        valueText: r.text ?? null,
        artworkVersionId: r.artwork ?? null,
        versionNo: 1,
        status: pending ? "pending_approval" : "approved",
        effectiveFrom: manilaDay(-20),
        changeSummary: pending ? "Customer asks for longer shelf life from next quarter (fictional)" : "Agreed specification (fictional)",
        submittedBy: sales,
        submittedAt: ago(21),
        approvedBy: pending ? null : qa,
        approvedAt: pending ? null : ago(20),
        createdBy: sales,
        updatedBy: sales,
      })
      .returning();
    if (!pending) await audit("masterdata.customer_requirement.approved", "customer_requirement", row.id, `${r.cust} ${r.kind} v1`, qa, null, ago(20), { after: { status: "approved", versionNo: 1 } });
  }

  // ---------------------------------------------------------------- price lists
  const priceList = async (code: string, name: string, customer: string | null, lines: [string, string, string?][], opts: { status?: string; versionNo?: number; from?: string } = {}) => {
    const status = opts.status ?? "approved";
    const [pl] = await db
      .insert(s.priceLists)
      .values({
        organizationId: O,
        code,
        name,
        partyKind: customer ? "customer" : "general",
        customerId: customer ? C[customer].id : null,
        versionNo: opts.versionNo ?? 1,
        status,
        effectiveFrom: opts.from ?? manilaDay(-30),
        changeSummary: status === "approved" ? "Opening prices (fictional)" : "Price increase for the new quarter (fictional)",
        submittedBy: sales,
        submittedAt: ago(status === "approved" ? 31 : 1),
        approvedBy: status === "approved" ? finance : null,
        approvedAt: status === "approved" ? ago(30) : null,
        createdBy: sales,
        updatedBy: sales,
      })
      .returning();
    await db.insert(s.priceListLines).values(lines.map(([sku, amount, minQty]) => ({ priceListId: pl.id, productId: P(sku).id, unitAmount: amount, minQtyUnits: minQty ?? "0" })));
    if (status === "approved") {
      await db.insert(s.approvalDecisions).values({ organizationId: O, recordType: "price_list", recordId: pl.id, step: 1, cycle: 1, decision: "approved", decidedBy: finance, decidedAt: ago(30) });
      await audit("sales.price_list.approved", "price_list", pl.id, `${code} v${pl.versionNo}`, finance, null, ago(30), { after: { status: "approved", versionNo: pl.versionNo } });
    }
    return pl;
  };
  await priceList("PL-GENERAL", "General price list (fictional)", null, [["ACS-135", "75.00"], ["GBS-135", "72.00"], ["AHL-250", "165.00"]]);
  await priceList("PL-MPG", "Mabuhay Pharmacy Group contract", "CUS-003", [["ACS-135", "72.50"], ["ACS-135", "70.00", "960"], ["GBS-135", "70.00"], ["AHL-250", "155.00"]]);
  await priceList("PL-ISS", "Isla Spa Supplies", "CUS-002", [["ACS-135", "70.00"], ["GBS-135", "70.00"]]);
  await priceList("PL-BHD", "Bayanihan Health Distributors", "CUS-004", [["AHL-250", "140.00"], ["AHL-250", "135.00", "480"], ["ACS-135", "66.00"]]);
  const plBhd2 = await priceList("PL-BHD", "Bayanihan Health Distributors", "CUS-004", [["AHL-250", "145.00"], ["AHL-250", "139.00", "480"], ["ACS-135", "68.00"]], { status: "pending_approval", versionNo: 2, from: manilaDay(14) });
  await audit("sales.price_list.submitted", "price_list", plBhd2.id, "PL-BHD v2", sales, null, ago(1), { after: { status: "pending_approval" } });

  // ---------------------------------------------------------------- quotations
  const quote = async (cust: string, status: string, lines: [string, string, string, string | null][], opts: { discount?: string; daysAgo?: number } = {}) => {
    const number = await nextNo("QT", "QT", 5);
    const subtotal = lines.reduce((t, [, q, p]) => t + Number(q) * Number(p), 0).toFixed(2);
    const [q] = await db
      .insert(s.quotes)
      .values({
        organizationId: O,
        siteId: nfd.id,
        quoteNumber: number,
        status,
        customerId: C[cust].id,
        shipToAddressId: A[`${cust}:ship`],
        validUntil: manilaDay(25),
        subtotalAmount: subtotal,
        totalAmount: subtotal,
        maxDiscountPct: opts.discount ?? "0",
        notesCustomer: "Prices valid for the quantities quoted (fictional).",
        submittedBy: sales,
        submittedAt: ago(opts.daysAgo ?? 2),
        sentAt: status === "sent" ? ago(opts.daysAgo ?? 2) : null,
        statusChangedBy: sales,
        statusChangedAt: ago(opts.daysAgo ?? 2),
        createdBy: sales,
        updatedBy: sales,
        createdAt: ago((opts.daysAgo ?? 2) + 1),
      })
      .returning();
    await db.insert(s.quoteLines).values(lines.map(([sku, qty, price, list], i) => ({ quoteId: q.id, lineNo: i + 1, productId: P(sku).id, qtyUnits: qty, unitAmount: price, listUnitAmount: list, discountPct: list ? (((Number(list) - Number(price)) / Number(list)) * 100).toFixed(4) : "0" })));
    await audit(status === "sent" ? "sales.quote.sent" : "sales.quote.submitted", "quote", q.id, number, sales, nfd.id, ago(opts.daysAgo ?? 2), { after: { status } });
    return q;
  };
  await quote("CUS-004", "sent", [["AHL-250", "480", "135.00", "135.00"], ["ACS-135", "960", "66.00", "66.00"]], { daysAgo: 3 });
  await quote("CUS-007", "pending_approval", [["ACS-135", "480", "64.00", "75.00"], ["GBS-135", "480", "64.00", "72.00"]], { discount: "14.6667", daysAgo: 1 });

  // ---------------------------------------------------------------- orders
  type Line = [string, string, string, string];
  const order = async (cust: string, site: string, status: string, lines: Line[], opts: { reasons?: { code: string; message: string }[]; credit?: string; daysAgo?: number; deliver?: number; po?: string; cancel?: string; approvedBy?: string } = {}) => {
    const number = await nextNo("SO", "SO", 5);
    const subtotal = lines.reduce((t, [, q, p]) => t + Number(q) * Number(p), 0).toFixed(2);
    const when = ago(opts.daysAgo ?? 1);
    const [o] = await db
      .insert(s.salesOrders)
      .values({
        organizationId: O,
        siteId: site,
        orderNumber: number,
        customerId: C[cust].id,
        customerPoNumber: opts.po ?? null,
        requestedDeliveryOn: manilaDay(opts.deliver ?? 7),
        status,
        createdBy: sales,
        confirmedBy: ["confirmed", "allocated", "shipped"].includes(status) ? (opts.approvedBy ?? sales) : null,
        shipToAddressId: A[`${cust}:ship`],
        billToAddressId: A[`${cust}:bill`],
        shipToText: C[cust].shipToAddress,
        subtotalAmount: subtotal,
        totalAmount: subtotal,
        creditCheckStatus: opts.credit ?? (status === "draft" || status === "cancelled" ? "pending" : "passed"),
        approvalReasons: opts.reasons ?? null,
        approvalBasis: opts.reasons ? { amount: subtotal, credit_check_failed: true, discount_pct: "0" } : null,
        submittedBy: status === "draft" ? null : sales,
        submittedAt: status === "draft" ? null : when,
        approvedBy: opts.approvedBy ?? null,
        approvedAt: opts.approvedBy ? when : null,
        cancelReason: opts.cancel ?? null,
        statusChangedAt: when,
        statusChangedBy: sales,
        createdAt: when,
      })
      .returning();
    const lineRows = await db
      .insert(s.salesOrderLines)
      .values(lines.map(([sku, qty, price, source], i) => ({ salesOrderId: o.id, lineNo: i + 1, productId: P(sku).id, qtyUnits: qty, unitPrice: price, listUnitPrice: source === "price_list" ? price : null, priceSource: source, minRemainingShelfLifeDays: C[cust].minShelfLifeDays })))
      .returning();
    const path: Record<string, string[]> = {
      draft: ["draft"],
      pending_approval: ["draft", "submitted", "pending_approval"],
      confirmed: ["draft", "submitted", "confirmed"],
      allocated: ["draft", "submitted", "confirmed", "allocated"],
      shipped: ["draft", "submitted", "confirmed", "allocated", "shipped"],
      cancelled: ["draft", "submitted", "confirmed", "cancelled"],
    };
    let prev: string | null = null;
    for (const [i, st] of (path[status] ?? [status]).entries()) {
      await db.insert(s.salesOrderStateTransitions).values({ organizationId: O, siteId: site, salesOrderId: o.id, fromState: prev, toState: st, actorId: st === "allocated" || st === "shipped" ? whRvs : sales, reason: st === "cancelled" ? (opts.cancel ?? null) : null, occurredAt: new Date(when.getTime() + i * 60_000), correlationId: uuidv7() });
      prev = st;
    }
    await audit("sales.sales_order.created", "sales_order", o.id, number, sales, site, when, { after: { status: "draft" } });
    if (status !== "draft") await audit("sales.sales_order.submitted", "sales_order", o.id, number, sales, site, when, { after: { status: "submitted" } });
    return { o, lineRows };
  };

  await order("CUS-003", nfd.id, "draft", [["GBS-135", "240", "70.00", "price_list"], ["AHL-250", "48", "155.00", "price_list"]], { daysAgo: 0, po: "MPG-PO-7790" });
  await order("CUS-005", nfd.id, "pending_approval", [["ACS-135", "240", "75.00", "price_list"], ["GBS-135", "96", "72.00", "price_list"]], { credit: "failed", reasons: [{ code: "credit_limit", message: "Over credit limit" }], daysAgo: 0, po: "SGO-1021" });
  await order("CUS-006", nfd.id, "pending_approval", [["GBS-135", "48", "72.00", "price_list"]], { credit: "failed", reasons: [{ code: "credit_hold", message: "Customer is on credit hold" }], daysAgo: 1 });
  await order("CUS-004", nfd.id, "confirmed", [["ACS-135", "480", "66.00", "price_list"]], { daysAgo: 1, deliver: 12, po: "BHD-PO-3301" });
  await order("CUS-001", nfd.id, "cancelled", [["ACS-135", "24", "75.00", "price_list"]], { daysAgo: 6, cancel: "Customer withdrew the PO (fictional)" });

  // Allocated and shipped orders use the released lotion lot at RVS (fictional opening stock).
  const [rvsFg] = await db.select().from(s.locations).where(and(eq(s.locations.siteId, rvs.id), eq(s.locations.code, "FG-01")));
  const [lotion] = await db
    .select({ lot: s.inventoryLots, qty: s.inventoryBalances.qtyBase })
    .from(s.inventoryBalances)
    .innerJoin(s.inventoryLots, eq(s.inventoryLots.id, s.inventoryBalances.lotId))
    .where(and(eq(s.inventoryBalances.locationId, rvsFg.id), eq(s.inventoryLots.productId, P("AHL-250").id), eq(s.inventoryLots.qualityStatus, "released")))
    .limit(1);
  if (lotion && Number(lotion.qty) >= 72) {
    const allocated = await order("CUS-004", rvs.id, "allocated", [["AHL-250", "48", "140.00", "price_list"]], { daysAgo: 2, deliver: 4, po: "BHD-PO-3290" });
    await db.insert(s.stockAllocations).values({ salesOrderLineId: allocated.lineRows[0].id, lotId: lotion.lot.id, locationId: rvsFg.id, qtyUnits: "48" });
    const shipped = await order("CUS-002", rvs.id, "shipped", [["AHL-250", "24", "155.00", "manual"]], { daysAgo: 5, deliver: -2, po: "ISS-2231" });
    await db.insert(s.stockAllocations).values({ salesOrderLineId: shipped.lineRows[0].id, lotId: lotion.lot.id, locationId: rvsFg.id, qtyUnits: "24" });
    const dr = await nextNo("DR", "DR", 5);
    const [sh] = await db
      .insert(s.shipments)
      .values({ organizationId: O, siteId: rvs.id, salesOrderId: shipped.o.id, deliveryReceiptNumber: dr, carrier: "Partner courier (fictional)", driverName: "Edwin Lacson", vehiclePlate: "RVS 5521", packageCount: 1, dispatchedBy: whRvs, dispatchedAt: ago(3, 14), receivedByName: "Marco Tan", deliveredAt: ago(2, 11) })
      .returning();
    await db.update(s.inventoryBalances).set({ qtyBase: sql`${s.inventoryBalances.qtyBase} - 24` }).where(and(eq(s.inventoryBalances.lotId, lotion.lot.id), eq(s.inventoryBalances.locationId, rvsFg.id)));
    await db.insert(s.stockMovements).values({ organizationId: O, siteId: rvs.id, movementType: "shipment", lotId: lotion.lot.id, fromLocationId: rvsFg.id, qtyBase: "24", baseUom: "pcs", sourceDocumentType: "shipment", sourceDocumentId: sh.id, sourceDocumentNumber: dr, postedBy: whRvs, postedAt: ago(3, 14) });
  }

  // Backfill money totals of the MVP orders (they were seeded before these columns existed).
  await db.execute(sql`
    UPDATE sales_orders o SET subtotal_amount = t.v, total_amount = t.v
    FROM (SELECT sales_order_id, sum(qty_units * unit_price) AS v FROM sales_order_lines GROUP BY sales_order_id) t
    WHERE t.sales_order_id = o.id AND o.organization_id = ${O} AND o.subtotal_amount = 0`);
}
