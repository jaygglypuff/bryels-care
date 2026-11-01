/**
 * UX audit round 2 part 2 (fictional demo data only): the warehouse send-out path can be walked, and sent-out
 * deliveries no longer read "0 box(es) · 0 pcs".
 *
 * 1. Older seeded deliveries (seed.ts, W3A, W3D) were written without shipment lines, only with their stock
 *    movements, so the delivery lists counted nothing. Each such delivery gets the lines its movements already
 *    say (lot, shelf, quantity, the same movement), verified by the person who sent it, and nothing else changes.
 *    No stock moves: the movements exist already.
 * 2. Three fresh North Fields orders of Acapulco Soap, walked through the real services (the same rules,
 *    numbers, audit and stock as on the screens):
 *    - Isla Spa Supplies: stock set aside → "To get from shelf";
 *    - Luntian Wellness Stores: got from the shelf → "Waiting for the second check of the box";
 *    - Mabuhay Pharmacy Group: second check done → "Ready to send out".
 *    A step that a service refuses (for example no released stock in a test database) is skipped with a note;
 *    the seed never forces a state.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";
import * as s from "../schema";

type Db = PostgresJsDatabase<typeof s>;

/** Domain modules start with `import "server-only"`; a seed is a server process (as `pnpm worker`, scripts/worker-preload.cjs). */
function allowServerModules() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Module = require("node:module") as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const empty = path.resolve(__dirname, "../../../scripts/server-only-empty.cjs");
  const resolve = Module._resolveFilename;
  if ((resolve as { __r2p2?: boolean }).__r2p2) return;
  const patched = function (this: unknown, request: string, ...rest: unknown[]) {
    if (request === "server-only") return empty;
    return resolve.call(this, request, ...rest);
  } as typeof resolve & { __r2p2?: boolean };
  patched.__r2p2 = true;
  Module._resolveFilename = patched;
}

export async function backfillShipmentLines(db: Db, organizationId: string): Promise<number> {
  const empty = await db
    .select({ sh: s.shipments })
    .from(s.shipments)
    .where(and(eq(s.shipments.organizationId, organizationId), inArray(s.shipments.status, ["dispatched", "delivered"]), sql`not exists (select 1 from shipment_lines l where l.shipment_id = ${s.shipments.id})`));
  let n = 0;
  for (const { sh } of empty) {
    const moves = await db
      .select({ m: s.stockMovements, productId: s.inventoryLots.productId })
      .from(s.stockMovements)
      .innerJoin(s.inventoryLots, eq(s.inventoryLots.id, s.stockMovements.lotId))
      .where(and(eq(s.stockMovements.sourceDocumentType, "shipment"), eq(s.stockMovements.sourceDocumentId, sh.id), eq(s.stockMovements.movementType, "shipment")));
    const orderLines = await db.select().from(s.salesOrderLines).where(eq(s.salesOrderLines.salesOrderId, sh.salesOrderId));
    for (const { m, productId } of moves) {
      const line = orderLines.find((l) => l.productId === productId) ?? orderLines[0];
      if (!line || !m.fromLocationId || Number(m.qtyBase) <= 0) continue;
      await db.insert(s.shipmentLines).values({
        organizationId,
        siteId: sh.siteId,
        shipmentId: sh.id,
        salesOrderLineId: line.id,
        lotId: m.lotId,
        fromLocationId: m.fromLocationId,
        qtyBase: m.qtyBase,
        baseUom: m.baseUom,
        stockMovementId: m.id,
        verifiedBy: sh.dispatchedBy ?? m.postedBy,
        verifiedAt: sh.dispatchedAt ?? m.postedAt,
      });
      n++;
    }
  }
  return n;
}

export async function seedR2P2(db: Db): Promise<string[]> {
  const notes: string[] = [];
  const [org] = await db.select().from(s.organizations).limit(1);
  if (!org) return ["no organization"];
  const O = org.id;
  notes.push(`${await backfillShipmentLines(db, O)} shipment lines filled in from their stock movements`);

  allowServerModules();
  try {
    return await sendOutDemo(db, O, notes);
  } finally {
    // The services opened their own connection pool (src/db/client.ts); close it so the seed process can end.
    await (await import("../client")).db.$client.end({ timeout: 5 });
  }
}

async function sendOutDemo(db: Db, O: string, notes: string[]): Promise<string[]> {
  const sales = await import("../../modules/sales");
  const { buildContextForUser } = await import("../../lib/auth/context");
  const { nextNumber } = await import("../../lib/numbering");

  const [nfd] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, "NFD"))).limit(1);
  const user = async (email: string) => (await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, email)).limit(1))[0]?.id;
  const [whId, mgrId, salesId] = [await user("warehouse.nfd@bryels-care.test"), await user("manager.nfd@bryels-care.test"), await user("sales@bryels-care.test")];
  const [acs] = await db.select().from(s.products).where(and(eq(s.products.organizationId, O), eq(s.products.skuCode, "ACS-135"))).limit(1);
  if (!nfd || !whId || !mgrId || !salesId || !acs) return [...notes, "send-out demo skipped: site, users or product missing"];
  const wh = await buildContextForUser(whId, nfd.id);
  const mgr = await buildContextForUser(mgrId, nfd.id);
  if (!wh || !mgr) return [...notes, "send-out demo skipped: no context"];

  const customer = async (code: string) => (await db.select().from(s.customers).where(and(eq(s.customers.organizationId, O), eq(s.customers.code, code))).limit(1))[0];
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const newOrder = async (code: string, qty: string, deliverIn: number, po: string) => {
    const c = await customer(code);
    if (!c) return null;
    const orderNumber = await nextNumber(db as never, O, "SO");
    const [o] = await db.insert(s.salesOrders).values({ organizationId: O, siteId: nfd.id, orderNumber, customerId: c.id, customerPoNumber: po, requestedDeliveryOn: day(deliverIn), status: "confirmed", createdBy: salesId, confirmedBy: mgrId }).returning();
    await db.insert(s.salesOrderLines).values({ salesOrderId: o.id, lineNo: 1, productId: acs.id, qtyUnits: qty, unitPrice: "70.00" });
    await db.execute(sql`update sales_orders set subtotal_amount = 840, total_amount = 840 where id = ${o.id}`);
    return o;
  };
  const key = () => randomUUID();
  const payload = (a: { boxNumber: string | null; lotNumber: string }) => (a.boxNumber ? `BC:BOX:${a.boxNumber}` : `BC:LOT:${a.lotNumber}`);
  const pickAll = async (orderId: string) => {
    const { pickId, shipmentId } = await sales.startPick(wh, orderId, { idempotencyKey: key() });
    const allocs = await sales.openAllocationsForOrder(db as never, orderId);
    for (const a of allocs) await sales.scanPick(wh, pickId, { payload: payload(a), qty: a.boxNumber ? null : String(Number(a.qty)), idempotencyKey: key() });
    await sales.completePick(wh, pickId, { idempotencyKey: key() });
    return { shipmentId: shipmentId!, allocs };
  };
  const step = async (label: string, f: () => Promise<unknown>) => {
    try {
      await f();
      notes.push(label);
    } catch (e) {
      notes.push(`${label}: skipped (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const toPick = await newOrder("CUS-002", "12", 2, "ISS-2240");
  if (toPick) await step(`${toPick.orderNumber} set aside: ready to get from the shelf`, () => sales.allocateOrder(wh, toPick.id));
  const toCheck = await newOrder("CUS-001", "12", 3, "LWS-PO-4502");
  if (toCheck)
    await step(`${toCheck.orderNumber} got from the shelf: waiting for the second check`, async () => {
      await sales.allocateOrder(wh, toCheck.id);
      await pickAll(toCheck.id);
    });
  const toSend = await newOrder("CUS-003", "12", 1, "MPG-7781");
  if (toSend)
    await step(`${toSend.orderNumber} second check done: ready to send out`, async () => {
      await sales.allocateOrder(wh, toSend.id);
      const { shipmentId, allocs } = await pickAll(toSend.id);
      for (const a of allocs) await sales.scanPackVerification(mgr, shipmentId, { payload: payload(a), qty: a.boxNumber ? null : String(Number(a.qty)), idempotencyKey: key() });
      await sales.completePacking(mgr, shipmentId, { carrierName: "Own truck", packageCount: 1, idempotencyKey: key() });
    });
  return notes;
}
