import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, batches, containers, inventoryLots, labelJobs, labelTemplates, locations, materials, organizations, printStations, sites, users } from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { createLabelJob, createLabelJobsForLots, createStation, labelJobForPrint, labelPreview, labelPreviewOrNull, markLabelJobPrinted, reprintLabelJob, siteLabelList } from "@/modules/documents";
import { shortHash } from "@/modules/documents/renderers/shared";
import { resolvePickRef, resolveScanCard, type ScanCard } from "@/modules/scan";
import { resetTestDatabase } from "../../support/db";

/**
 * ADR-099: labels printed where the work happens. The preview on the task screen is the label job's print
 * (same renderer, layout and face), the job/reprint rules are unchanged, and every label's code scans back
 * to its record.
 */
let orgId: string;
let nfd: SiteRef;
let rvs: SiteRef;
let whNfd: AuthContext;
let whRvs: AuthContext;
let opNfd: AuthContext;
let auditor: AuthContext;
let admin: AuthContext;

async function ctxFor(email: string, perms: readonly string[], siteList: SiteRef[]) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return new AuthContext(u.id, orgId, u.displayName, u.email, ["test"], new Set(perms), siteList, siteList[0].id);
}
async function expectDomain(p: Promise<unknown>, code: string) {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  return e as DomainError;
}
type Found = Extract<ScanCard, { outcome: "found" }>;
function found(c: ScanCard): Found {
  expect(c.outcome).toBe("found");
  return c as Found;
}
async function materialLot(siteId: string, status = "quarantine") {
  const [l] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.siteId, siteId), eq(inventoryLots.qualityStatus, status), eq(inventoryLots.itemKind, "material")));
  return l;
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
  opNfd = await ctxFor("operator.nfd@bryels-care.test", ROLE_BUNDLES.production_operator.permissions, [nfd]);
  auditor = await ctxFor("auditor@bryels-care.test", ROLE_BUNDLES.auditor.permissions, [nfd, rvs]);
  admin = await ctxFor("admin@bryels-care.test", ROLE_BUNDLES.system_admin.permissions, [nfd, rvs]);
});

describe("label preview on the task screen (ADR-099)", () => {
  it("a sack label: the approved sizes, real fields, BC:LOT code, suggested count, nothing recorded", async () => {
    const lot = await materialLot(nfd.id);
    const before = await db.select().from(labelJobs);
    const p = await labelPreview(whNfd, { entityType: "inventory_lot", entityId: lot.id, copies: 4 });
    expect(p.kind).toBe("sack");
    expect(p.blocked).toBeNull();
    expect(p.copies).toEqual({ suggested: 4, max: 99 });
    expect(p.options.map((o) => o.media)).toEqual(["100 × 50 mm", "50 × 30 mm"]);
    const f = p.options[0].face;
    expect(f.payload).toBe(`BC:LOT:${lot.lotNumber}`);
    expect(f.widthMm).toBe(100);
    expect(f.body).toContain(lot.lotNumber);
    expect(f.body).toContain("RAW MATERIAL");
    expect(f.body).toContain("QUARANTINE");
    expect(f.body).toContain(`data-payload="BC:LOT:${lot.lotNumber}"`);
    expect(f.css).toContain("@page lf_100x50");
    expect(await db.select().from(labelJobs)).toHaveLength(before.length);
  });

  it("the printed label is the preview: same face, only the trace reference is filled in", async () => {
    const lot = await materialLot(nfd.id, "released");
    const p = await labelPreview(whNfd, { entityType: "inventory_lot", entityId: lot.id });
    const opt = p.options[0];
    const r = await createLabelJob(whNfd, { labelTemplateId: opt.templateId, entityType: "inventory_lot", entityId: lot.id, copies: 1, idempotencyKey: randomUUID() });
    const printed = await labelJobForPrint(whNfd, r.jobId);
    expect(printed.render?.integrity).toBe("ok");
    expect(printed.face).not.toBeNull();
    expect(printed.face!.css).toBe(opt.face.css);
    expect(printed.face!.body.replace(shortHash(r.jobId), "NEW")).toBe(opt.face.body);
  });

  it("no station is chosen by the user: the job goes to the site's label printer; a named one must exist", async () => {
    await createStation(admin, { code: "WH1-B", name: "Second desk", printerName: "Demo printer B", isActive: true });
    const [first] = await db.select().from(printStations).where(eq(printStations.siteId, nfd.id)).orderBy(printStations.code).limit(1);
    const [loc] = await db.select().from(locations).where(eq(locations.siteId, nfd.id)).limit(1);
    const p = await labelPreview(whNfd, { entityType: "location", entityId: loc.id });
    expect(p.kind).toBe("shelf");
    expect(p.options[0].face.payload).toBe(`BC:LOC:${loc.code}`);
    const r = await createLabelJob(whNfd, { labelTemplateId: p.options[0].templateId, entityType: "location", entityId: loc.id, copies: 1, idempotencyKey: randomUUID() });
    const [j] = await db.select().from(labelJobs).where(eq(labelJobs.id, r.jobId));
    expect(j.printStationId).toBe(first.id);
    await expectDomain(createLabelJob(whNfd, { labelTemplateId: p.options[0].templateId, entityType: "location", entityId: loc.id, copies: 1, printStationId: randomUUID(), idempotencyKey: randomUUID() }), "validation");
  });

  it("the same label twice is still a reprint with a reason; the preview then offers 'print again'", async () => {
    const lot = await materialLot(nfd.id, "quarantine");
    const p = await labelPreview(whNfd, { entityType: "inventory_lot", entityId: lot.id });
    const r = await createLabelJob(whNfd, { labelTemplateId: p.options[0].templateId, entityType: "inventory_lot", entityId: lot.id, copies: 2, idempotencyKey: randomUUID() });
    const again = await labelPreview(whNfd, { entityType: "inventory_lot", entityId: lot.id });
    expect(again.existing.find((x) => x.templateId === p.options[0].templateId)).toMatchObject({ jobId: r.jobId, status: "ready", copies: 2 });
    await markLabelJobPrinted(whNfd, r.jobId);
    const conflict = await expectDomain(createLabelJob(whNfd, { labelTemplateId: p.options[0].templateId, entityType: "inventory_lot", entityId: lot.id, copies: 1, idempotencyKey: randomUUID() }), "conflict");
    expect(conflict.details?.existingJobId).toBe(r.jobId);
    expect((await labelPreview(whNfd, { entityType: "inventory_lot", entityId: lot.id })).existing[0]).toMatchObject({ jobId: r.jobId, status: "printed" });
    await expectDomain(reprintLabelJob(whNfd, r.jobId, { reasonCode: "", copies: 1, idempotencyKey: randomUUID() }), "validation");
    const rp = await reprintLabelJob(whNfd, r.jobId, { reasonCode: "damaged_label", copies: 1, idempotencyKey: randomUUID() });
    expect(rp.reprintNo).toBe(1);
    const [a] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "documents.label_job.reprinted"), eq(auditEvents.entityId, rp.jobId))).orderBy(desc(auditEvents.occurredAt));
    expect(a.reason).toMatch(/damaged_label/);
  });

  it("a box label and a batch label (before the lot number is fixed, with the values production will fix)", async () => {
    const [box] = await db.select().from(containers).where(and(eq(containers.siteId, nfd.id), eq(containers.status, "sealed"))).limit(1);
    const bp = await labelPreviewOrNull(whNfd, { entityType: "container", entityId: box.id });
    expect(bp?.kind).toBe("box");
    expect(bp?.options[0].face.payload).toBe(`BC:BOX:${box.containerNumber}`);

    const [b] = await db.select().from(batches).where(eq(batches.siteId, nfd.id)).limit(1);
    await db.update(batches).set({ outputLotNumber: null, outputManufacturedOn: null, outputExpiresOn: null }).where(eq(batches.id, b.id));
    expect(await labelPreviewOrNull(opNfd, { entityType: "batch", entityId: b.id })).toBeNull(); // nothing to show without the values
    const pv = await labelPreview(opNfd, { entityType: "batch", entityId: b.id, copies: 120, batchValues: { lotNumber: "LOT-PREVIEW-1", manufacturedOn: "2026-10-31", expiresOn: "2028-10-31" } });
    expect(pv.kind).toBe("bar");
    expect(pv.copies).toEqual({ suggested: 120, max: 999 });
    expect(pv.options[0].face.payload).toBe("BC:LOT:LOT-PREVIEW-1");
    expect(pv.options[0].face.body).toContain(b.batchNumber);
    expect(pv.options[0].face.body).toContain("31 Oct 2028");
    const [still] = await db.select().from(batches).where(eq(batches.id, b.id));
    expect(still.outputLotNumber).toBeNull(); // a preview never fixes anything
  });

  it("the bar label is the PRODUCT label, not the internal lot label: no status bar, no bulk quantity", async () => {
    const [b] = await db.select().from(batches).where(eq(batches.siteId, nfd.id)).limit(1);
    const pv = await labelPreview(opNfd, { entityType: "batch", entityId: b.id, batchValues: { lotNumber: "LOT-PREVIEW-2", manufacturedOn: "2026-10-31", expiresOn: "2028-10-31" } });
    expect(pv.options.map((o) => o.media)).toEqual(["70 × 40 mm"]);
    expect(pv.options[0].name).toMatch(/Product label/);
    const body = pv.options[0].face.body;
    expect(body).not.toMatch(/STATUS AT PRINT|QUARANTINE|RELEASED|Qty at print|Scan to verify/);
    for (const w of ["LOT-PREVIEW-2", b.batchNumber, "Made", "Expiry", "31 Oct 2028"]) expect(body).toContain(w);
    // A finished-goods lot (bulk stock) keeps the internal lot label with its status.
    const [fgLot] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.siteId, nfd.id), eq(inventoryLots.itemKind, "product")));
    if (fgLot) {
      const lp = await labelPreview(whNfd, { entityType: "inventory_lot", entityId: fgLot.id });
      expect(lp.kind).toBe("product_box");
      expect(lp.options[0].face.body).toMatch(/lbl-status/); // the internal lot label keeps its status bar
    }
  });
});

describe("a delivery with raw materials and intermediates", () => {
  it("each lot gets the approved label of its own kind", async () => {
    const lots = await db.select({ id: inventoryLots.id, kind: materials.materialKind }).from(inventoryLots).innerJoin(materials, eq(materials.id, inventoryLots.materialId)).where(eq(inventoryLots.siteId, nfd.id));
    const wip = lots.find((l) => l.kind === "intermediate");
    const raw = lots.find((l) => l.kind !== "intermediate");
    if (!wip || !raw) return;
    const [rm] = await db.select().from(labelTemplates).where(eq(labelTemplates.code, "LT-RM-100X50"));
    const out = await createLabelJobsForLots(whNfd, [{ lotId: raw.id }, { lotId: wip.id }], rm.id, 1, `mix:${randomUUID()}`);
    const made = out.filter((o) => o.jobId || o.code === "conflict");
    expect(made).toHaveLength(2);
    const wipJob = out.find((o) => o.lotId === wip.id);
    if (wipJob?.jobId) {
      const [j] = await db.select({ code: labelTemplates.code }).from(labelJobs).innerJoin(labelTemplates, eq(labelTemplates.id, labelJobs.labelTemplateId)).where(eq(labelJobs.id, wipJob.jobId));
      expect(j.code).toBe("LT-WIP-100X50");
    }
  });
});

describe("who may see and print (negatives)", () => {
  it("another site's lot is not found; RVS has no label printer; an auditor sees but cannot print", async () => {
    const lot = await materialLot(nfd.id);
    await expectDomain(labelPreview(whRvs, { entityType: "inventory_lot", entityId: lot.id }), "not_found");
    expect(await labelPreviewOrNull(whRvs, { entityType: "inventory_lot", entityId: lot.id })).toBeNull();
    const rvsLot = await materialLot(rvs.id, "released").then((l) => l ?? materialLot(rvs.id));
    if (rvsLot) {
      const p = await labelPreview(whRvs, { entityType: "inventory_lot", entityId: rvsLot.id });
      expect(p.blocked).toMatch(/not set up/);
      await expectDomain(createLabelJob(whRvs, { labelTemplateId: p.options[0].templateId, entityType: "inventory_lot", entityId: rvsLot.id, copies: 1, idempotencyKey: randomUUID() }), "state");
    }
    const a = await labelPreview(auditor, { entityType: "inventory_lot", entityId: lot.id });
    expect(a.blocked).toMatch(/cannot print/);
    expect(a.canReprint).toBe(false);
    await expectDomain(createLabelJob(auditor, { labelTemplateId: a.options[0].templateId, entityType: "inventory_lot", entityId: lot.id, copies: 1, idempotencyKey: randomUUID() }), "forbidden");
  });

  it("'Labels printed' lists only the current site's labels", async () => {
    const mine = await siteLabelList(whNfd);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((j) => j.siteId === nfd.id)).toBe(true);
    expect(await siteLabelList(whRvs)).toHaveLength(0);
    expect(await siteLabelList(whRvs, { siteId: nfd.id })).toHaveLength(0);
    const waiting = await siteLabelList(whNfd, { show: "not_printed" });
    expect(waiting.every((j) => j.status !== "printed")).toBe(true);
  });
});

describe("every label scans back to its record (ADR-099 §scan)", () => {
  it("sack, shelf and box labels resolve on the Scan screen", async () => {
    const lot = await materialLot(nfd.id);
    const lp = await labelPreview(whNfd, { entityType: "inventory_lot", entityId: lot.id });
    const c1 = found(await resolveScanCard(whNfd, lp.options[0].face.payload));
    expect(c1).toMatchObject({ entity: "lot", identifier: lot.lotNumber });

    const [loc] = await db.select().from(locations).where(eq(locations.siteId, nfd.id)).limit(1);
    const sp = await labelPreview(whNfd, { entityType: "location", entityId: loc.id });
    for (const o of sp.options) expect(found(await resolveScanCard(whNfd, o.face.payload))).toMatchObject({ entity: "location", identifier: loc.code });

    const [box] = await db.select().from(containers).where(and(eq(containers.siteId, nfd.id), eq(containers.status, "sealed"))).limit(1);
    const xp = await labelPreview(whNfd, { entityType: "container", entityId: box.id });
    expect(found(await resolveScanCard(whNfd, xp.options[0].face.payload))).toMatchObject({ entity: "box", identifier: box.containerNumber });
    // A keyboard-wedge scanner adds a newline; the same label still resolves.
    expect(found(await resolveScanCard(whNfd, `${xp.options[0].face.payload}\r\n`)).entity).toBe("box");
  });

  it("every label's code is accepted by the pickers (resolvePickRef) for its own kind, and refused for another", async () => {
    const lot = await materialLot(nfd.id);
    const lp = await labelPreview(whNfd, { entityType: "inventory_lot", entityId: lot.id });
    expect(await resolvePickRef(whNfd, "lot", lp.options[0].face.payload)).toMatchObject({ value: lot.id });
    await expectDomain(resolvePickRef(whNfd, "location", lp.options[0].face.payload), "validation");

    const [loc] = await db.select().from(locations).where(and(eq(locations.siteId, nfd.id), eq(locations.isActive, true))).limit(1);
    const sp = await labelPreview(whNfd, { entityType: "location", entityId: loc.id });
    for (const o of sp.options) expect(await resolvePickRef(whNfd, "location", o.face.payload)).toMatchObject({ value: loc.id });

    const [box] = await db.select().from(containers).where(and(eq(containers.siteId, nfd.id), eq(containers.status, "sealed"))).limit(1);
    const xp = await labelPreview(whNfd, { entityType: "container", entityId: box.id });
    expect(await resolvePickRef(whNfd, "container", xp.options[0].face.payload)).toMatchObject({ value: box.id });

    const [b] = await db.select().from(batches).where(eq(batches.siteId, nfd.id)).limit(1);
    await db.update(batches).set({ outputLotNumber: "LOT-PICK-TEST-1", outputManufacturedOn: "2026-10-31", outputExpiresOn: "2028-10-31" }).where(eq(batches.id, b.id));
    const bp = await labelPreview(opNfd, { entityType: "batch", entityId: b.id });
    expect(await resolvePickRef(opNfd, "batch", bp.options[0].face.payload)).toMatchObject({ value: b.id });
    expect(await resolvePickRef(opNfd, "batch", b.batchNumber)).toMatchObject({ value: b.id });
    await expectDomain(resolvePickRef(whRvs, "container", xp.options[0].face.payload), "not_found");
  });

  it("a bar label scanned before Finish opens the batch; after Finish the lot", async () => {
    const [b] = await db.select().from(batches).where(eq(batches.siteId, nfd.id)).limit(1);
    await db.update(batches).set({ outputLotNumber: "LOT-SCAN-TEST-1", outputManufacturedOn: "2026-10-31", outputExpiresOn: "2028-10-31" }).where(eq(batches.id, b.id));
    const p = await labelPreview(opNfd, { entityType: "batch", entityId: b.id });
    expect(p.options[0].face.payload).toBe("BC:LOT:LOT-SCAN-TEST-1");
    const c = found(await resolveScanCard(opNfd, p.options[0].face.payload));
    expect(c.caption).toMatch(/Batch/);
    expect(c.facts).toContainEqual(["Batch", b.batchNumber]);
    expect(c.actions[0]).toMatchObject({ key: "open", href: `/production/${b.id}`, allowed: true });
    // Someone at another site cannot see it.
    expect((await resolveScanCard(whRvs, p.options[0].face.payload)).outcome).toBe("not_found");
    // Once a lot with that number exists, the lot wins.
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.siteId, nfd.id)).limit(1);
    const keep = lot.lotNumber;
    await db.update(inventoryLots).set({ lotNumber: "LOT-SCAN-TEST-1" }).where(eq(inventoryLots.id, lot.id));
    expect(found(await resolveScanCard(opNfd, "BC:LOT:LOT-SCAN-TEST-1")).entity).toBe("lot");
    await db.update(inventoryLots).set({ lotNumber: keep }).where(eq(inventoryLots.id, lot.id));
  });
});
