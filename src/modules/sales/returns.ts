import "server-only";
import { and, asc, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import Decimal from "decimal.js";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  complaintLinks,
  complaints,
  containers,
  customerReturnLines,
  customerReturnStateTransitions,
  customerReturns,
  customers,
  dispositions,
  idempotencyKeys,
  inventoryLots,
  locations,
  organizations,
  products,
  salesOrders,
  shipments,
  sites,
  users,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { allowedDestinationKinds, lockLots, postMovement } from "@/modules/inventory";
import { assertReasonCode, reasonCodeOptions, reasonLabels } from "@/modules/masterdata";
import { notifyRoles } from "@/modules/platform";
import { RETURN_CONDITION_LABEL, RETURN_STATUS_LABEL, canMoveReturn, type CustomerReturnStatus, type ReturnLineCondition } from "./returns-rules";
import { LEFT_SITE_SHIPMENT_STATUSES, applyShipmentReturned, lotsOfBox, returnedQtyByLot, shipmentInScope, shipmentReturnState, shipmentsOfBox, shippedLotsOf } from "./returns-shipments";

/**
 * Customer returns received by scan into quarantine (US-4-16, process maps W09-11 and W07-09).
 *
 * 1. warehouse_operator or sales_cs opens a draft against the shipment (DR) and scans the returned boxes
 *    or lots (quantity per line; never more than was shipped minus what other returns already name: V-OVER).
 * 2. submit → approve (sales.customer_return.approve, S; approver ≠ creator/submitter while setting
 *    approvals.sod.customer_return is on, A-PM-14) → post (sales.customer_return.post, S).
 * 3. Posting, in one transaction: each line becomes a new lot in `quarantine` re-lotted from the shipped lot
 *    (origin_lot_id, genealogy edge `returned`) and a `return` movement through postMovement into a
 *    quarantine-class location (setting sales.customer_return.location_kinds ∩ the location-class rule);
 *    the shipment is marked returned (partial allowed) through `applyShipmentReturned` (integration contract).
 * 4. QA dispositions each return lot with the normal lot decisions (W06); the return then moves
 *    received → inspected → closed. Credit notes wait for Phase 6.
 */

type ReturnRow = typeof customerReturns.$inferSelect;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const QTY_RE = /^\d{1,12}(\.\d{1,6})?$/;

const creator = alias(users, "return_creator");
const approver = alias(users, "return_approver");
const poster = alias(users, "return_poster");

function text(v: string | null | undefined, field: string, max: number, min = 0): string | null {
  const t = (v ?? "").trim();
  if (!t) {
    if (min > 0) throw new DomainError("validation", `Give at least ${min} characters.`, { field });
    return null;
  }
  if (t.length < min) throw new DomainError("validation", `Give at least ${min} characters.`, { field });
  if (t.length > max) throw new DomainError("validation", `Too long (max ${max} characters).`, { field });
  return t;
}

/** Same idempotency contract as the other modules (ADR-009): the stored result is returned on repeat. */
async function withKey<T extends object>(tx: Tx, ctx: AuthContext, key: string | null | undefined, command: string, fn: () => Promise<T>): Promise<T & { replayed: boolean }> {
  if (!key) return { ...(await fn()), replayed: false };
  if (key.length > 200) throw new DomainError("validation", "The request key is too long.");
  const full = `${command}:${key}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${full}))`);
  const inserted = await tx.insert(idempotencyKeys).values({ organizationId: ctx.organizationId, key: full, command }).onConflictDoNothing().returning({ id: idempotencyKeys.id });
  if (!inserted.length) {
    const [row] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.organizationId, ctx.organizationId), eq(idempotencyKeys.key, full))).limit(1);
    if (!row || row.command !== command || !row.result) throw new DomainError("conflict", "This request key was already used for a different action. Reload the page and try again.");
    return { ...(row.result as T), replayed: true };
  }
  const result = await fn();
  await tx.update(idempotencyKeys).set({ result: sql`${JSON.stringify(result)}::jsonb` }).where(eq(idempotencyKeys.id, inserted[0].id));
  return { ...result, replayed: false };
}

async function writeTransition(tx: Tx, ctx: AuthContext, r: { id: string; siteId: string }, from: string | null, to: string, reason: string | null) {
  await tx.insert(customerReturnStateTransitions).values({ organizationId: ctx.organizationId, siteId: r.siteId, customerReturnId: r.id, fromState: from, toState: to, actorId: ctx.userId, reason });
}

async function lockReturn(tx: Tx, ctx: AuthContext, returnId: string) {
  if (!isUuid(returnId)) throw new DomainError("not_found", "Return not found in your sites.");
  const [r] = await tx.select().from(customerReturns).where(and(eq(customerReturns.id, returnId), eq(customerReturns.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!r || !ctx.allowedSiteIds.includes(r.siteId)) throw new DomainError("not_found", "Return not found in your sites.");
  ctx.requireSite(r.siteId);
  return r;
}

function assertMove(r: ReturnRow, to: CustomerReturnStatus) {
  if (!canMoveReturn(r.status, to)) {
    throw new DomainError("state", `Return ${r.returnNumber} is ${RETURN_STATUS_LABEL[r.status as CustomerReturnStatus]?.toLowerCase() ?? r.status}; it cannot become ${RETURN_STATUS_LABEL[to].toLowerCase()}.`, { machine: "customer_return", from: r.status, to });
  }
}

async function move(tx: Tx, ctx: AuthContext, r: ReturnRow, to: CustomerReturnStatus, reason: string | null, set: Partial<typeof customerReturns.$inferInsert> = {}) {
  assertMove(r, to);
  const from = r.status;
  await tx.update(customerReturns).set({ ...set, status: to, statusChangedAt: new Date(), statusChangedBy: ctx.userId }).where(eq(customerReturns.id, r.id));
  await writeTransition(tx, ctx, r, from, to, reason);
  Object.assign(r, set, { status: to });
  return from;
}

/** A return destination: active, at the site, of an allowed kind for quarantined stock (V-LOC). */
async function destination(q: DbOrTx, ctx: AuthContext, siteId: string, locationId: string | null | undefined, expiresOn: string | null) {
  const configured = await getSetting(q, ctx.organizationId, "sales.customer_return.location_kinds", siteId);
  const classOk = allowedDestinationKinds("quarantine", expiresOn);
  const kinds: string[] = configured.filter((k) => classOk.includes(k));
  if (locationId) {
    if (!isUuid(locationId)) throw new DomainError("validation", "Choose the returns location.", { field: "toLocationId" });
    const [l] = await q.select().from(locations).where(eq(locations.id, locationId)).limit(1);
    if (!l || l.siteId !== siteId) throw new DomainError("validation", "The returns location must be at the shipment's site.", { field: "toLocationId" });
    if (!kinds.includes(l.kind)) {
      throw new DomainError("blocked_lot", `Returned stock arrives in quarantine; it can only go to ${kinds.join(" / ")} locations, not ${l.kind} (${l.code}).`, { rule: "V-LOC", allowedKinds: kinds, field: "toLocationId" });
    }
    if (!l.isActive || l.status !== "active") throw new DomainError("state", `Location ${l.code} is not active.`, { field: "toLocationId" });
    ctx.requireWarehouseWrite(l.siteId, l.warehouseId);
    return l;
  }
  // Default: an active location of an allowed kind, preferring one coded RET… (the customer-returns cage).
  const rows = await q.select().from(locations).where(and(eq(locations.siteId, siteId), eq(locations.isActive, true), eq(locations.status, "active"), inArray(locations.kind, kinds.length ? kinds : ["__none__"]))).orderBy(asc(locations.code));
  const pick = rows.find((l) => l.code.toUpperCase().startsWith("RET")) ?? rows[0];
  if (!pick) throw new DomainError("setup_required", `This site has no active ${kinds.join(" / ") || "quarantine"} location for returns. Ask an administrator to set one up.`, { field: "toLocationId" });
  return pick;
}

async function returnLocations(q: DbOrTx, ctx: AuthContext, siteId: string) {
  const configured = await getSetting(q, ctx.organizationId, "sales.customer_return.location_kinds", siteId);
  const classOk = allowedDestinationKinds("quarantine", null);
  const kinds: string[] = configured.filter((k) => classOk.includes(k));
  if (!kinds.length) return [];
  return q.select({ id: locations.id, code: locations.code, name: locations.name, kind: locations.kind }).from(locations).where(and(eq(locations.siteId, siteId), eq(locations.isActive, true), eq(locations.status, "active"), inArray(locations.kind, kinds))).orderBy(asc(locations.code));
}

/* ------------------------------------------------------------------ draft */

export type CreateReturnInput = { shipmentId: string; reasonCode: string; reasonNote?: string | null; complaintId?: string | null; toLocationId?: string | null; idempotencyKey?: string | null };

export async function createCustomerReturn(ctx: AuthContext, input: CreateReturnInput) {
  ctx.require("sales.customer_return.create");
  if (!isUuid(input.shipmentId)) throw new DomainError("not_found", "Shipment not found in your sites.");
  return db.transaction(async (tx) =>
    withKey(tx, ctx, input.idempotencyKey, "sales.customer_return.create", async () => {
      const s = await shipmentInScope(tx, ctx, input.shipmentId);
      if (!s) throw new DomainError("not_found", "Shipment not found in your sites.");
      ctx.requireAt("sales.customer_return.create", s.shipment.siteId);
      const shipped = await shippedLotsOf(tx, s.shipment.id);
      if (!shipped.length) throw new DomainError("state", `Nothing remains shipped on ${s.shipment.deliveryReceiptNumber} (its movements were reversed).`);
      const reason = await assertReasonCode(tx, ctx.organizationId, "return", input.reasonCode, input.reasonNote);
      let complaintId: string | null = null;
      let complaintNumber: string | null = null;
      if (input.complaintId) {
        if (!isUuid(input.complaintId)) throw new DomainError("validation", "Complaint not found.", { field: "complaintId" });
        const [c] = await tx.select().from(complaints).where(and(eq(complaints.id, input.complaintId), eq(complaints.organizationId, ctx.organizationId))).limit(1);
        if (!c || !ctx.allowedSiteIds.includes(c.siteId)) throw new DomainError("validation", "Complaint not found in your sites.", { field: "complaintId" });
        if (c.customerId !== s.customerId) throw new DomainError("validation", `Complaint ${c.complaintNumber} is from another customer.`, { field: "complaintId" });
        complaintId = c.id;
        complaintNumber = c.complaintNumber;
      }
      const to = await destination(tx, ctx, s.shipment.siteId, input.toLocationId, null);
      const returnNumber = await nextNumber(tx, ctx.organizationId, "RT");
      const [r] = await tx
        .insert(customerReturns)
        .values({
          organizationId: ctx.organizationId,
          siteId: s.shipment.siteId,
          returnNumber,
          status: "draft",
          customerId: s.customerId,
          salesOrderId: s.shipment.salesOrderId,
          shipmentId: s.shipment.id,
          complaintId,
          reasonCode: reason.code,
          reasonNote: reason.note,
          toLocationId: to.id,
          createdBy: ctx.userId,
          statusChangedBy: ctx.userId,
          idempotencyKey: input.idempotencyKey ?? null,
        })
        .returning();
      await writeTransition(tx, ctx, r, null, "draft", reason.note);
      if (complaintId) {
        await tx.insert(complaintLinks).values({ organizationId: ctx.organizationId, complaintId, linkKind: "customer_return", entityId: r.id, entityNumber: returnNumber, createdBy: ctx.userId }).onConflictDoNothing();
      }
      await audit(tx, ctx, {
        action: "sales.customer_return.created",
        entityType: "customer_return",
        entityId: r.id,
        entityNumber: returnNumber,
        siteId: r.siteId,
        reason: reason.note ?? reason.name,
        after: { shipment: s.shipment.deliveryReceiptNumber, order: s.orderNumber, customer: s.customerName, reasonCode: reason.code, complaint: complaintNumber, toLocation: to.code },
      });
      return { returnId: r.id, returnNumber };
    }),
  );
}

export type AddReturnLineInput = { returnId: string; code: string; qty?: string | null; condition: string; toLocationId?: string | null; note?: string | null; manualEntry?: boolean };

/**
 * Adds a scanned box or lot to a draft (scanner state). The shipment row is locked so concurrent lines
 * for the same shipment serialize and the shipped quantity can never be exceeded across returns (V-OVER).
 */
export async function addReturnLine(ctx: AuthContext, input: AddReturnLineInput) {
  ctx.require("sales.customer_return.create");
  const condition = input.condition as ReturnLineCondition;
  if (!(condition in RETURN_CONDITION_LABEL)) throw new DomainError("validation", "Choose the condition of the returned goods.", { field: "condition" });
  const note = text(input.note, "note", 500);
  const raw = (input.code ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!raw) throw new DomainError("validation", "Scan the box or lot label (or type the number).", { field: "code" });
  const code = raw.toUpperCase();
  return db.transaction(async (tx) => {
    const r = await lockReturn(tx, ctx, input.returnId);
    ctx.requireAt("sales.customer_return.create", r.siteId);
    if (r.status !== "draft") throw new DomainError("state", `Return ${r.returnNumber} is ${RETURN_STATUS_LABEL[r.status as CustomerReturnStatus].toLowerCase()}; lines can only be added to a draft.`);
    const s = await shipmentInScope(tx, ctx, r.shipmentId, { lock: true });
    if (!s) throw new DomainError("not_found", "Shipment not found in your sites.");
    const shipped = await shippedLotsOf(tx, s.shipment.id);

    // Resolve the scan: a box (BC:BOX: or a box number) or a lot (BC:LOT: or a lot number).
    let containerId: string | null = null;
    let containerNumber: string | null = null;
    let lotId: string | null = null;
    let boxQty: string | null = null;
    const boxNo = code.startsWith("BC:BOX:") ? code.slice(7).trim() : code.startsWith("BC:LOT:") ? null : code;
    if (boxNo) {
      const [box] = await tx.select().from(containers).where(and(eq(containers.organizationId, ctx.organizationId), eq(containers.containerNumber, boxNo), eq(containers.siteId, r.siteId))).limit(1);
      if (box) {
        containerId = box.id;
        containerNumber = box.containerNumber;
        const linked = (await shipmentsOfBox(tx, ctx.organizationId, box.id)).filter((b) => b.shipmentId === s.shipment.id);
        if (linked.length === 1) {
          lotId = linked[0].lotId;
          boxQty = linked[0].qtyBase;
        } else {
          const inBox = await lotsOfBox(tx, ctx.organizationId, box.id);
          const onShipment = shipped.filter((x) => inBox.includes(x.lotId));
          if (!onShipment.length) throw new DomainError("validation", `Box ${box.containerNumber} did not leave on ${s.shipment.deliveryReceiptNumber}.`, { field: "code" });
          if (onShipment.length > 1) throw new DomainError("validation", `Box ${box.containerNumber} holds several shipped lots; scan the lot label of the goods instead.`, { field: "code" });
          lotId = onShipment[0].lotId;
        }
      } else if (code.startsWith("BC:BOX:")) {
        throw new DomainError("validation", `Box ${boxNo} was not found at this site.`, { field: "code" });
      }
    }
    if (!lotId) {
      const lotNo = code.startsWith("BC:LOT:") ? code.slice(7).trim() : code;
      const hit = shipped.find((x) => x.lotNumber.toUpperCase() === lotNo);
      if (!hit) throw new DomainError("validation", `Lot ${lotNo} was not shipped on ${s.shipment.deliveryReceiptNumber}.`, { field: "code" });
      lotId = hit.lotId;
    }
    const lot = shipped.find((x) => x.lotId === lotId);
    if (!lot) throw new DomainError("validation", `That lot was not shipped on ${s.shipment.deliveryReceiptNumber}.`, { field: "code" });
    if (containerId) {
      const [dup] = await tx.select({ id: customerReturnLines.id }).from(customerReturnLines).where(and(eq(customerReturnLines.customerReturnId, r.id), eq(customerReturnLines.containerId, containerId))).limit(1);
      if (dup) throw new DomainError("conflict", `Box ${containerNumber} is already on this return (V-DUP).`, { field: "code", rule: "V-DUP" });
    }

    const qtyRaw = (input.qty ?? "").trim() || boxQty;
    if (!qtyRaw || !QTY_RE.test(qtyRaw) || new Decimal(qtyRaw).lte(0)) throw new DomainError("validation", "Enter the returned quantity (greater than zero).", { field: "qty" });
    const qty = new Decimal(qtyRaw);
    if (lot.baseUom === "pcs" && !qty.isInteger()) throw new DomainError("validation", "This lot is counted in pieces; enter a whole number.", { field: "qty" });
    const already = (await returnedQtyByLot(tx, [s.shipment.id])).get(`${s.shipment.id}:${lot.lotId}`) ?? new Decimal(0);
    const left = new Decimal(lot.qtyBase).minus(already);
    if (qty.gt(left)) {
      throw new DomainError("validation", `Only ${left.toString()} ${lot.baseUom} of lot ${lot.lotNumber} can still be returned on ${s.shipment.deliveryReceiptNumber} (shipped ${lot.qtyBase}, on returns ${already.toString()}).`, { field: "qty", rule: "V-OVER" });
    }
    const [lotRow] = await tx.select({ expiresOn: inventoryLots.expiresOn }).from(inventoryLots).where(eq(inventoryLots.id, lot.lotId)).limit(1);
    const to = input.toLocationId ? await destination(tx, ctx, r.siteId, input.toLocationId, lotRow?.expiresOn ?? null) : { id: r.toLocationId };
    const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(${customerReturnLines.lineNo}), 0)::int` }).from(customerReturnLines).where(eq(customerReturnLines.customerReturnId, r.id));
    const [line] = await tx
      .insert(customerReturnLines)
      .values({
        organizationId: ctx.organizationId,
        siteId: r.siteId,
        customerReturnId: r.id,
        lineNo: n + 1,
        productId: lot.productId,
        lotId: lot.lotId,
        containerId,
        qtyBase: qty.toString(),
        baseUom: lot.baseUom,
        condition,
        toLocationId: to.id,
        scanPayload: raw.slice(0, 200),
        manualEntry: !!input.manualEntry,
        note,
        createdBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, {
      action: "sales.customer_return.line_added",
      entityType: "customer_return",
      entityId: r.id,
      entityNumber: r.returnNumber,
      siteId: r.siteId,
      after: { lineNo: line.lineNo, lot: lot.lotNumber, box: containerNumber, qty: qty.toString(), uom: lot.baseUom, condition, manualEntry: !!input.manualEntry },
    });
    return { lineId: line.id, lineNo: line.lineNo, lotNumber: lot.lotNumber, boxNumber: containerNumber, qty: qty.toString(), uom: lot.baseUom };
  });
}

export async function removeReturnLine(ctx: AuthContext, input: { returnId: string; lineId: string }) {
  ctx.require("sales.customer_return.create");
  return db.transaction(async (tx) => {
    const r = await lockReturn(tx, ctx, input.returnId);
    if (r.status !== "draft") throw new DomainError("state", `Return ${r.returnNumber} is not a draft; its lines are fixed.`);
    if (!isUuid(input.lineId)) throw new DomainError("not_found", "Line not found.");
    const [l] = await tx.delete(customerReturnLines).where(and(eq(customerReturnLines.id, input.lineId), eq(customerReturnLines.customerReturnId, r.id))).returning();
    if (!l) throw new DomainError("not_found", "Line not found.");
    await audit(tx, ctx, { action: "sales.customer_return.line_removed", entityType: "customer_return", entityId: r.id, entityNumber: r.returnNumber, siteId: r.siteId, before: { lineNo: l.lineNo, lotId: l.lotId, qty: l.qtyBase } });
  });
}

/* ------------------------------------------------------------------ approval */

export async function submitCustomerReturn(ctx: AuthContext, input: { returnId: string }) {
  ctx.require("sales.customer_return.submit");
  return db.transaction(async (tx) => {
    const r = await lockReturn(tx, ctx, input.returnId);
    ctx.requireAt("sales.customer_return.submit", r.siteId);
    const lines = await tx.select({ id: customerReturnLines.id }).from(customerReturnLines).where(eq(customerReturnLines.customerReturnId, r.id));
    if (r.status === "draft" && !lines.length) throw new DomainError("validation", "Scan at least one returned box or lot before submitting.", { field: "code" });
    await move(tx, ctx, r, "submitted", null, { submittedBy: ctx.userId, submittedAt: new Date() });
    await audit(tx, ctx, { action: "sales.customer_return.submitted", entityType: "customer_return", entityId: r.id, entityNumber: r.returnNumber, siteId: r.siteId, after: { lines: lines.length } });
    await notifyRoles(
      tx,
      { roleCodes: ["site_manager"], siteId: r.siteId },
      { organizationId: ctx.organizationId, siteId: r.siteId, kind: "sales.customer_return.submitted", severity: "info", title: `Return ${r.returnNumber} to approve`, body: "A customer return is waiting for approval before it is received into quarantine.", entityType: "customer_return", entityId: r.id, link: `/sales/returns/${r.id}`, dedupeKey: `return-submitted:${r.id}:${Date.now()}` },
    );
    return { status: r.status };
  });
}

async function assertNotSubmitter(tx: Tx, ctx: AuthContext, r: ReturnRow) {
  if (!(await getSetting(tx, ctx.organizationId, "approvals.sod.customer_return"))) return;
  if (r.submittedBy === ctx.userId || r.createdBy === ctx.userId) {
    throw new DomainError("separation_of_duties", "SEPARATION_OF_DUTIES: you created or submitted this return, so a different person must approve it.", { rule: "authz.sod.approve_own" });
  }
}

export async function approveCustomerReturn(ctx: AuthContext, input: { returnId: string; note?: string | null }) {
  ctx.require("sales.customer_return.approve");
  const note = text(input.note, "note", 1000);
  return db.transaction(async (tx) => {
    const r = await lockReturn(tx, ctx, input.returnId);
    ctx.requireAt("sales.customer_return.approve", r.siteId);
    assertMove(r, "approved");
    await assertNotSubmitter(tx, ctx, r);
    await move(tx, ctx, r, "approved", note, { approvedBy: ctx.userId, approvedAt: new Date(), approvalNote: note });
    await audit(tx, ctx, { action: "sales.customer_return.approved", entityType: "customer_return", entityId: r.id, entityNumber: r.returnNumber, siteId: r.siteId, reason: note, after: { status: "approved" } });
    return { status: r.status };
  });
}

/** submitted → draft: the approver sends the return back with a reason. */
export async function sendBackCustomerReturn(ctx: AuthContext, input: { returnId: string; reason: string }) {
  ctx.require("sales.customer_return.approve");
  const reason = text(input.reason, "reason", 1000, 5)!;
  return db.transaction(async (tx) => {
    const r = await lockReturn(tx, ctx, input.returnId);
    ctx.requireAt("sales.customer_return.approve", r.siteId);
    await move(tx, ctx, r, "draft", reason, { submittedBy: null, submittedAt: null });
    await audit(tx, ctx, { action: "sales.customer_return.sent_back", entityType: "customer_return", entityId: r.id, entityNumber: r.returnNumber, siteId: r.siteId, reason, before: { status: "submitted" }, after: { status: "draft" } });
    return { status: r.status };
  });
}

export async function cancelCustomerReturn(ctx: AuthContext, input: { returnId: string; reason: string }) {
  ctx.require("sales.customer_return.submit");
  const reason = text(input.reason, "reason", 1000, 5)!;
  return db.transaction(async (tx) => {
    const r = await lockReturn(tx, ctx, input.returnId);
    if (r.status === "approved") ctx.requireAt("sales.customer_return.approve", r.siteId);
    else ctx.requireAt("sales.customer_return.submit", r.siteId);
    const from = await move(tx, ctx, r, "cancelled", reason, { cancelReason: reason });
    await audit(tx, ctx, { action: "sales.customer_return.cancelled", entityType: "customer_return", entityId: r.id, entityNumber: r.returnNumber, siteId: r.siteId, reason, before: { status: from }, after: { status: "cancelled" } });
    return { status: r.status };
  });
}

/* ------------------------------------------------------------------ posting */

/**
 * Posts an approved return (W09-11): one transaction, lock order return → shipment → origin lots →
 * (postMovement: new lot, balances) → numbering. Retry-safe: the idempotency key returns the first result
 * and every movement carries its own key (`customer_return:<line id>`).
 */
export async function postCustomerReturn(ctx: AuthContext, input: { returnId: string; idempotencyKey: string }) {
  ctx.require("sales.customer_return.post");
  if (!input.idempotencyKey) throw new DomainError("validation", "A request key is required to post a return.");
  return db.transaction(async (tx) =>
    withKey(tx, ctx, input.idempotencyKey, `sales.customer_return.post:${input.returnId}`, async () => {
      const r = await lockReturn(tx, ctx, input.returnId);
      ctx.requireAt("sales.customer_return.post", r.siteId);
      assertMove(r, "received");
      const s = await shipmentInScope(tx, ctx, r.shipmentId, { lock: true });
      if (!s) throw new DomainError("not_found", "Shipment not found in your sites.");
      const lines = await tx.select().from(customerReturnLines).where(eq(customerReturnLines.customerReturnId, r.id)).orderBy(asc(customerReturnLines.lineNo));
      if (!lines.length) throw new DomainError("validation", "The return has no lines.");
      // Re-check V-OVER at posting against the ledger (a shipment reversal may have happened meanwhile).
      const shipped = await shippedLotsOf(tx, s.shipment.id);
      const others = await returnedQtyByLot(tx, [s.shipment.id], { excludeReturnId: r.id });
      for (const lotId of new Set(lines.map((l) => l.lotId))) {
        const sh = shipped.find((x) => x.lotId === lotId);
        const mine = lines.filter((l) => l.lotId === lotId).reduce((a, l) => a.plus(l.qtyBase), new Decimal(0));
        const other = others.get(`${s.shipment.id}:${lotId}`) ?? new Decimal(0);
        if (!sh || mine.plus(other).gt(sh.qtyBase)) throw new DomainError("conflict", `The returned quantity of a lot exceeds what remains shipped on ${s.shipment.deliveryReceiptNumber}; send the return back and correct it.`, { rule: "V-OVER" });
      }
      const origins = await lockLots(tx, lines.map((l) => l.lotId));
      const posted: { lineNo: number; returnLotId: string; returnLotNumber: string; movementId: string; toLocation: string }[] = [];
      for (const line of lines) {
        const origin = origins.find((o) => o.id === line.lotId)!;
        const to = await destination(tx, ctx, r.siteId, line.toLocationId, origin.expiresOn);
        const lotNumber = await nextNumber(tx, ctx.organizationId, "LOT");
        const [rl] = await tx
          .insert(inventoryLots)
          .values({
            organizationId: ctx.organizationId,
            siteId: r.siteId,
            lotNumber,
            itemKind: origin.itemKind,
            materialId: origin.materialId,
            productId: origin.productId,
            supplierName: origin.supplierName,
            supplierLotNumber: origin.supplierLotNumber,
            manufacturedOn: origin.manufacturedOn,
            expiresOn: origin.expiresOn,
            retestOn: origin.retestOn,
            qualityStatus: "quarantine",
            originLotId: origin.id,
            baseUom: origin.baseUom,
            createdBy: ctx.userId,
          })
          .returning();
        const { movement } = await postMovement(tx, ctx, {
          movementType: "return",
          lotId: rl.id,
          toLocationId: to.id,
          qtyBase: line.qtyBase,
          sourceDocumentType: "customer_return",
          sourceDocumentId: r.id,
          sourceDocumentNumber: r.returnNumber,
          reason: `Customer return from ${s.customerName} (${s.shipment.deliveryReceiptNumber})`,
          idempotencyKey: `customer_return:${line.id}`,
          meta: { customerReturnLineId: line.id, originLotId: origin.id, originLotNumber: origin.lotNumber, shipmentId: s.shipment.id, condition: line.condition, ...(line.containerId ? { containerId: line.containerId } : {}) },
        });
        await tx.update(customerReturnLines).set({ returnLotId: rl.id, stockMovementId: movement.id, toLocationId: to.id }).where(eq(customerReturnLines.id, line.id));
        await audit(tx, ctx, {
          action: "inventory.inventory_lot.created",
          entityType: "inventory_lot",
          entityId: rl.id,
          entityNumber: lotNumber,
          siteId: r.siteId,
          after: { originLotId: origin.id, originLotNumber: origin.lotNumber, qualityStatus: "quarantine", customerReturn: r.returnNumber },
        });
        posted.push({ lineNo: line.lineNo, returnLotId: rl.id, returnLotNumber: lotNumber, movementId: movement.id, toLocation: to.code });
      }
      await move(tx, ctx, r, "received", null, { receivedBy: ctx.userId, receivedAt: new Date() });
      const shipmentState = await applyShipmentReturned(tx, ctx, s.shipment, { returnNumber: r.returnNumber });
      await audit(tx, ctx, {
        action: "sales.customer_return.posted",
        entityType: "customer_return",
        entityId: r.id,
        entityNumber: r.returnNumber,
        siteId: r.siteId,
        after: { status: "received", shipment: s.shipment.deliveryReceiptNumber, shipmentState, lines: posted },
      });
      await notifyRoles(
        tx,
        { roleCodes: ["qa_qc"], siteId: r.siteId },
        {
          organizationId: ctx.organizationId,
          siteId: r.siteId,
          kind: "sales.customer_return.posted",
          severity: "warning",
          title: `Returned stock to disposition (${r.returnNumber})`,
          body: `${posted.length} returned lot(s) from ${s.customerName} are in quarantine: ${posted.map((p) => p.returnLotNumber).join(", ")}.`,
          entityType: "customer_return",
          entityId: r.id,
          link: `/sales/returns/${r.id}`,
          dedupeKey: `return-posted:${r.id}`,
        },
      );
      return { status: "received" as const, shipmentState, lines: posted };
    }),
  );
}

/** received → inspected once every return lot has left quarantine through a QA disposition (W06, G-W07-D). */
export async function markReturnInspected(ctx: AuthContext, input: { returnId: string }) {
  ctx.require("sales.customer_return.approve");
  return db.transaction(async (tx) => {
    const r = await lockReturn(tx, ctx, input.returnId);
    ctx.requireAt("sales.customer_return.approve", r.siteId);
    const lines = await tx
      .select({ lotNumber: inventoryLots.lotNumber, status: inventoryLots.qualityStatus })
      .from(customerReturnLines)
      .innerJoin(inventoryLots, eq(inventoryLots.id, customerReturnLines.returnLotId))
      .where(eq(customerReturnLines.customerReturnId, r.id));
    if (r.status === "received") {
      const waiting = lines.filter((l) => l.status === "quarantine");
      if (waiting.length || !lines.length) throw new DomainError("state", `QA has not dispositioned returned lot(s) ${waiting.map((l) => l.lotNumber).join(", ")} yet.`);
    }
    await move(tx, ctx, r, "inspected", null, { inspectedBy: ctx.userId, inspectedAt: new Date() });
    await audit(tx, ctx, { action: "sales.customer_return.inspected", entityType: "customer_return", entityId: r.id, entityNumber: r.returnNumber, siteId: r.siteId, after: { lots: lines } });
    return { status: r.status };
  });
}

export async function closeCustomerReturn(ctx: AuthContext, input: { returnId: string }) {
  ctx.require("sales.customer_return.approve");
  return db.transaction(async (tx) => {
    const r = await lockReturn(tx, ctx, input.returnId);
    ctx.requireAt("sales.customer_return.approve", r.siteId);
    await move(tx, ctx, r, "closed", null, { closedBy: ctx.userId, closedAt: new Date() });
    await audit(tx, ctx, { action: "sales.customer_return.closed", entityType: "customer_return", entityId: r.id, entityNumber: r.returnNumber, siteId: r.siteId, after: { status: "closed" } });
    return { status: r.status };
  });
}

/* ------------------------------------------------------------------ queries */

export async function listCustomerReturns(ctx: AuthContext, f: { status?: string; customerId?: string } = {}) {
  ctx.require("sales.customer_return.view");
  const conds = [eq(customerReturns.organizationId, ctx.organizationId), inArray(customerReturns.siteId, ctx.allowedSiteIds)];
  if (f.customerId) conds.push(eq(customerReturns.customerId, f.customerId));
  if (!f.status || f.status === "active") conds.push(inArray(customerReturns.status, ["draft", "submitted", "approved", "received", "inspected"]));
  else if (f.status !== "all" && f.status in RETURN_STATUS_LABEL) conds.push(eq(customerReturns.status, f.status));
  return db
    .select({
      id: customerReturns.id,
      number: customerReturns.returnNumber,
      status: customerReturns.status,
      customerName: customers.name,
      drNumber: shipments.deliveryReceiptNumber,
      orderNumber: salesOrders.orderNumber,
      reasonCode: customerReturns.reasonCode,
      createdAt: customerReturns.createdAt,
      receivedAt: customerReturns.receivedAt,
      siteCode: sites.code,
      lineCount: sql<number>`(select count(*)::int from ${customerReturnLines} l where l.customer_return_id = ${customerReturns.id})`,
      totalQty: sql<string>`(select coalesce(sum(l.qty_base), 0)::text from ${customerReturnLines} l where l.customer_return_id = ${customerReturns.id})`,
    })
    .from(customerReturns)
    .innerJoin(customers, eq(customers.id, customerReturns.customerId))
    .innerJoin(shipments, eq(shipments.id, customerReturns.shipmentId))
    .innerJoin(sites, eq(sites.id, customerReturns.siteId))
    .leftJoin(salesOrders, eq(salesOrders.id, customerReturns.salesOrderId))
    .where(and(...conds))
    .orderBy(desc(customerReturns.createdAt))
    .limit(300);
}

export async function getCustomerReturn(ctx: AuthContext, returnId: string) {
  ctx.require("sales.customer_return.view");
  if (!isUuid(returnId)) throw new DomainError("not_found", "Return not found in your sites.");
  const [row] = await db
    .select({ r: customerReturns, customerName: customers.name, customerCode: customers.code, siteCode: sites.code, drNumber: shipments.deliveryReceiptNumber, dispatchedAt: shipments.dispatchedAt, deliveredAt: shipments.deliveredAt, orderNumber: salesOrders.orderNumber, createdByName: creator.displayName, approvedByName: approver.displayName, receivedByName: poster.displayName, toLocationCode: locations.code, complaintNumber: complaints.complaintNumber })
    .from(customerReturns)
    .innerJoin(customers, eq(customers.id, customerReturns.customerId))
    .innerJoin(sites, eq(sites.id, customerReturns.siteId))
    .innerJoin(shipments, eq(shipments.id, customerReturns.shipmentId))
    .innerJoin(creator, eq(creator.id, customerReturns.createdBy))
    .innerJoin(locations, eq(locations.id, customerReturns.toLocationId))
    .leftJoin(salesOrders, eq(salesOrders.id, customerReturns.salesOrderId))
    .leftJoin(approver, eq(approver.id, customerReturns.approvedBy))
    .leftJoin(poster, eq(poster.id, customerReturns.receivedBy))
    .leftJoin(complaints, eq(complaints.id, customerReturns.complaintId))
    .where(and(eq(customerReturns.id, returnId), eq(customerReturns.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row || !ctx.allowedSiteIds.includes(row.r.siteId)) throw new DomainError("not_found", "Return not found in your sites.");
  ctx.requireSite(row.r.siteId);
  const r = row.r;
  const returnLot = alias(inventoryLots, "return_lot");
  const lineLoc = alias(locations, "line_location");
  const lines = await db
    .select({ line: customerReturnLines, lotNumber: inventoryLots.lotNumber, expiresOn: inventoryLots.expiresOn, productName: products.name, productSku: products.skuCode, boxNumber: containers.containerNumber, returnLotNumber: returnLot.lotNumber, returnLotStatus: returnLot.qualityStatus, toLocationCode: lineLoc.code })
    .from(customerReturnLines)
    .innerJoin(inventoryLots, eq(inventoryLots.id, customerReturnLines.lotId))
    .innerJoin(lineLoc, eq(lineLoc.id, customerReturnLines.toLocationId))
    .leftJoin(products, eq(products.id, customerReturnLines.productId))
    .leftJoin(containers, eq(containers.id, customerReturnLines.containerId))
    .leftJoin(returnLot, eq(returnLot.id, customerReturnLines.returnLotId))
    .where(eq(customerReturnLines.customerReturnId, r.id))
    .orderBy(asc(customerReturnLines.lineNo));
  const lotIds = lines.map((l) => l.line.returnLotId).filter((x): x is string => !!x);
  const disp = lotIds.length
    ? await db.select({ subjectId: dispositions.subjectId, decision: dispositions.decision, toStatus: dispositions.toStatus, decidedAt: dispositions.decidedAt, reason: dispositions.reason }).from(dispositions).where(and(eq(dispositions.subjectType, "lot"), inArray(dispositions.subjectId, lotIds))).orderBy(desc(dispositions.decidedAt))
    : [];
  const timeline = await db
    .select({ from: customerReturnStateTransitions.fromState, to: customerReturnStateTransitions.toState, reason: customerReturnStateTransitions.reason, at: customerReturnStateTransitions.occurredAt, by: users.displayName })
    .from(customerReturnStateTransitions)
    .innerJoin(users, eq(users.id, customerReturnStateTransitions.actorId))
    .where(eq(customerReturnStateTransitions.customerReturnId, r.id))
    .orderBy(asc(customerReturnStateTransitions.occurredAt));
  const shipmentState = await shipmentReturnState(db, r.shipmentId);
  const reasonName = (await reasonLabels(db, ctx.organizationId, [r.reasonCode])).get(r.reasonCode) ?? r.reasonCode;
  const sodOn = await getSetting(db, ctx.organizationId, "approvals.sod.customer_return");
  const own = r.createdBy === ctx.userId || r.submittedBy === ctx.userId;
  const allDispositioned = lines.length > 0 && lines.every((l) => l.returnLotStatus && l.returnLotStatus !== "quarantine");
  return {
    header: { ...r, customerName: row.customerName, customerCode: row.customerCode, siteCode: row.siteCode, drNumber: row.drNumber, dispatchedAt: row.dispatchedAt, deliveredAt: row.deliveredAt, orderNumber: row.orderNumber, createdByName: row.createdByName, approvedByName: row.approvedByName, receivedByName: row.receivedByName, toLocationCode: row.toLocationCode, complaintNumber: row.complaintNumber, reasonName, statusLabel: RETURN_STATUS_LABEL[r.status as CustomerReturnStatus] ?? r.status },
    lines: lines.map((l) => ({
      ...l.line,
      lotNumber: l.lotNumber,
      expiresOn: l.expiresOn,
      productName: l.productName,
      productSku: l.productSku,
      boxNumber: l.boxNumber,
      returnLotNumber: l.returnLotNumber,
      returnLotStatus: l.returnLotStatus,
      toLocationCode: l.toLocationCode,
      conditionLabel: RETURN_CONDITION_LABEL[l.line.condition as ReturnLineCondition] ?? l.line.condition,
      disposition: disp.find((d) => d.subjectId === l.line.returnLotId) ?? null,
    })),
    shipment: shipmentState,
    timeline,
    locations: await returnLocations(db, ctx, r.siteId),
    can: {
      scan: r.status === "draft" && ctx.canAt("sales.customer_return.create", r.siteId),
      submit: r.status === "draft" && lines.length > 0 && ctx.canAt("sales.customer_return.submit", r.siteId),
      approve: r.status === "submitted" && ctx.canAt("sales.customer_return.approve", r.siteId) && !(sodOn && own),
      approveBlockedReason: r.status === "submitted" && ctx.canAt("sales.customer_return.approve", r.siteId) && sodOn && own ? "You created or submitted this return; another approver must approve it." : null,
      sendBack: r.status === "submitted" && ctx.canAt("sales.customer_return.approve", r.siteId),
      post: r.status === "approved" && ctx.canAt("sales.customer_return.post", r.siteId),
      inspect: r.status === "received" && allDispositioned && ctx.canAt("sales.customer_return.approve", r.siteId),
      inspectBlockedReason: r.status === "received" && !allDispositioned ? "QA dispositions each returned lot first (open the lot from the line)." : null,
      close: r.status === "inspected" && ctx.canAt("sales.customer_return.approve", r.siteId),
      cancel: (r.status === "draft" || r.status === "submitted") ? ctx.canAt("sales.customer_return.submit", r.siteId) : r.status === "approved" ? ctx.canAt("sales.customer_return.approve", r.siteId) : false,
      disposition: ctx.can("quality.disposition.approve"),
    },
  };
}

/** Options for the "New return" form: recent shipments at the user's sites, reasons, returns locations. */
export async function returnFormContext(ctx: AuthContext, ref: { shipmentId?: string | null; complaintId?: string | null; q?: string | null } = {}) {
  ctx.require("sales.customer_return.create");
  const q = (ref.q ?? "").trim().toUpperCase();
  const rows = await db
    .select({ id: shipments.id, drNumber: sql<string>`coalesce(${shipments.deliveryReceiptNumber}, ${shipments.shipmentNumber}, '—')`, dispatchedAt: shipments.dispatchedAt, deliveredAt: shipments.deliveredAt, siteId: shipments.siteId, siteCode: sites.code, orderNumber: salesOrders.orderNumber, customerId: customers.id, customerName: customers.name })
    .from(shipments)
    .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .innerJoin(sites, eq(sites.id, shipments.siteId))
    .where(and(eq(shipments.organizationId, ctx.organizationId), inArray(shipments.siteId, ctx.allowedSiteIds), inArray(shipments.status, [...LEFT_SITE_SHIPMENT_STATUSES]), q ? like(sql`upper(coalesce(${shipments.deliveryReceiptNumber}, '') || ' ' || ${salesOrders.orderNumber} || ' ' || ${customers.name})`, `%${q}%`) : undefined))
    .orderBy(desc(shipments.dispatchedAt))
    .limit(50);
  let complaint: { id: string; number: string; customerId: string; shipmentId: string | null } | null = null;
  if (ref.complaintId && isUuid(ref.complaintId)) {
    const [c] = await db.select({ id: complaints.id, number: complaints.complaintNumber, customerId: complaints.customerId, shipmentId: complaints.shipmentId, siteId: complaints.siteId }).from(complaints).where(and(eq(complaints.id, ref.complaintId), eq(complaints.organizationId, ctx.organizationId))).limit(1);
    if (c && ctx.allowedSiteIds.includes(c.siteId)) complaint = c;
  }
  const preselect = (ref.shipmentId && rows.find((r) => r.id === ref.shipmentId)?.id) || complaint?.shipmentId || null;
  const siteForLocations = rows.find((r) => r.id === preselect)?.siteId ?? ctx.currentSiteId;
  return {
    shipments: rows,
    preselectShipmentId: preselect,
    complaint,
    reasons: await reasonCodeOptions(db, ctx.organizationId, "return"),
    locations: await returnLocations(db, ctx, siteForLocations),
  };
}

/** Data for the printed return receipt (W07/W09 "Return receipt"); quantities from the lines and the posted ledger. */
export async function getReturnReceipt(ctx: AuthContext, returnId: string) {
  const v = await getCustomerReturn(ctx, returnId);
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const [cust] = await db.select({ address: customers.shipToAddress }).from(customers).where(eq(customers.id, v.header.customerId)).limit(1);
  return { ...v, organizationName: org?.name ?? "", customerAddress: cust?.address ?? "" };
}

/** Returns that name a shipment (shipment page, recall explorer). */
export async function returnsOfShipment(q: DbOrTx, shipmentId: string) {
  return q.select({ id: customerReturns.id, number: customerReturns.returnNumber, status: customerReturns.status }).from(customerReturns).where(and(eq(customerReturns.shipmentId, shipmentId), isNull(customerReturns.cancelReason))).orderBy(asc(customerReturns.createdAt));
}
