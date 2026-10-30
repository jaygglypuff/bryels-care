/**
 * Consultant review 2026-10-30 (flow A, silent hand-off): when a goods receipt is posted, the people who
 * decide QA at the receipt's site are told once ("2 new lots from … wait for the quality check", link to the
 * QA queue); the poster and people of other sites are not; a replayed post sends nothing new; the QA queue
 * lists the oldest received first.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { goodsReceipts, locations, materials, notifications, organizations, roles, sites, userSiteAssignments, users } from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { postGoodsReceipt } from "@/modules/inventory/receiving";
import { getQaQueue } from "@/modules/quality/dispositions";
import { resetTestDatabase } from "../../support/db";

let orgId: string;
let nfd: SiteRef;
let rvs: SiteRef;
let whNfd: AuthContext;
let whRvs: AuthContext;
let qaNfdOnlyId: string; // a fictional QA person assigned to NFD only
let qaBothId: string; // the seeded QA person (both sites)
let nfdReceipt: { receiptId: string; receiptNumber: string };

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const qaNotes = (receiptId: string) => db.select().from(notifications).where(and(eq(notifications.entityId, receiptId), eq(notifications.kind, "quality.lots.received")));

async function ctxFor(email: string, perms: readonly string[], siteList: SiteRef[]) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return new AuthContext(u.id, orgId, u.displayName, u.email, ["test"], new Set(perms), siteList, siteList[0].id);
}
async function mat(code: string) {
  const [m] = await db.select().from(materials).where(eq(materials.code, code));
  return m;
}
async function receipt(siteId: string, supplierName: string) {
  const coconut = await mat("MAT-0012");
  const wrapper = await mat("PKG-0101");
  const qua = (await db.select().from(locations).where(eq(locations.siteId, siteId))).find((l) => l.code === "QUA-01" || l.code === "RCV")!;
  return {
    idempotencyKey: randomUUID(),
    supplierName,
    supplierDocumentNumber: `DR-QA-${Date.now()}`,
    lines: [
      { materialId: coconut.id, qty: "25000", supplierLotNumber: "SUP-QA-A", expiresOn: future(400), locationId: qua.id },
      { materialId: wrapper.id, qty: "500", supplierLotNumber: "SUP-QA-B", manufacturedOn: future(-10), expiresOn: future(1000), locationId: qua.id },
    ],
  };
}

beforeAll(async () => {
  await resetTestDatabase();
  const [org] = await db.select().from(organizations);
  orgId = org.id;
  const all = await db.select({ id: sites.id, code: sites.code, name: sites.name }).from(sites);
  nfd = all.find((s) => s.code === "NFD")!;
  rvs = all.find((s) => s.code === "RVS")!;
  whNfd = await ctxFor("warehouse.nfd@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [nfd]);
  whRvs = await ctxFor("warehouse.rvs@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [rvs]);
  qaBothId = (await db.select().from(users).where(eq(users.email, "qa.nfd@bryels-care.test")))[0].id;
  const [qaRole] = await db.select().from(roles).where(and(eq(roles.organizationId, orgId), eq(roles.code, "qa_qc")));
  const [u] = await db.insert(users).values({ organizationId: orgId, email: "qa.nfd-only@bryels-care.test", displayName: "Test QA NFD only (fictional)", passwordHash: "!", status: "active" }).returning();
  qaNfdOnlyId = u.id;
  await db.insert(userSiteAssignments).values({ userId: u.id, roleId: qaRole.id, siteId: nfd.id, isOrganizationWide: false });
}, 180_000);

describe("QA is told when a delivery is posted", () => {
  it("an NFD receipt notifies the QA people of NFD once, with plain words and the QA queue link", async () => {
    const input = await receipt(nfd.id, "Laguna Oleo (fictional)");
    const r = await postGoodsReceipt(whNfd, input);
    nfdReceipt = r;
    const notes = await qaNotes(r.receiptId);
    const to = notes.map((n) => n.recipientUserId);
    expect(to).toContain(qaNfdOnlyId);
    expect(to).toContain(qaBothId);
    expect(to).not.toContain(whNfd.userId);
    expect(new Set(to).size).toBe(to.length);
    const n = notes[0];
    expect(n.title).toBe("2 new lots from Laguna Oleo (fictional) wait for the quality check");
    expect(n.link).toBe("/quality");
    expect(n.siteId).toBe(nfd.id);
    expect(n.body).toContain(r.receiptNumber);
    // Posting the same form again replays the receipt and sends nothing new.
    const again = await postGoodsReceipt(whNfd, input);
    expect(again.replayed).toBe(true);
    expect(await qaNotes(r.receiptId)).toHaveLength(notes.length);
  });

  it("an RVS receipt does not notify QA people of NFD only (cross-site negative)", async () => {
    const r = await postGoodsReceipt(whRvs, await receipt(rvs.id, "Batangas Wax Co. (fictional)"));
    const to = (await qaNotes(r.receiptId)).map((n) => n.recipientUserId);
    expect(to).toContain(qaBothId);
    expect(to).not.toContain(qaNfdOnlyId);
  });

  it("the QA queue lists the oldest received first (receipt date, not when the lot row was made)", async () => {
    // A delivery entered today for goods received long ago goes to the top.
    await db.update(goodsReceipts).set({ receivedAt: new Date("2020-01-06T01:00:00Z") }).where(eq(goodsReceipts.id, nfdReceipt.receiptId));
    const [qaUser] = await db.select().from(users).where(eq(users.id, qaBothId));
    const qa = new AuthContext(qaUser.id, orgId, qaUser.displayName, qaUser.email, ["qa_qc"], new Set(ROLE_BUNDLES.qa_qc.permissions), [nfd, rvs], nfd.id);
    const { lots } = await getQaQueue(qa);
    expect(lots.length).toBeGreaterThan(1);
    const times = lots.map((l) => new Date(l.receivedAt).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(lots[0].receiptNumber).toBe(nfdReceipt.receiptNumber);
  });
});
