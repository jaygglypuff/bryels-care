import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { containers, documentTemplateVersions, documentTemplates, equipment, inventoryLots, labelTemplates, organizations, sites, users } from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { createLabelJob, generateTemplateTestPage, markLabelJobPrinted, voidLabelJob } from "@/modules/documents";
import { resolveScanCard, type ScanCard } from "@/modules/scan";
import { resetTestDatabase } from "../../support/db";

let orgId: string;
let nfd: SiteRef;
let rvs: SiteRef;
let whNfd: AuthContext;
let whRvs: AuthContext;
let qa: AuthContext;
let manager: AuthContext;
let sales: AuthContext;

async function ctxFor(email: string, perms: readonly string[], siteList: SiteRef[]) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return new AuthContext(u.id, orgId, u.displayName, u.email, ["test"], new Set(perms), siteList, siteList[0].id);
}
type Found = Extract<ScanCard, { outcome: "found" }>;
function found(c: ScanCard): Found {
  expect(c.outcome).toBe("found");
  return c as Found;
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
  qa = await ctxFor("qa.nfd@bryels-care.test", ROLE_BUNDLES.qa_qc.permissions, [nfd, rvs]);
  manager = await ctxFor("manager.nfd@bryels-care.test", ROLE_BUNDLES.site_manager.permissions, [nfd]);
  sales = await ctxFor("sales@bryels-care.test", ROLE_BUNDLES.sales_cs.permissions, [nfd, rvs]);
});

describe("scan result card (US-2-13)", () => {
  it("a quarantined lot shows identity, status, expiry, risk banner and only allowed actions", async () => {
    const [lot] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.siteId, nfd.id), eq(inventoryLots.qualityStatus, "quarantine"), eq(inventoryLots.itemKind, "material")));
    const c = found(await resolveScanCard(whNfd, `BC:LOT:${lot.lotNumber}`));
    expect(c.entity).toBe("lot");
    expect(c.identifier).toBe(lot.lotNumber);
    expect(c.status?.code).toBe("quarantine");
    expect(c.siteCode).toBe("NFD");
    expect(c.risk?.title).toMatch(/Quarantined/);
    if (lot.expiresOn) expect(c.expiry?.daysLeft).not.toBeNull();
    const byKey = Object.fromEntries(c.actions.map((a) => [a.key, a]));
    expect(byKey.open.allowed).toBe(true);
    expect(byKey.label.allowed).toBe(true); // NFD has a station and an approved RM template
    expect(byKey.use).toMatchObject({ allowed: false });
    expect(byKey.use.reason).toMatch(/quarantined/);
    expect(byKey.qa).toBeUndefined(); // warehouse operator: no QA decision action at all
    for (const a of c.actions.filter((x) => !x.allowed)) expect(a.reason).toBeTruthy();
    // QA sees the decision action; the scan itself writes no audit.
    const q = found(await resolveScanCard(qa, lot.lotNumber.toLowerCase()));
    expect(q.actions.find((a) => a.key === "qa")?.allowed).toBe(true);
  });

  it("authz.cross_site.scan: an NFD lot scanned by an RVS-only user is 'No lot matches this code at RVS' with no fields", async () => {
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.siteId, nfd.id)).limit(1);
    const c = await resolveScanCard(whRvs, `BC:LOT:${lot.lotNumber}`);
    expect(c).toEqual({ outcome: "not_found", payload: `BC:LOT:${lot.lotNumber}`, message: "No lot matches this code at RVS." });
    const typed = await resolveScanCard(whRvs, lot.lotNumber);
    expect(typed.outcome).toBe("not_found");
    expect(JSON.stringify(typed)).not.toContain("NFD");
  });

  it("a lot at another of the user's sites shows the card but site-bound actions are disabled with the reason", async () => {
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.siteId, rvs.id)).limit(1);
    const c = found(await resolveScanCard(qa, `BC:LOT:${lot.lotNumber}`)); // qa current site = NFD
    expect(c.siteCode).toBe("RVS");
  });

  it("scan.rejects_url and unknown strings are 'not recognised'; unknown boxes and equipment are 'not found'", async () => {
    expect((await resolveScanCard(whNfd, "https://evil.example/BC:LOT:L-1")).outcome).toBe("not_recognised");
    expect((await resolveScanCard(whNfd, "hello world")).outcome).toBe("not_recognised");
    expect((await resolveScanCard(whNfd, "BC:BOX:BX-1")).outcome).toBe("not_found");
    expect((await resolveScanCard(whNfd, "BC:EQP:NOPE-01")).outcome).toBe("not_found");
    expect((await resolveScanCard(whNfd, "BC:LOT:NOPE-1")).outcome).toBe("not_found");
  });

  it("BC:BOX shows the W1C box card (contents, location, server-decided actions); another site's box is not found", async () => {
    const [box] = await db.select().from(containers).where(and(eq(containers.siteId, nfd.id), inArray(containers.status, ["open", "sealed"]))).limit(1);
    expect(box, "seeded demo box at NFD").toBeTruthy();
    const c = found(await resolveScanCard(whNfd, `BC:BOX:${box.containerNumber}`));
    expect(c.entity).toBe("box");
    expect(c.identifier).toBe(box.containerNumber);
    expect(c.siteCode).toBe("NFD");
    expect(c.holdings?.length).toBeGreaterThan(0);
    expect(c.actions.find((a) => a.key === "open")?.href).toBe(`/inventory/containers/${box.id}`);
    expect((await resolveScanCard(whRvs, `BC:BOX:${box.containerNumber}`)).outcome).toBe("not_found");
    expect((await resolveScanCard(sales, `BC:BOX:${box.containerNumber}`)).outcome).toBe(sales.can("inventory.container.view") ? "found" : "forbidden");
  });

  it("BC:LOC shows boxes, the count freeze and a move-here action; BC:EQP shows equipment availability", async () => {
    const loc = found(await resolveScanCard(whNfd, "BC:LOC:A-01"));
    expect(loc.facts.find(([k]) => k === "Count in progress")).toBeTruthy();
    expect(loc.actions.find((a) => a.key === "move_here")).toMatchObject({ allowed: true, href: expect.stringContaining("/inventory/move?to=") });
    const [eq1] = await db.select().from(equipment).where(eq(equipment.siteId, nfd.id)).limit(1);
    const e = found(await resolveScanCard(manager, `BC:EQP:${eq1.code}`));
    expect(e.entity).toBe("equipment");
    expect(e.actions[0].href).toBe(`/masterdata/equipment/${eq1.id}`);
    expect((await resolveScanCard(whRvs, `BC:EQP:${eq1.code}`)).outcome).toMatch(/not_found|forbidden/);
  });

  it("locations resolve at the current site with contents and a label action; materials and SKUs resolve", async () => {
    const loc = found(await resolveScanCard(whNfd, "BC:LOC:QUA-01"));
    expect(loc.entity).toBe("location");
    expect(loc.siteCode).toBe("NFD");
    expect(Array.isArray(loc.holdings)).toBe(true);
    expect(loc.actions.find((a) => a.key === "label")?.allowed).toBe(true);
    const locRvs = found(await resolveScanCard(whRvs, "BC:LOC:QUA-01"));
    expect(locRvs.siteCode).toBe("RVS");
    expect(locRvs.actions.find((a) => a.key === "label")).toMatchObject({ allowed: false }); // RVS has no print station
    expect(locRvs.actions.find((a) => a.key === "label")?.reason).toMatch(/isn't set up for RVS/);
    expect(found(await resolveScanCard(whNfd, "BC:MAT:MAT-0012")).title).toBe("Coconut Oil");
    expect(found(await resolveScanCard(whNfd, "BC:SKU:ACS-135")).entity).toBe("sku");
    expect((await resolveScanCard(sales, "BC:LOC:QUA-01")).outcome).toBe("forbidden"); // sales has no location view
  });

  it("BC:DOC resolves only with document view and source scope", async () => {
    const [t] = await db.select().from(documentTemplates).where(eq(documentTemplates.code, "TEST-A4"));
    const [v] = await db.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.documentTemplateId, t.id));
    const doc = await generateTemplateTestPage(manager, v.id, randomUUID());
    const c = found(await resolveScanCard(manager, `BC:DOC:${doc.documentNumber}`));
    expect(c.entity).toBe("document");
    expect(c.actions[0].href).toBe(`/documents/${doc.id}`);
    expect((await resolveScanCard(whNfd, `BC:DOC:${doc.documentNumber}`)).outcome).toBe("found"); // template view is in the warehouse bundle
    const noDocs = new AuthContext(whNfd.userId, orgId, "x", "x", ["test"], new Set(["inventory.lot.view"]), [nfd], nfd.id);
    expect((await resolveScanCard(noDocs, `BC:DOC:${doc.documentNumber}`)).outcome).toBe("not_found");
  });

  it("label state: printed count, superseded labels to destroy, and a status mismatch warning", async () => {
    const [lot] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.siteId, nfd.id), eq(inventoryLots.qualityStatus, "released"), eq(inventoryLots.itemKind, "material")));
    const [t] = await db.select().from(labelTemplates).where(eq(labelTemplates.code, "LT-RM-100X50"));
    const j = await createLabelJob(whNfd, { labelTemplateId: t.id, entityType: "inventory_lot", entityId: lot.id, copies: 1, idempotencyKey: randomUUID() });
    await markLabelJobPrinted(whNfd, j.jobId);
    let c = found(await resolveScanCard(whNfd, `BC:LOT:${lot.lotNumber}`));
    expect(c.labels?.printed).toBe(1);
    expect(c.labels?.mismatch).toBeNull();
    expect(c.actions.find((a) => a.key === "reprint")?.allowed).toBe(true);
    await voidLabelJob(manager, j.jobId, "Repacked into a new drum");
    c = found(await resolveScanCard(whNfd, `BC:LOT:${lot.lotNumber}`));
    expect(c.labels?.superseded).toHaveLength(1);
    expect(c.labels?.superseded[0].reason).toBe("Repacked into a new drum");
    // Status mismatch: a printed RELEASED label on a lot that is now on hold.
    const j2 = await createLabelJob(whNfd, { labelTemplateId: t.id, entityType: "inventory_lot", entityId: lot.id, copies: 1, idempotencyKey: randomUUID() });
    await markLabelJobPrinted(whNfd, j2.jobId);
    await db.update(inventoryLots).set({ qualityStatus: "on_hold" }).where(eq(inventoryLots.id, lot.id));
    c = found(await resolveScanCard(whNfd, `BC:LOT:${lot.lotNumber}`));
    expect(c.labels?.mismatch).toMatch(/says RELEASED; the lot is now ON HOLD/);
    expect(c.actions.find((a) => a.key === "reprint")?.allowed).toBe(false);
    expect(c.actions.find((a) => a.key === "label")?.label).toBe("Print new label");
    await db.update(inventoryLots).set({ qualityStatus: "released" }).where(eq(inventoryLots.id, lot.id));
  });

  it("role escalation: a user without inventory.lot.view cannot scan", async () => {
    const none = new AuthContext(sales.userId, orgId, "x", "x", ["test"], new Set(["sales.sales_order.view"]), [nfd], nfd.id);
    await expect(resolveScanCard(none, "BC:LOT:L-1")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("scan.ratelimit: the 121st look-up in a minute is refused", async () => {
    const fresh = new AuthContext(randomUUID(), orgId, "x", "x", ["test"], new Set(["inventory.lot.view"]), [nfd], nfd.id);
    const results: string[] = [];
    for (let i = 0; i < 121; i++) results.push((await resolveScanCard(fresh, `NOT A CODE ${i}`)).outcome);
    expect(results.slice(0, 120).every((o) => o === "not_recognised")).toBe(true);
    expect(results[120]).toBe("rate_limited");
  });
});
