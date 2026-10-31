/**
 * Usability test 2026-10-30: when QA releases a lot whose stock waits in a quarantine/hold/receiving
 * place, the warehouse people of that site (inventory.movement.post there) are told, in the release
 * transaction, once per lot: "Coconut Oil lot L-… is ready — put it on A-01" with a link to Put away.
 * People of other sites are not told; a lot already on a shelf sends nothing.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { goodsReceiptLines, inventoryLots, notifications, suppliers, users } from "@/db/schema";
import type { AuthContext, SiteRef } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { putAwayLot } from "@/modules/inventory";
import { receiveAndPost } from "@/modules/inventory/receiving";
import { decideLot } from "@/modules/quality/dispositions";
import { notifyLotReadyForPutAway } from "@/modules/quality/put-away-notify";
import { resetTestDatabase } from "../../support/db";
import { ctxFor, future, loadSites, loc, mat } from "../../support/w1b";

let orgId: string;
let nfd: SiteRef;
let rvs: SiteRef;
let wh: AuthContext;
let whRvs: AuthContext;
let qa: AuthContext;
let lagunaId: string;

const userId = async (email: string) => (await db.select().from(users).where(eq(users.email, email)))[0].id;
const notesFor = (lotId: string) => db.select().from(notifications).where(and(eq(notifications.entityId, lotId), eq(notifications.kind, "inventory.lot.ready_to_put_away")));

async function receiveLot(ctx: AuthContext, siteId: string, locCode: string, supplierLot: string) {
  const r = await receiveAndPost(ctx, {
    idempotencyKey: randomUUID(),
    supplierId: lagunaId,
    supplierDocumentNumber: `DR-${supplierLot}`,
    lines: [{ materialId: (await mat("MAT-0012")).id, qty: "25", uom: "kg", supplierLotNumber: supplierLot, expiresOn: future(300), locationId: (await loc(siteId, locCode)).id }],
  });
  const [l] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, r.receiptId));
  const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, l.lotId!));
  return lot;
}

beforeAll(async () => {
  await resetTestDatabase();
  ({ orgId, nfd, rvs } = await loadSites());
  wh = await ctxFor(orgId, "warehouse.nfd@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [nfd]);
  whRvs = await ctxFor(orgId, "warehouse.rvs@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [rvs]);
  qa = await ctxFor(orgId, "qa.nfd@bryels-care.test", ROLE_BUNDLES.qa_qc.permissions, [nfd, rvs]);
  lagunaId = (await db.select().from(suppliers).where(eq(suppliers.name, "Laguna Oleo Supply")))[0].id;
});

describe("QA release tells the warehouse to put the lot away", () => {
  it("notifies the site's warehouse people once, with the shelf and a link to Put away; not other sites, not QA", async () => {
    const lot = await receiveLot(wh, nfd.id, "QUA-01", "SUP-READY-1");
    expect((await notesFor(lot.id)).length).toBe(0); // nothing while it waits for QA
    await decideLot(qa, { lotId: lot.id, decision: "release", reason: "CoA reviewed, conforms" });
    const notes = await notesFor(lot.id);
    const to = new Set(notes.map((n) => n.recipientUserId));
    expect(to.has(await userId("warehouse.nfd@bryels-care.test"))).toBe(true);
    expect(to.has(await userId("warehouse2.nfd@bryels-care.test"))).toBe(true);
    expect(to.has(await userId("joy.ramos@bryels-care.test"))).toBe(false); // RVS only
    expect(to.has(qa.userId)).toBe(false);
    const n = notes.find((x) => x.recipientUserId === wh.userId)!;
    expect(n.title).toBe(`Coconut Oil lot ${lot.lotNumber} is ready — put it on A-01`);
    expect(n.link).toBe("/inventory/receive/put-away");
    expect(n.siteId).toBe(nfd.id);
    expect(n.body).toContain("QUA-01");
    // Once per lot: calling the hand-off again sends nothing new.
    const again = await db.transaction((tx) => notifyLotReadyForPutAway(tx, qa.userId, lot.id));
    expect(again).toEqual([]);
    expect((await notesFor(lot.id)).length).toBe(notes.length);
  });

  it("a lot released at another site tells that site's warehouse, not NFD's", async () => {
    const lot = await receiveLot(whRvs, rvs.id, "QUA-01", "SUP-READY-RVS");
    await decideLot(qa, { lotId: lot.id, decision: "release", reason: "CoA reviewed, conforms" });
    const to = new Set((await notesFor(lot.id)).map((n) => n.recipientUserId));
    expect(to.has(await userId("warehouse.rvs@bryels-care.test"))).toBe(true);
    expect(to.has(await userId("warehouse2.nfd@bryels-care.test"))).toBe(false);
    expect(to.has(wh.userId)).toBe(false);
  });

  it("sends nothing when the stock is already on a storage shelf, or when the release is refused", async () => {
    const lot = await receiveLot(wh, nfd.id, "QUA-01", "SUP-READY-2");
    // Rejected: no put-away message.
    const other = await receiveLot(wh, nfd.id, "QUA-01", "SUP-READY-3");
    await decideLot(qa, { lotId: other.id, decision: "reject", reason: "Failed appearance check" });
    expect((await notesFor(other.id)).length).toBe(0);
    // A lot still waiting for QA is never announced, even if the hand-off is called.
    expect(await db.transaction((tx) => notifyLotReadyForPutAway(tx, qa.userId, lot.id))).toEqual([]);
    // Released, then put away on a shelf: nothing waits any more, so nothing would be sent.
    await decideLot(qa, { lotId: lot.id, decision: "release", reason: "CoA reviewed, conforms" });
    await putAwayLot(wh, { lotRef: lot.lotNumber, locationRef: "A-01", idempotencyKey: randomUUID() });
    await db.delete(notifications).where(eq(notifications.entityId, lot.id));
    expect(await db.transaction((tx) => notifyLotReadyForPutAway(tx, qa.userId, lot.id))).toEqual([]);
  });
});
