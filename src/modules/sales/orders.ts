import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { uuidv7 } from "uuidv7";
import { db, type Tx } from "@/db/client";
import {
  SALES_ORDER_STATUSES,
  customerAddresses,
  customers,
  inventoryLots,
  locations,
  products,
  quotes,
  salesOrderLines,
  salesOrderStateTransitions,
  salesOrders,
  shipments,
  stockAllocations,
  users,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { assertMayDeleteDraft, assertNeverSubmittedDraft, hardDeleteDraft } from "@/lib/draft-delete";
import type { ExportDefinition } from "@/lib/export";
import { nextNumber } from "@/lib/numbering";
import { D } from "@/lib/qty";
import { getSetting } from "@/lib/settings";
import { evaluateApprovalRules, evaluateApprovalRulesAudited, sodRequired } from "@/modules/governance";
import { releaseReservationsForDemand } from "@/modules/inventory";
import { notifyRoles, notifyUsers } from "@/modules/platform";
import { approvalProgress, canDecide, recordDecision, stepRoles } from "./crm-approvals";
import { addDaysIso, businessDate, canSeePrices, discountPct, formatAddress, idempotent, isUuid, money, salesTaxRatePct, totals } from "./crm-support";
import { evaluateCredit } from "./credit";
import { resolvePrice } from "./price-lists";
import { itemCodeMap, requirementSnapshot, type RequirementSnapshot } from "./requirements";

/**
 * Sales order state machine (docs/data-model.md §6.5, docs/process-maps.md W09-02..04, W09-12).
 * Only these transitions are allowed; every change goes through `transitionOrder`, which writes a
 * `sales_order_state_transitions` row in the caller's transaction.
 *
 *   draft → submitted → confirmed (within limits) | pending_approval → confirmed
 *   pending_approval → draft (returned for changes, reason)
 *   confirmed → allocated → picking → packed → partially_shipped / shipped → invoiced → closed
 *   allocated → shipped (direct dispatch of the MVP flow); partially_shipped → picking (remainder)
 *   partially_shipped → partially_shipped (another partial dispatch)
 *   invoiced → shipped (W4B: the invoice was voided, with reason)
 *   undo paths (W3E, with reason): allocated → confirmed (allocation released), picking / packed →
 *   allocated | partially_shipped (pick or shipment cancelled before dispatch), shipped /
 *   partially_shipped → allocated | partially_shipped (dispatch reversed)
 *   draft … packed → cancelled (reason; allocations and reservations released)
 *
 * Fulfilment (allocated onwards) belongs to the allocation / picking / packing / dispatch services;
 * this file owns entry, submission, approval and cancellation.
 */
export const ORDER_STATUSES = SALES_ORDER_STATUSES;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["confirmed", "pending_approval", "cancelled"],
  pending_approval: ["confirmed", "draft", "cancelled"],
  confirmed: ["allocated", "cancelled"],
  allocated: ["picking", "shipped", "confirmed", "cancelled"],
  picking: ["packed", "allocated", "partially_shipped", "cancelled"],
  packed: ["partially_shipped", "shipped", "allocated", "cancelled"],
  partially_shipped: ["picking", "shipped", "allocated", "partially_shipped"],
  shipped: ["invoiced", "allocated", "partially_shipped"],
  invoiced: ["closed", "shipped"],
  closed: [],
  cancelled: [],
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  pending_approval: "Pending approval",
  confirmed: "Confirmed",
  allocated: "Allocated",
  picking: "Picking",
  packed: "Packed",
  partially_shipped: "Partially shipped",
  shipped: "Shipped",
  invoiced: "Invoiced",
  closed: "Closed",
  cancelled: "Cancelled",
};

/** Transitions that must carry a reason (§6.1: backward, cancel, exception). */
const REASON_REQUIRED: readonly string[] = [
  "pending_approval>draft",
  "*>cancelled",
  // W3E undo paths: allocation released, pick / shipment cancelled before dispatch, dispatch reversed.
  "allocated>confirmed",
  "picking>allocated",
  "picking>partially_shipped",
  "packed>allocated",
  "shipped>allocated",
  "shipped>partially_shipped",
  "partially_shipped>allocated",
  // W4B: invoice voided (reversal or full credit note).
  "invoiced>shipped",
];

export function isOrderStatus(s: string): s is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(s);
}

export function canOrderTransition(from: string, to: OrderStatus): boolean {
  return isOrderStatus(from) && ORDER_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: string, to: OrderStatus, orderNumber: string) {
  if (!canOrderTransition(from, to)) {
    throw new DomainError("state", `Order ${orderNumber} is ${ORDER_STATUS_LABEL[from as OrderStatus]?.toLowerCase() ?? from} and cannot be moved to ${ORDER_STATUS_LABEL[to].toLowerCase()}.`, {
      machine: "sales_order",
      from,
      to,
    });
  }
}

type OrderRow = typeof salesOrders.$inferSelect;

/**
 * Moves an order to `to` (caller holds the row lock and checked permissions): validates the
 * transition, updates status and the `+status` columns, writes one transition row. Exposed for the
 * fulfilment services (allocation, picking, packing, dispatch) so every state change is logged.
 */
export async function transitionOrder(tx: Tx, ctx: AuthContext, o: Pick<OrderRow, "id" | "status" | "orderNumber" | "siteId" | "organizationId">, to: OrderStatus, opts: { reason?: string | null; set?: Partial<typeof salesOrders.$inferInsert> } = {}) {
  assertTransition(o.status, to, o.orderNumber);
  const reason = opts.reason?.trim() || null;
  if ((REASON_REQUIRED.includes(`${o.status}>${to}`) || (to === "cancelled" && REASON_REQUIRED.includes("*>cancelled"))) && (!reason || reason.length < 3)) {
    throw new DomainError("validation", "Give a reason (at least 3 characters).", { field: "reason" });
  }
  const now = new Date();
  await tx
    .update(salesOrders)
    .set({ ...(opts.set ?? {}), status: to, statusChangedAt: now, statusChangedBy: ctx.userId, updatedAt: now })
    .where(eq(salesOrders.id, o.id));
  await tx.insert(salesOrderStateTransitions).values({
    organizationId: o.organizationId,
    siteId: o.siteId,
    salesOrderId: o.id,
    fromState: o.status,
    toState: to,
    actorId: ctx.userId,
    reason,
    occurredAt: now,
    correlationId: ctx.correlationId && isUuid(ctx.correlationId) ? ctx.correlationId : uuidv7(),
  });
  o.status = to;
  return to;
}

/** Loads and row-locks an order inside a transaction, enforcing site scope. */
export async function lockOrder(tx: Tx, ctx: AuthContext, orderId: string) {
  if (!isUuid(orderId)) throw new DomainError("not_found", "Sales order not found in your sites.");
  const [o] = await tx
    .select()
    .from(salesOrders)
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.organizationId, ctx.organizationId), inArray(salesOrders.siteId, ctx.allowedSiteIds)))
    .for("update")
    .limit(1);
  if (!o) throw new DomainError("not_found", "Sales order not found in your sites.");
  ctx.requireSite(o.siteId);
  return o;
}

/* ------------------------------------------------------------------ queries */

/** `limit`: the list screen shows the newest orders only (W4F load test: the full list of a year of orders took seconds to render). */
export async function listOrders(ctx: AuthContext, status?: string, limit?: number) {
  ctx.require("sales.sales_order.view");
  ctx.requireSite(ctx.currentSiteId);
  const where = [eq(salesOrders.siteId, ctx.currentSiteId)];
  if (status && isOrderStatus(status)) where.push(eq(salesOrders.status, status));
  const orders = await db
    .select({
      id: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      status: salesOrders.status,
      customerPoNumber: salesOrders.customerPoNumber,
      requestedDeliveryOn: salesOrders.requestedDeliveryOn,
      createdAt: salesOrders.createdAt,
      customerName: customers.name,
      customerId: customers.id,
      creditCheckStatus: salesOrders.creditCheckStatus,
      approvalReasons: salesOrders.approvalReasons,
    })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(...where))
    .orderBy(desc(salesOrders.orderNumber))
    .limit(limit ?? 1_000_000);
  const lines = orders.length
    ? await db
        .select({ orderId: salesOrderLines.salesOrderId, sku: products.skuCode, qty: salesOrderLines.qtyUnits, price: salesOrderLines.unitPrice })
        .from(salesOrderLines)
        .innerJoin(products, eq(products.id, salesOrderLines.productId))
        .where(inArray(salesOrderLines.salesOrderId, orders.map((o) => o.id)))
        .orderBy(asc(salesOrderLines.lineNo))
    : [];
  const byOrder = new Map<string, typeof lines>();
  for (const l of lines) byOrder.set(l.orderId, [...(byOrder.get(l.orderId) ?? []), l]);
  const prices = canSeePrices(ctx);
  return orders.map((o) => {
    const ls = byOrder.get(o.id) ?? [];
    const base = { ...o, lines: ls.map((l) => ({ sku: l.sku, qty: l.qty })) };
    if (!prices) return { ...base, value: undefined as string | undefined, _masked: ["value"] as string[] | undefined };
    return { ...base, value: ls.reduce((s, l) => s.plus(D(l.qty).times(l.price)), new Decimal(0)).toString() as string | undefined, _masked: undefined as string[] | undefined };
  });
}

export async function orderCounts(ctx: AuthContext) {
  ctx.require("sales.sales_order.view");
  ctx.requireSite(ctx.currentSiteId);
  const rows = await db
    .select({ status: salesOrders.status, n: sql<number>`count(*)::int` })
    .from(salesOrders)
    .where(eq(salesOrders.siteId, ctx.currentSiteId))
    .groupBy(salesOrders.status);
  const out: Record<string, number> = { all: 0 };
  for (const r of rows) {
    out[r.status] = r.n;
    out.all += r.n;
  }
  return out;
}

/** The order's approval steps (no audit), from the basis stored at submission. */
async function orderApproval(ctx: AuthContext, o: OrderRow) {
  if (o.status !== "pending_approval") return null;
  const basis = (o.approvalBasis ?? {}) as Record<string, string | boolean>;
  const progress = await approvalProgress(db, ctx.organizationId, { recordType: "sales_order", recordId: o.id, siteId: o.siteId, basis });
  const sod = await sodRequired(db, ctx.organizationId, "sales_order");
  return { ...progress, canApprove: canDecide(ctx, "sales_order", progress.next, o.submittedAt, [o.createdBy, o.submittedBy], sod) && ctx.canAt("sales.sales_order.approve", o.siteId), sod };
}

export async function getOrder(ctx: AuthContext, orderId: string) {
  ctx.require("sales.sales_order.view");
  if (!isUuid(orderId)) throw new DomainError("not_found", "Sales order not found in your sites.");
  const [o] = await db
    .select({ order: salesOrders, customer: customers })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.organizationId, ctx.organizationId), inArray(salesOrders.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!o) throw new DomainError("not_found", "Sales order not found in your sites.");
  const lines = await db
    .select({ line: salesOrderLines, product: products })
    .from(salesOrderLines)
    .innerJoin(products, eq(products.id, salesOrderLines.productId))
    .where(eq(salesOrderLines.salesOrderId, o.order.id))
    .orderBy(asc(salesOrderLines.lineNo));
  const allocations = lines.length
    ? await db
        .select({
          id: stockAllocations.id,
          lineId: stockAllocations.salesOrderLineId,
          qtyUnits: stockAllocations.qtyUnits,
          lotId: inventoryLots.id,
          lotNumber: inventoryLots.lotNumber,
          expiresOn: inventoryLots.expiresOn,
          qualityStatus: inventoryLots.qualityStatus,
          locationCode: locations.code,
          locationName: locations.name,
        })
        .from(stockAllocations)
        .innerJoin(inventoryLots, eq(inventoryLots.id, stockAllocations.lotId))
        .innerJoin(locations, eq(locations.id, stockAllocations.locationId))
        .where(and(inArray(stockAllocations.salesOrderLineId, lines.map((l) => l.line.id)), ne(stockAllocations.status, "released")))
        .orderBy(asc(inventoryLots.expiresOn), asc(inventoryLots.lotNumber))
    : [];
  const [shipmentRows, transitions, addresses, quote] = await Promise.all([
    db.select().from(shipments).where(eq(shipments.salesOrderId, o.order.id)).orderBy(desc(shipments.dispatchedAt)),
    db
      .select({ t: salesOrderStateTransitions, actorName: users.displayName })
      .from(salesOrderStateTransitions)
      .innerJoin(users, eq(users.id, salesOrderStateTransitions.actorId))
      .where(eq(salesOrderStateTransitions.salesOrderId, o.order.id))
      .orderBy(asc(salesOrderStateTransitions.occurredAt)),
    db
      .select()
      .from(customerAddresses)
      .where(inArray(customerAddresses.id, [o.order.shipToAddressId, o.order.billToAddressId].filter((x): x is string => !!x).concat(["00000000-0000-0000-0000-000000000000"]))),
    o.order.quoteId ? db.select({ id: quotes.id, quoteNumber: quotes.quoteNumber }).from(quotes).where(eq(quotes.id, o.order.quoteId)).limit(1) : Promise.resolve([]),
  ]);
  const prices = canSeePrices(ctx);
  const lineViews = lines.map(({ line, product }) => {
    const allocated = allocations.filter((a) => a.lineId === line.id).reduce((s, a) => s.plus(a.qtyUnits), new Decimal(0));
    const base = {
      id: line.id,
      lineNo: line.lineNo,
      productId: line.productId,
      qtyUnits: line.qtyUnits,
      sku: product.skuCode,
      productName: product.name,
      unitsPerBox: product.unitsPerBox,
      customerItemCode: line.customerItemCode,
      minRemainingShelfLifeDays: line.minRemainingShelfLifeDays,
      requirementSnapshot: line.requirementSnapshot as RequirementSnapshot | null,
      allocated: allocated.toString(),
      shortfall: Decimal.max(D(line.qtyUnits).minus(allocated), 0).toString(),
    };
    if (!prices) return { ...base, _masked: ["unitPrice", "listUnitPrice", "discountPct", "value", "priceSource"] as string[] };
    return { ...base, unitPrice: line.unitPrice, listUnitPrice: line.listUnitPrice, discountPct: line.discountPct, priceSource: line.priceSource, value: D(line.qtyUnits).times(line.unitPrice).toString() };
  });
  const { subtotalAmount, taxAmount, totalAmount, approvalBasis, ...orderRest } = o.order;
  const order = prices ? { ...orderRest, subtotalAmount, taxAmount, totalAmount } : { ...orderRest, _masked: ["subtotalAmount", "taxAmount", "totalAmount"] as string[] };
  void approvalBasis;
  const { creditLimitAmount, paymentTermsDays, taxIdentifier, ...customerRest } = o.customer;
  const customer = ctx.can("finance.credit_terms.view") ? { ...customerRest, creditLimitAmount, paymentTermsDays, taxIdentifier } : { ...customerRest, _masked: ["creditLimitAmount", "paymentTermsDays", "taxIdentifier"] as string[] };
  const total = prices ? lineViews.reduce((s, l) => s.plus((l as { value?: string }).value ?? 0), new Decimal(0)).toString() : undefined;
  return {
    order,
    customer,
    lines: lineViews,
    allocations: allocations.map((a) => ({ ...a, sku: lineViews.find((l) => l.id === a.lineId)?.sku ?? "" })),
    shipments: shipmentRows,
    transitions: transitions.map((t) => ({ ...t.t, actorName: t.actorName })),
    shipTo: addresses.find((a) => a.id === o.order.shipToAddressId) ?? null,
    billTo: addresses.find((a) => a.id === o.order.billToAddressId) ?? null,
    quote: quote[0] ?? null,
    approval: await orderApproval(ctx, o.order),
    ...(prices ? { total } : { _masked: ["total"] as string[] }),
  } as {
    order: typeof order & Partial<Pick<OrderRow, "subtotalAmount" | "taxAmount" | "totalAmount">>;
    customer: typeof customer & Partial<Pick<typeof o.customer, "creditLimitAmount" | "paymentTermsDays" | "taxIdentifier">>;
    lines: (typeof lineViews[number] & { unitPrice?: string; listUnitPrice?: string | null; discountPct?: string; priceSource?: string; value?: string })[];
    allocations: (typeof allocations[number] & { sku: string })[];
    shipments: typeof shipmentRows;
    transitions: (typeof transitions[number]["t"] & { actorName: string })[];
    shipTo: (typeof addresses)[number] | null;
    billTo: (typeof addresses)[number] | null;
    quote: { id: string; quoteNumber: string } | null;
    approval: Awaited<ReturnType<typeof orderApproval>>;
    total?: string;
    _masked?: string[];
  };
}
export type OrderDetail = Awaited<ReturnType<typeof getOrder>>;

/* ------------------------------------------------------------------ entry */

export type NewOrderInput = {
  customerId: string;
  customerPoNumber?: string | null;
  requestedDeliveryOn: string;
  notes?: string | null;
  shipToAddressId?: string | null;
  billToAddressId?: string | null;
  /** unitPrice empty/omitted → the approved price list price; a given price is a manual price (needs sales.price_list.view). */
  lines: { productId: string; qtyUnits: string; unitPrice?: string | null }[];
  idempotencyKey?: string | null;
};

type PricedLine = {
  productId: string;
  qtyUnits: string;
  unitPrice: string;
  listUnitPrice: string | null;
  priceListId: string | null;
  priceListLineId: string | null;
  priceSource: "price_list" | "manual" | "quote";
  discountPct: string;
  customerItemCode: string | null;
};

/** Resolves every line's price (list, or manual where allowed) and checks the products. */
async function priceLines(tx: Tx, ctx: AuthContext, customerId: string, lines: NewOrderInput["lines"], opts: { quotePrices?: Map<string, string> } = {}): Promise<PricedLine[]> {
  if (lines.length === 0) throw new DomainError("validation", "Add at least one line.", { field: "lines" });
  const productIds = [...new Set(lines.map((l) => l.productId))];
  if (productIds.length !== lines.length) throw new DomainError("validation", "Each product may appear only once; combine the quantities into one line.", { field: "lines" });
  const prods = await tx
    .select({ id: products.id, name: products.name, status: products.status })
    .from(products)
    .where(and(inArray(products.id, productIds), eq(products.organizationId, ctx.organizationId)));
  if (prods.length !== productIds.length) throw new DomainError("validation", "One of the products was not found.", { field: "lines" });
  // W2G (US-1-22): only active products are sold; draft and discontinued ones are refused.
  const notSold = prods.filter((p) => p.status !== "active");
  if (notSold.length) throw new DomainError("validation", `Not available for sale: ${notSold.map((p) => `${p.name} (${p.status})`).join(", ")}.`, { field: "lines" });
  const allowManual = await getSetting(tx, ctx.organizationId, "sales.order.allow_manual_price");
  const codes = await itemCodeMap(tx, customerId, productIds);
  const out: PricedLine[] = [];
  const fieldErrors: Record<string, string> = {};
  for (const [i, l] of lines.entries()) {
    const qty = D(l.qtyUnits);
    if (!qty.isInteger() || qty.lte(0)) {
      fieldErrors[`lines.${i}.qtyUnits`] = "Whole pieces, at least 1.";
      continue;
    }
    const list = await resolvePrice(tx, ctx.organizationId, customerId, l.productId, qty);
    const fromQuote = opts.quotePrices?.get(l.productId);
    const manual = l.unitPrice !== undefined && l.unitPrice !== null && String(l.unitPrice).trim() !== "" ? String(l.unitPrice).trim() : null;
    let unitPrice: string;
    let source: PricedLine["priceSource"];
    if (fromQuote !== undefined) {
      unitPrice = fromQuote;
      source = "quote";
    } else if (manual !== null && (!list || !D(manual).eq(list.unitAmount))) {
      if (!canSeePrices(ctx)) throw new DomainError("forbidden", "Only users who may see prices can enter a price (sales.price_list.view).");
      if (!/^\d{1,9}(\.\d{1,2})?$/.test(manual)) {
        fieldErrors[`lines.${i}.unitPrice`] = "Price in pesos, up to 2 decimals.";
        continue;
      }
      if (!list && !allowManual) {
        fieldErrors[`lines.${i}.unitPrice`] = "No approved price list price for this product; manual prices are switched off.";
        continue;
      }
      unitPrice = money(manual);
      source = "manual";
    } else if (list) {
      unitPrice = list.unitAmount;
      source = "price_list";
    } else {
      fieldErrors[`lines.${i}.unitPrice`] = allowManual ? "No approved price for this customer and product. Enter the agreed price." : "No approved price list price for this product.";
      continue;
    }
    out.push({
      productId: l.productId,
      qtyUnits: qty.toString(),
      unitPrice,
      listUnitPrice: list?.unitAmount ?? null,
      priceListId: list?.priceListId ?? null,
      priceListLineId: list?.priceListLineId ?? null,
      priceSource: source,
      discountPct: discountPct(list?.unitAmount ?? null, unitPrice),
      customerItemCode: codes.get(l.productId) ?? null,
    });
  }
  if (Object.keys(fieldErrors).length) throw new DomainError("validation", Object.values(fieldErrors)[0], { fieldErrors });
  return out;
}

async function resolveAddresses(tx: Tx, customer: { id: string; shipToAddress: string }, shipToAddressId?: string | null, billToAddressId?: string | null) {
  const addrs = await tx.select().from(customerAddresses).where(and(eq(customerAddresses.customerId, customer.id), sql`${customerAddresses.deletedAt} is null`));
  const pick = (id: string | null | undefined, kind: "ship" | "bill") => {
    if (id) {
      const a = addrs.find((x) => x.id === id);
      if (!a) throw new DomainError("validation", "Choose one of the customer's addresses.", { field: kind === "ship" ? "shipToAddressId" : "billToAddressId" });
      return a;
    }
    return addrs.find((x) => (kind === "ship" ? x.isDefaultShipTo : x.isDefaultBillTo)) ?? null;
  };
  const ship = pick(shipToAddressId, "ship");
  const bill = pick(billToAddressId, "bill");
  return { shipToAddressId: ship?.id ?? null, billToAddressId: bill?.id ?? null, shipToText: ship ? formatAddress(ship) : customer.shipToAddress };
}

async function insertOrderLines(tx: Tx, orderId: string, lines: PricedLine[]) {
  return tx
    .insert(salesOrderLines)
    .values(
      lines.map((l, i) => ({
        salesOrderId: orderId,
        lineNo: i + 1,
        productId: l.productId,
        qtyUnits: l.qtyUnits,
        unitPrice: l.unitPrice,
        listUnitPrice: l.listUnitPrice,
        priceListId: l.priceListId,
        priceListLineId: l.priceListLineId,
        priceSource: l.priceSource,
        discountPct: l.discountPct,
        customerItemCode: l.customerItemCode,
      })),
    )
    .returning();
}

async function loadSellableCustomer(tx: Tx, ctx: AuthContext, customerId: string) {
  if (!isUuid(customerId)) throw new DomainError("validation", "Choose a customer.", { field: "customerId" });
  const [c] = await tx.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId))).limit(1);
  if (!c) throw new DomainError("validation", "Choose a customer.", { field: "customerId" });
  if (c.status === "inactive") throw new DomainError("validation", `${c.name} is inactive. Reactivate the customer before entering orders.`, { field: "customerId" });
  return c;
}

/** Creates a draft order at the current site (W09-02); prices resolve from the approved price lists. */
export async function createOrder(ctx: AuthContext, input: NewOrderInput & { quoteId?: string | null; quotePrices?: Map<string, string>; siteId?: string }) {
  ctx.require("sales.sales_order.create");
  return db.transaction((tx) => createOrderInTx(tx, ctx, input));
}

/** createOrder inside the caller's transaction (quote conversion creates the order and converts the quote atomically). */
export async function createOrderInTx(tx: Tx, ctx: AuthContext, input: NewOrderInput & { quoteId?: string | null; quotePrices?: Map<string, string>; siteId?: string }) {
  ctx.require("sales.sales_order.create");
  const siteId = input.siteId ?? ctx.currentSiteId;
  ctx.requireAt("sales.sales_order.create", siteId);
  {
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "sales.sales_order.create", async () => {
      const c = await loadSellableCustomer(tx, ctx, input.customerId);
      const priced = await priceLines(tx, ctx, c.id, input.lines, { quotePrices: input.quotePrices });
      const addr = await resolveAddresses(tx, c, input.shipToAddressId, input.billToAddressId);
      const rate = await salesTaxRatePct(tx, ctx.organizationId);
      const t = totals(priced.map((l) => ({ qty: l.qtyUnits, price: l.unitPrice })), rate);
      const orderNumber = await nextNumber(tx, ctx.organizationId, "SO");
      const [order] = await tx
        .insert(salesOrders)
        .values({
          organizationId: ctx.organizationId,
          siteId,
          orderNumber,
          customerId: c.id,
          customerPoNumber: input.customerPoNumber || null,
          requestedDeliveryOn: input.requestedDeliveryOn,
          status: "draft",
          notes: input.notes || null,
          createdBy: ctx.userId,
          ...addr,
          quoteId: input.quoteId ?? null,
          currency: c.currency || "PHP",
          subtotalAmount: t.subtotal,
          taxAmount: t.tax,
          totalAmount: t.total,
          creditCheckStatus: "pending",
          statusChangedBy: ctx.userId,
        })
        .returning();
      const lineRows = await insertOrderLines(tx, order.id, priced);
      await tx.insert(salesOrderStateTransitions).values({
        organizationId: order.organizationId,
        siteId: order.siteId,
        salesOrderId: order.id,
        fromState: null,
        toState: "draft",
        actorId: ctx.userId,
        correlationId: ctx.correlationId && isUuid(ctx.correlationId) ? ctx.correlationId : uuidv7(),
      });
      await audit(tx, ctx, {
        action: "sales.sales_order.created",
        entityType: "sales_order",
        entityId: order.id,
        entityNumber: orderNumber,
        siteId: order.siteId,
        after: { ...order, lines: lineRows },
      });
      return { id: order.id };
    });
    const [order] = await tx.select().from(salesOrders).where(eq(salesOrders.id, result.id));
    return order;
  }
}

/** Edits a draft order (header and all lines); prices resolve again. */
export async function editOrder(ctx: AuthContext, orderId: string, input: Omit<NewOrderInput, "idempotencyKey">) {
  ctx.require("sales.sales_order.edit");
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, orderId);
    ctx.requireAt("sales.sales_order.edit", o.siteId);
    if (o.status !== "draft") throw new DomainError("state", `Order ${o.orderNumber} is ${ORDER_STATUS_LABEL[o.status as OrderStatus]?.toLowerCase() ?? o.status}; only a draft can be changed.`);
    if (input.customerId !== o.customerId) throw new DomainError("validation", "The customer of an order cannot change. Cancel it and enter a new order.", { field: "customerId" });
    const c = await loadSellableCustomer(tx, ctx, o.customerId);
    const priced = await priceLines(tx, ctx, c.id, input.lines);
    const addr = await resolveAddresses(tx, c, input.shipToAddressId, input.billToAddressId);
    const rate = await salesTaxRatePct(tx, ctx.organizationId);
    const t = totals(priced.map((l) => ({ qty: l.qtyUnits, price: l.unitPrice })), rate);
    const beforeLines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, o.id));
    await tx.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, o.id));
    const lineRows = await insertOrderLines(tx, o.id, priced);
    await tx
      .update(salesOrders)
      .set({ customerPoNumber: input.customerPoNumber || null, requestedDeliveryOn: input.requestedDeliveryOn, notes: input.notes || null, ...addr, subtotalAmount: t.subtotal, taxAmount: t.tax, totalAmount: t.total, updatedAt: new Date() })
      .where(eq(salesOrders.id, o.id));
    await audit(tx, ctx, {
      action: "sales.sales_order.updated",
      entityType: "sales_order",
      entityId: o.id,
      entityNumber: o.orderNumber,
      siteId: o.siteId,
      before: { customerPoNumber: o.customerPoNumber, requestedDeliveryOn: o.requestedDeliveryOn, lines: beforeLines },
      after: { customerPoNumber: input.customerPoNumber || null, requestedDeliveryOn: input.requestedDeliveryOn, lines: lineRows },
    });
  });
}

/* ------------------------------------------------------------------ submission and approval */

export type SubmitResult = { orderNumber: string; status: "confirmed" | "pending_approval"; reasons: { code: string; message: string }[]; warnings: { code: string; message: string }[] };

/**
 * Submits a draft (W09-02/03, US-4-05 AC1): applies the customer's approved requirements to each
 * line (snapshot), checks MOQ (warn or block per `sales.order.moq_policy`) and lead time (warning),
 * runs the credit check and the `approval_rules` (`sales_order`: credit check failed, order amount,
 * line discount). No step → confirmed; otherwise pending_approval with the reasons shown, and the
 * approvers are notified. Two transitions are written (draft → submitted → confirmed/pending).
 */
export async function submitOrder(ctx: AuthContext, orderId: string, opts: { idempotencyKey?: string | null } = {}): Promise<SubmitResult> {
  ctx.require("sales.sales_order.submit");
  return db.transaction((tx) => submitOrderInTx(tx, ctx, orderId, opts));
}

/** submitOrder inside the caller's transaction (W4E: a portal order is created and submitted atomically). */
export async function submitOrderInTx(tx: Tx, ctx: AuthContext, orderId: string, opts: { idempotencyKey?: string | null } = {}): Promise<SubmitResult> {
  ctx.require("sales.sales_order.submit");
  {
    const { result } = await idempotent(tx, ctx, opts.idempotencyKey, "sales.sales_order.submit", async () => {
      const o = await lockOrder(tx, ctx, orderId);
      ctx.requireAt("sales.sales_order.submit", o.siteId);
      assertTransition(o.status, "submitted", o.orderNumber);
      const [c] = await tx.select().from(customers).where(eq(customers.id, o.customerId)).for("update");
      if (c.status === "inactive") throw new DomainError("state", `${c.name} is inactive; the order cannot be submitted.`);
      const lines = await tx
        .select({ line: salesOrderLines, sku: products.skuCode, status: products.status })
        .from(salesOrderLines)
        .innerJoin(products, eq(products.id, salesOrderLines.productId))
        .where(eq(salesOrderLines.salesOrderId, o.id))
        .orderBy(asc(salesOrderLines.lineNo));
      if (lines.length === 0) throw new DomainError("validation", "The order has no lines.");
      const inactive = lines.filter((l) => l.status !== "active");
      if (inactive.length) throw new DomainError("validation", `Not available for sale any more: ${inactive.map((l) => l.sku).join(", ")}. Edit the order.`);

      // Requirements (US-4-02): snapshot per line; MOQ and lead time checks.
      const today = businessDate();
      const warnings: { code: string; message: string }[] = [];
      const moqPolicy = await getSetting(tx, ctx.organizationId, "sales.order.moq_policy");
      const moqErrors: string[] = [];
      for (const l of lines) {
        const snap = await requirementSnapshot(tx, ctx.organizationId, c.id, l.line.productId, c.minShelfLifeDays, today);
        await tx.update(salesOrderLines).set({ requirementSnapshot: snap, minRemainingShelfLifeDays: snap.minRemainingShelfLifeDays }).where(eq(salesOrderLines.id, l.line.id));
        if (snap.moq !== null && D(l.line.qtyUnits).lt(snap.moq)) {
          const msg = `${l.sku}: ${D(l.line.qtyUnits).toString()} pcs is below the customer's minimum order of ${snap.moq} pcs`;
          if (moqPolicy === "block") moqErrors.push(msg);
          else warnings.push({ code: "moq", message: msg });
        }
        const lead = snap.leadTimeDays ?? c.defaultLeadTimeDays;
        if (lead && o.requestedDeliveryOn && o.requestedDeliveryOn < addDaysIso(today, lead)) {
          warnings.push({ code: "lead_time", message: `${l.sku}: requested delivery is inside the ${lead}-day lead time` });
        }
      }
      if (moqErrors.length) throw new DomainError("validation", `Below the minimum order quantity: ${moqErrors.join("; ")}.`, { field: "lines" });

      const rate = await salesTaxRatePct(tx, ctx.organizationId);
      const t = totals(lines.map((l) => ({ qty: l.line.qtyUnits, price: l.line.unitPrice })), rate);
      const credit = await evaluateCredit(tx, ctx.organizationId, c, t.total, o.id);
      const maxDiscount = lines.reduce((m, l) => Decimal.max(m, l.line.discountPct), new Decimal(0));
      const basis = { amount: t.total, credit_check_failed: credit.failed, discount_pct: maxDiscount.toString() };
      const now = new Date();
      await transitionOrder(tx, ctx, o, "submitted", { set: { submittedBy: ctx.userId, submittedAt: now, subtotalAmount: t.subtotal, taxAmount: t.tax, totalAmount: t.total } });
      await audit(tx, ctx, {
        action: "sales.sales_order.submitted",
        entityType: "sales_order",
        entityId: o.id,
        entityNumber: o.orderNumber,
        siteId: o.siteId,
        before: { status: "draft" },
        after: { status: "submitted", total: t.total, creditCheck: credit.status, warnings },
      });
      const progress = await approvalProgress(tx, ctx.organizationId, { recordType: "sales_order", recordId: o.id, siteId: o.siteId, basis });
      // The evaluation is audited with the rule ids (US-1-14 AC2).
      await evaluateApprovalRulesAudited(tx, ctx, { documentType: "sales_order", siteId: o.siteId, basis, recordId: o.id, recordNumber: o.orderNumber });
      // Plain-words reasons: which part of the basis made a rule match.
      const reasons: { code: string; message: string }[] = [...credit.reasons];
      if (progress.steps.length) {
        const only = async (b: Record<string, string | boolean>) => (await evaluateApprovalRules(tx, ctx.organizationId, { documentType: "sales_order", siteId: o.siteId, basis: b })).steps.length > 0;
        if (await only({ amount: t.total })) reasons.push({ code: "amount", message: "Order value above the approval threshold" });
        if (maxDiscount.gt(0) && (await only({ discount_pct: maxDiscount.toString() }))) reasons.push({ code: "discount", message: `Price ${maxDiscount.toDecimalPlaces(1).toString()} % below the price list` });
      }
      if (progress.steps.length === 0) {
        await transitionOrder(tx, ctx, o, "confirmed", { set: { confirmedBy: ctx.userId, creditCheckStatus: credit.status, approvalReasons: null, approvalBasis: basis, warnings: warnings.length ? warnings : null } });
        await audit(tx, ctx, {
          action: "sales.sales_order.confirmed",
          entityType: "sales_order",
          entityId: o.id,
          entityNumber: o.orderNumber,
          siteId: o.siteId,
          before: { status: "submitted" },
          after: { status: "confirmed", auto: true, creditCheck: credit.status },
        });
        await notifyRoles(tx, { roleCodes: ["warehouse_operator"], siteId: o.siteId }, {
          organizationId: ctx.organizationId,
          siteId: o.siteId,
          kind: "sales_order_confirmed",
          severity: "info",
          title: `Order ${o.orderNumber} confirmed`,
          body: `${c.name}: allocate and pick for delivery on ${o.requestedDeliveryOn ?? "the requested date"}.`,
          entityType: "sales_order",
          entityId: o.id,
          link: `/sales/${o.id}`,
        });
        return { orderNumber: o.orderNumber, status: "confirmed" as const, reasons: [], warnings };
      }
      const why = reasons.length ? reasons : progress.steps.map((s) => ({ code: "rule", message: s.label }));
      await transitionOrder(tx, ctx, o, "pending_approval", { set: { creditCheckStatus: credit.status, approvalReasons: why, approvalBasis: basis, warnings: warnings.length ? warnings : null } });
      const roles = stepRoles(progress.next);
      await notifyRoles(tx, { roleCodes: roles.length ? roles : ["owner_director"], siteId: o.siteId }, {
        organizationId: ctx.organizationId,
        siteId: o.siteId,
        kind: "approval_requested",
        severity: "warning",
        title: `Order ${o.orderNumber} needs approval`,
        body: `${c.name}: ${why.map((w) => w.message).join("; ")}.`,
        entityType: "sales_order",
        entityId: o.id,
        link: `/sales/${o.id}`,
      });
      return { orderNumber: o.orderNumber, status: "pending_approval" as const, reasons: why, warnings };
    });
    return result;
  }
}

/**
 * Approves a pending order (W09-03): the approver holds `sales.sales_order.approve` at the order's
 * site and the step's role (finance by default; owner_director after the escalation delay), and is
 * not the creator or submitter while `approvals.sod.sales_order` is on (A-PM-14). The final step
 * confirms the order (`sales.sales_order.confirmed`).
 */
export async function approveOrder(ctx: AuthContext, orderId: string, opts: { note?: string | null; idempotencyKey?: string | null } = {}) {
  ctx.require("sales.sales_order.approve");
  return db.transaction(async (tx) => {
    const { result } = await idempotent(tx, ctx, opts.idempotencyKey, "sales.sales_order.approve", async () => {
      const o = await lockOrder(tx, ctx, orderId);
      assertTransition(o.status, "confirmed", o.orderNumber);
      if (o.status !== "pending_approval") throw new DomainError("state", `Order ${o.orderNumber} is not waiting for approval.`);
      const sod = await sodRequired(tx, ctx.organizationId, "sales_order");
      const r = await recordDecision(tx, ctx, {
        recordType: "sales_order",
        recordId: o.id,
        recordNumber: o.orderNumber,
        siteId: o.siteId,
        basis: (o.approvalBasis ?? {}) as Record<string, string | boolean>,
        pendingSince: o.submittedAt,
        excludedUserIds: [o.createdBy, o.submittedBy],
        sod,
        decision: "approved",
        note: opts.note,
      });
      if (!r.final) {
        await audit(tx, ctx, { action: "sales.sales_order.step_approved", entityType: "sales_order", entityId: o.id, entityNumber: o.orderNumber, siteId: o.siteId, after: { step: r.step?.step } });
        return { orderNumber: o.orderNumber, confirmed: false };
      }
      const now = new Date();
      const creditStatus = o.creditCheckStatus === "failed" ? "overridden" : o.creditCheckStatus;
      await transitionOrder(tx, ctx, o, "confirmed", { reason: opts.note ?? null, set: { confirmedBy: ctx.userId, approvedBy: ctx.userId, approvedAt: now, approvalNote: opts.note?.trim() || null, creditCheckStatus: creditStatus } });
      await audit(tx, ctx, {
        action: "sales.sales_order.confirmed",
        entityType: "sales_order",
        entityId: o.id,
        entityNumber: o.orderNumber,
        siteId: o.siteId,
        before: { status: "pending_approval", creditCheck: o.creditCheckStatus },
        after: { status: "confirmed", approvedBy: ctx.userId, creditCheck: creditStatus, reasons: o.approvalReasons },
      });
      if (o.submittedBy) {
        await notifyUsers(tx, [o.submittedBy], { organizationId: ctx.organizationId, siteId: o.siteId, kind: "sales_order_approved", severity: "info", title: `Order ${o.orderNumber} approved`, body: `${ctx.displayName} approved the order; it is confirmed.`, entityType: "sales_order", entityId: o.id, link: `/sales/${o.id}` });
      }
      await notifyRoles(tx, { roleCodes: ["warehouse_operator"], siteId: o.siteId }, { organizationId: ctx.organizationId, siteId: o.siteId, kind: "sales_order_confirmed", severity: "info", title: `Order ${o.orderNumber} confirmed`, body: "Allocate and pick.", entityType: "sales_order", entityId: o.id, link: `/sales/${o.id}` });
      return { orderNumber: o.orderNumber, confirmed: true };
    });
    return result;
  });
}

/** Returns a pending order to draft for changes (approver decision with reason). */
export async function returnOrderToDraft(ctx: AuthContext, orderId: string, reason: string) {
  ctx.require("sales.sales_order.approve");
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, orderId);
    assertTransition(o.status, "draft", o.orderNumber);
    const sod = await sodRequired(tx, ctx.organizationId, "sales_order");
    await recordDecision(tx, ctx, {
      recordType: "sales_order",
      recordId: o.id,
      recordNumber: o.orderNumber,
      siteId: o.siteId,
      basis: (o.approvalBasis ?? {}) as Record<string, string | boolean>,
      pendingSince: o.submittedAt,
      excludedUserIds: [o.createdBy, o.submittedBy],
      sod,
      decision: "returned",
      note: reason,
    });
    await transitionOrder(tx, ctx, o, "draft", { reason, set: { creditCheckStatus: "pending" } });
    await audit(tx, ctx, { action: "sales.sales_order.returned", entityType: "sales_order", entityId: o.id, entityNumber: o.orderNumber, siteId: o.siteId, reason: reason.trim(), before: { status: "pending_approval" }, after: { status: "draft" } });
    if (o.submittedBy) {
      await notifyUsers(tx, [o.submittedBy], { organizationId: ctx.organizationId, siteId: o.siteId, kind: "sales_order_returned", severity: "warning", title: `Order ${o.orderNumber} returned`, body: reason.trim(), entityType: "sales_order", entityId: o.id, link: `/sales/${o.id}` });
    }
  });
}

/**
 * Back-compatible confirm (MVP callers): a draft is submitted (auto-confirms within limits), a
 * pending order is approved. Prefer submitOrder / approveOrder.
 */
export async function confirmOrder(ctx: AuthContext, orderId: string) {
  const [o] = isUuid(orderId) ? await db.select({ status: salesOrders.status }).from(salesOrders).where(and(eq(salesOrders.id, orderId), eq(salesOrders.organizationId, ctx.organizationId))).limit(1) : [];
  if (o?.status === "pending_approval") return approveOrder(ctx, orderId);
  if (o?.status === "draft") return submitOrder(ctx, orderId);
  ctx.require("sales.sales_order.submit");
  return db.transaction(async (tx) => {
    const locked = await lockOrder(tx, ctx, orderId);
    assertTransition(locked.status, "submitted", locked.orderNumber);
  });
}

/** States from which an order can still be cancelled (W09-12); after dispatch only a return applies. */
export const CANCELLABLE: readonly OrderStatus[] = ["draft", "submitted", "pending_approval", "confirmed", "allocated", "picking", "packed"];

/**
 * Cancels an order before dispatch (US-4-05 AC2): allocations (reservations of stock, not postings)
 * are deleted and inventory reservations of its lines released; `sales.sales_order.cancelled` carries
 * the reason. From `partially_shipped` on it is 409 (return path only).
 */
export async function cancelOrder(ctx: AuthContext, orderId: string, reason: string) {
  ctx.require("sales.sales_order.void");
  if (!reason?.trim()) throw new DomainError("validation", "Give a reason for cancelling.", { field: "reason" });
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, orderId);
    const from = o.status;
    ctx.requireAt("sales.sales_order.void", o.siteId);
    if (!CANCELLABLE.includes(o.status as OrderStatus)) {
      throw new DomainError("state", `Order ${o.orderNumber} is ${ORDER_STATUS_LABEL[o.status as OrderStatus]?.toLowerCase() ?? o.status}. After dispatch an order cannot be cancelled; record a customer return instead.`, { machine: "sales_order", from: o.status, to: "cancelled" });
    }
    const lineIds = (await tx.select({ id: salesOrderLines.id }).from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, o.id))).map((l) => l.id);
    // W3E: allocations are released with the reason, never deleted (pick lines and shipment lines may reference them).
    const released = lineIds.length
      ? await tx
          .update(stockAllocations)
          .set({ status: "released", releasedAt: new Date(), releasedBy: ctx.userId, releaseReason: `Order cancelled: ${reason.trim()}` })
          .where(and(inArray(stockAllocations.salesOrderLineId, lineIds), eq(stockAllocations.status, "open")))
          .returning()
      : [];
    let reservations = 0;
    for (const id of lineIds) reservations += await releaseReservationsForDemand(tx, ctx, "sales_order_line", id, `Order ${o.orderNumber} cancelled: ${reason.trim()}`);
    await transitionOrder(tx, ctx, o, "cancelled", { reason: reason.trim(), set: { cancelReason: reason.trim() } });
    await audit(tx, ctx, {
      action: "sales.sales_order.cancelled",
      entityType: "sales_order",
      entityId: o.id,
      entityNumber: o.orderNumber,
      siteId: o.siteId,
      reason,
      before: { status: from, allocations: released, reservationsReleased: reservations },
      after: { status: "cancelled" },
    });
  });
}

/** Order history of one customer across the user's sites. */
export async function listCustomerOrders(ctx: AuthContext, customerId: string) {
  ctx.require("sales.sales_order.view");
  if (!isUuid(customerId)) return [];
  const orders = await db
    .select({
      id: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      status: salesOrders.status,
      customerPoNumber: salesOrders.customerPoNumber,
      requestedDeliveryOn: salesOrders.requestedDeliveryOn,
      createdAt: salesOrders.createdAt,
      siteId: salesOrders.siteId,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.customerId, customerId), eq(salesOrders.organizationId, ctx.organizationId), inArray(salesOrders.siteId, ctx.allowedSiteIds)))
    .orderBy(desc(salesOrders.orderNumber));
  const lines = orders.length
    ? await db
        .select({ orderId: salesOrderLines.salesOrderId, qty: salesOrderLines.qtyUnits, price: salesOrderLines.unitPrice })
        .from(salesOrderLines)
        .where(inArray(salesOrderLines.salesOrderId, orders.map((o) => o.id)))
    : [];
  const prices = canSeePrices(ctx);
  return orders.map((o) =>
    prices
      ? { ...o, value: lines.filter((l) => l.orderId === o.id).reduce((s, l) => s.plus(D(l.qty).times(l.price)), new Decimal(0)).toString() as string | undefined }
      : { ...o, value: undefined as string | undefined, _masked: ["value"] },
  );
}

/** "Reorder from history" (US-4-04 AC1): a new draft with the same lines at today's prices, at the original order's site. */
export async function reorderFromOrder(ctx: AuthContext, orderId: string, input: { requestedDeliveryOn: string; idempotencyKey?: string | null }) {
  ctx.require("sales.sales_order.create");
  if (!isUuid(orderId)) throw new DomainError("not_found", "Sales order not found in your sites.");
  const [o] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, orderId), eq(salesOrders.organizationId, ctx.organizationId), inArray(salesOrders.siteId, ctx.allowedSiteIds))).limit(1);
  if (!o) throw new DomainError("not_found", "Sales order not found in your sites.");
  const lines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, o.id)).orderBy(asc(salesOrderLines.lineNo));
  return createOrder(ctx, {
    customerId: o.customerId,
    customerPoNumber: null,
    requestedDeliveryOn: input.requestedDeliveryOn,
    notes: `Reorder of ${o.orderNumber}`,
    shipToAddressId: o.shipToAddressId,
    billToAddressId: o.billToAddressId,
    lines: lines.map((l) => ({ productId: l.productId, qtyUnits: D(l.qtyUnits).toString(), unitPrice: null })),
    idempotencyKey: input.idempotencyKey,
    siteId: o.siteId,
  });
}

/** Orders waiting for approval that the caller could decide (approval queue). */
export async function ordersAwaitingApproval(ctx: AuthContext) {
  if (!ctx.can("sales.sales_order.approve")) return [];
  const rows = await db
    .select({ o: salesOrders, customerName: customers.name })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(salesOrders.organizationId, ctx.organizationId), inArray(salesOrders.siteId, ctx.allowedSiteIds), eq(salesOrders.status, "pending_approval")))
    .orderBy(asc(salesOrders.submittedAt));
  return rows.map((r) => ({ id: r.o.id, orderNumber: r.o.orderNumber, customerName: r.customerName, submittedAt: r.o.submittedAt, reasons: r.o.approvalReasons ?? [], siteId: r.o.siteId }));
}

type OrderExportRow = Awaited<ReturnType<typeof listOrders>>[number];

/** Sales orders of the current site (sales.sales_order.export, S): the value column needs sales.price_list.view. */
export const ordersExport: ExportDefinition<{ status?: string }, OrderExportRow> = {
  code: "sales.sales_orders",
  title: "Sales orders",
  permission: "sales.sales_order.export",
  sensitivity: "S",
  columns: [
    { header: "Order", value: (r) => r.orderNumber },
    { header: "Status", value: (r) => r.status },
    { header: "Customer", value: (r) => r.customerName },
    { header: "Customer PO", value: (r) => r.customerPoNumber },
    { header: "Requested delivery", value: (r) => r.requestedDeliveryOn },
    { header: "Lines", value: (r) => r.lines.map((l) => `${l.sku} x ${D(l.qty).toString()}`).join("; ") },
    { header: "Credit check", value: (r) => r.creditCheckStatus },
    { header: "Value", value: (r) => r.value, numeric: true, requires: "sales.price_list.view" },
  ],
  fetch: async (ctx, f, limit) => (await listOrders(ctx, f.status)).slice(0, limit),
  siteScope: (ctx) => [ctx.currentSiteId],
  fileName: () => "sales-orders",
};

/**
 * Deletes a sales order that is a never-submitted draft (ADR-075), with its lines and its state
 * history. Creator (sales.sales_order.create) or sales.sales_order.edit at the order's site.
 * Audit sales.sales_order.deleted with the order and lines in `before`.
 */
export async function deleteDraftOrder(ctx: AuthContext, orderId: string) {
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, orderId);
    assertMayDeleteDraft(ctx, { create: "sales.sales_order.create", manage: ["sales.sales_order.edit"] }, o.createdBy, o.siteId);
    assertNeverSubmittedDraft(`Sales order ${o.orderNumber}`, o.status === "draft", o.submittedAt);
    const lines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, o.id));
    await hardDeleteDraft(tx, ctx, {
      table: "sales_orders",
      id: o.id,
      what: `Sales order ${o.orderNumber}`,
      children: [
        { table: "sales_order_lines", column: "sales_order_id" },
        { table: "sales_order_state_transitions", column: "sales_order_id" },
      ],
      audit: { action: "sales.sales_order.deleted", entityType: "sales_order", entityNumber: o.orderNumber, siteId: o.siteId, before: { ...o, lines } },
    });
    return { deleted: o.orderNumber };
  });
}
