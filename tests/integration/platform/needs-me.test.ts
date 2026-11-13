/**
 * ADR-132 §1 (round 5 leftovers, B report #1 #2): the "Needs me" badge and Home's "Needs you" card are one number from
 * one function, `needsMeSummary` — approvals the person can decide + checks waiting for them + open messages that ask
 * them to act. FYI messages, done messages, messages taken on ("I'm on it") and other people's messages never count;
 * a message about a record already on the approvals list is not counted twice. Reading a message does not make the
 * work go away, so it still counts until the work is done.
 */
import { randomUUID } from "node:crypto";
import { vi, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { goodsReceiptLines, inventoryLots, suppliers } from "@/db/schema";
import type { AuthContext, SiteRef } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { refreshActionItems } from "@/modules/action-centre";
import { needsMeSummary } from "@/modules/analytics";
import { receiveAndPost } from "@/modules/inventory/receiving";
import { acknowledgeNotification, listMyNotifications, markAllNotificationsRead, notifyUsers } from "@/modules/platform";
import { createProductionOrder } from "@/modules/production";
import { decideLot } from "@/modules/quality/dispositions";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { ctxFor, future, loadSites, loc, mat } from "../../support/w1b";
import { day, productId, setOrgSetting } from "../production/w2a-fixtures";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

let orgId: string;
let nfd: SiteRef;
let wh: AuthContext;
let qa: AuthContext;
let operator: AuthContext;
let manager: AuthContext;
let planner: AuthContext;

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  ({ orgId, nfd } = await loadSites());
  wh = await ctxFor(orgId, "warehouse.nfd@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [nfd]);
  qa = await ctxFor(orgId, "qa.nfd@bryels-care.test", ROLE_BUNDLES.qa_qc.permissions, [nfd]);
  operator = await ctxFor(orgId, "operator.nfd@bryels-care.test", ROLE_BUNDLES.production_operator.permissions, [nfd]);
  manager = await ctxFor(orgId, "manager.nfd@bryels-care.test", ROLE_BUNDLES.site_manager.permissions, [nfd]);
  planner = await ctxFor(orgId, "planner.nfd@bryels-care.test", ROLE_BUNDLES.production_planner.permissions, [nfd]);
  await setOrgSetting(orgId, "governance.owner_override", false);
}, 180_000);

describe("needsMeSummary", () => {
  it("counts a put-away message for the warehouse, read or not, and not an FYI note or someone else's message", async () => {
    const before = await needsMeSummary(wh, { checks: false });
    const laguna = (await db.select().from(suppliers).where(eq(suppliers.name, "Laguna Oleo Supply")))[0].id;
    const r = await receiveAndPost(wh, {
      idempotencyKey: randomUUID(),
      supplierId: laguna,
      supplierDocumentNumber: "DR-NEEDS-ME-1",
      lines: [{ materialId: (await mat("MAT-0012")).id, qty: "25", uom: "kg", supplierLotNumber: "NEEDS-ME-1", expiresOn: future(300), locationId: (await loc(nfd.id, "QUA-01")).id }],
    });
    const [l] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, r.receiptId));
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, l.lotId!));
    await decideLot(qa, { lotId: lot.id, decision: "release", reason: "CoA reviewed, conforms" });

    await notifyUsers(db, [wh.userId], { organizationId: orgId, siteId: nfd.id, kind: "document.generated", severity: "info", title: "Your file is ready", body: "FYI" });
    const after = await needsMeSummary(wh, { checks: false });
    expect(after.messages).toBe(before.messages + 1);
    expect(after.total).toBe(after.approvals + after.checks + after.messages);

    // Reading the message does not make the work go away.
    await markAllNotificationsRead(wh);
    expect((await needsMeSummary(wh, { checks: false })).messages).toBe(after.messages);

    // The operator never got it (put-away goes to the warehouse), so it is not his.
    const op = await needsMeSummary(operator, { checks: false });
    expect(op.messages).toBe(0);

    // "I'm on it" takes it off the count.
    const note = (await listMyNotifications(wh)).find((n) => n.entityId === lot.id && n.kind === "inventory.lot.ready_to_put_away")!;
    await acknowledgeNotification(wh, note.id);
    expect((await needsMeSummary(wh, { checks: false })).messages).toBe(before.messages);
  });

  it("a production order to approve is one approval for the manager, not an approval and a message", async () => {
    await refreshActionItems(orgId);
    const before = await needsMeSummary(manager);
    const r = await createProductionOrder(planner, { productId: await productId("ACS-135"), plannedStart: day(1), neededBy: day(3), idempotencyKey: `needs-me-${randomUUID()}` });
    await refreshActionItems(orgId);
    const n = await needsMeSummary(manager);
    expect((await listMyNotifications(manager)).some((m) => m.entityId === r.workOrderId && m.kind === "production.order.to_approve")).toBe(true);
    expect(n.approvals).toBe(before.approvals + 1);
    // The message about the same production order is not counted again.
    expect(n.messages).toBe(before.messages);
    expect(n.total).toBe(n.approvals + n.checks + n.messages);
    expect(n.href).toBe("/approvals");
  });
});
