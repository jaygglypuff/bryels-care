import { execFileSync } from "node:child_process";
import { and, asc, count, eq, gt, ne } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import {
  auditEvents,
  batches,
  containers,
  equipment,
  formulaRevisions,
  formulas,
  inventoryBalances,
  inventoryLots,
  locations,
  materials,
  organizations,
  products,
  purchaseOrders,
  routingRevisions,
  routingSteps,
  routings,
  salesOrders,
  sites,
  stockAllocations,
  users,
  workOrders,
} from "@/db/schema";
import { DEMO_SEED_VERSION, SANDBOX_ORG_NAME } from "@/lib/demo";
import { emptyTestDatabase } from "../../support/db";

/**
 * The lite demo profile (owner request 2026-11-06; src/db/seed-demo.ts, src/db/seeds/lite.ts, src/db/demo.ts):
 *   - loads on an empty database: one site, two products, two approved recipes and two approved routings only;
 *   - every storyline record stops at its stated step (made through the services);
 *   - start-up (`db:demo auto`) wipes and reloads once when the stored seed version or profile differs, and
 *     not on the next start;
 *   - the guards refuse: demo mode off, APP_ENV=production, real accounts (nothing changes).
 */
function runScript(file: string, args: string[], env: Record<string, string | undefined>) {
  try {
    const out = execFileSync(process.execPath, ["--import", "tsx", file, ...args], {
      env: { ...process.env, DEMO_MODE: "", ALLOW_DEMO_SEED: "", APP_ENV: "", DEMO_PROFILE: "", ...env },
      stdio: "pipe",
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (e) {
    const x = e as { status: number; stdout: string; stderr: string };
    return { code: x.status, out: `${x.stdout}\n${x.stderr}` };
  }
}

const demoOrg = async () => (await db.select().from(organizations).where(ne(organizations.name, SANDBOX_ORG_NAME)))[0];
const marker = async () => (await db.select().from(auditEvents).where(eq(auditEvents.action, "platform.demo.seeded")))[0];

beforeAll(async () => {
  await emptyTestDatabase();
  const r = runScript("src/db/demo.ts", ["auto"], { DEMO_MODE: "true" });
  expect(r.code, r.out).toBe(0);
  expect(r.out).toContain("Empty database");
  expect(r.out).toContain("Demo data (lite) loaded");
}, 300_000);

describe("lite profile on an empty database", () => {
  it("one demo organization (plus the empty sandbox), one site, the demo accounts", async () => {
    const orgs = await db.select().from(organizations);
    expect(orgs.map((o) => o.name).sort()).toEqual(["Bryel's Care Corporation (demo)", SANDBOX_ORG_NAME].sort());
    const O = (await demoOrg()).id;
    expect((await db.select().from(sites).where(eq(sites.organizationId, O))).map((s) => s.name)).toEqual(["North Fields Plant"]);
    const emails = (await db.select({ e: users.email }).from(users).where(eq(users.organizationId, O))).map((u) => u.e);
    const firstNames = (await db.select({ n: users.displayName }).from(users).where(and(eq(users.organizationId, O), eq(users.status, "active")))).map((u) => u.n.split(" ")[0]);
    expect(new Set(firstNames).size, firstNames.join(", ")).toBe(firstNames.length);
    for (const e of ["owner@", "manager.nfd@", "planner.nfd@", "operator.nfd@", "checker.nfd@", "warehouse.nfd@", "qa.nfd@", "qa.lead@", "procurement@", "sales@", "finance@", "floor.nfd@"]) {
      expect(emails).toContain(`${e}bryels-care.test`);
    }
  });

  it("two products, two approved recipes, two approved routings with plain step names, nothing else", async () => {
    const O = (await demoOrg()).id;
    const ps = await db.select().from(products).where(eq(products.organizationId, O)).orderBy(asc(products.name));
    expect(ps.map((p) => [p.name, p.labelling, p.unitsPerBox, p.status])).toEqual([
      ["Acapulco Soap 135 g", "per_box", 24, "active"],
      ["Aloe Hand Lotion 250 mL", "per_piece", 24, "active"],
    ]);
    const fs = await db.select({ f: formulas, status: formulaRevisions.status }).from(formulas).innerJoin(formulaRevisions, eq(formulaRevisions.formulaId, formulas.id)).where(eq(formulas.organizationId, O));
    expect(fs.map((x) => x.status)).toEqual(["approved", "approved"]);
    const rs = await db.select({ id: routingRevisions.id, productId: routings.productId, status: routingRevisions.status }).from(routings).innerJoin(routingRevisions, eq(routingRevisions.routingId, routings.id)).where(eq(routings.organizationId, O));
    expect(rs.map((x) => x.status)).toEqual(["approved", "approved"]);
    const stepsOf = async (name: string) => {
      const p = ps.find((x) => x.name === name)!;
      const r = rs.find((x) => x.productId === p.id)!;
      return (await db.select().from(routingSteps).where(eq(routingSteps.routingRevisionId, r.id)).orderBy(asc(routingSteps.stepNo))).map((s) => s.name);
    };
    expect(await stepsOf("Acapulco Soap 135 g")).toEqual(["Check the area is clean", "Weigh the ingredients", "Heat and mix", "Pour into moulds", "Cure", "Cut", "Wrap and pack", "Move to the hold area"]);
    expect(await stepsOf("Aloe Hand Lotion 250 mL")).toEqual(["Check the area is clean", "Weigh", "Heat and mix", "Cool", "Fill bottles", "Label and pack", "Move to the hold area"]);
    const ms = await db.select().from(materials).where(eq(materials.organizationId, O));
    expect(ms).toHaveLength(13);
    expect(ms.filter((m) => m.materialKind === "packaging").map((m) => m.name).sort()).toEqual(["Lotion Bottle 250 mL", "Pump Cap", "Shipping Box (holds 24)", "Soap Wrapper 135 g"]);
    for (const m of [...ms, ...ps]) expect(m.name).not.toMatch(/PLACEHOLDER|^[A-Z]{2,4}-\d+$/);
  });

  it("the storyline: each record at its step", async () => {
    const O = (await demoOrg()).id;
    const wos = await db.select({ wo: workOrders, product: products.name }).from(workOrders).innerJoin(products, eq(products.id, workOrders.productId)).where(eq(workOrders.organizationId, O)).orderBy(asc(workOrders.workOrderNumber));
    const bs = await db.select().from(batches).where(eq(batches.organizationId, O)).orderBy(asc(batches.batchNumber));
    expect(wos.map((x) => [x.product, x.wo.status])).toEqual([
      ["Acapulco Soap 135 g", "closed"],
      ["Aloe Hand Lotion 250 mL", "completed"],
      ["Acapulco Soap 135 g", "in_progress"],
      ["Aloe Hand Lotion 250 mL", "released"],
    ]);
    expect(bs.map((b) => b.status)).toEqual(["closed", "awaiting_qc", "in_process", "planned"]);

    // The released soap: on the finished goods bay, in 5 boxes (4 × 24 + 22), the boxes where the stock is.
    const fg = (await db.select().from(locations).where(eq(locations.code, "FG-01")))[0];
    const [soapLot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, bs[0].outputLotId!));
    expect(soapLot.qualityStatus).toBe("released");
    const bal = await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, soapLot.id), eq(inventoryBalances.locationId, fg.id)));
    expect(new Decimal(bal[0].qtyBase).toNumber()).toBe(118);
    const boxes = await db.select().from(containers).where(eq(containers.organizationId, O));
    expect(boxes).toHaveLength(5);
    for (const b of boxes) expect(b.currentLocationId).toBe(fg.id);
    // The lotion waits for QA in the QA waiting area.
    const [lotionLot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, bs[1].outputLotId!));
    expect(lotionLot.qualityStatus).toBe("quarantine");

    // Purchasing: one sent, one received; from the delivery a released lot waits to be put away and one lot waits for QA.
    const pos = await db.select().from(purchaseOrders).where(eq(purchaseOrders.organizationId, O)).orderBy(asc(purchaseOrders.poNumber));
    expect(pos.map((p) => p.status)).toEqual(["sent", "received"]);
    const qua = (await db.select().from(locations).where(eq(locations.code, "QUA-01")))[0];
    const atQa = await db
      .select({ name: materials.name, status: inventoryLots.qualityStatus })
      .from(inventoryBalances)
      .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
      .innerJoin(materials, eq(materials.id, inventoryLots.materialId))
      .where(and(eq(inventoryBalances.locationId, qua.id), gt(inventoryBalances.qtyBase, "0")));
    expect(atQa.map((x) => `${x.name}:${x.status}`).sort()).toEqual(["Coconut Oil:released", "Glycerin:quarantine"]);

    // Use-first variety: the palm oil to use first expires within a month; the first coconut oil drum is opened.
    const lots = await db.select({ l: inventoryLots, name: materials.name }).from(inventoryLots).innerJoin(materials, eq(materials.id, inventoryLots.materialId)).where(eq(inventoryLots.organizationId, O));
    const palm = lots.filter((x) => x.name === "Palm Oil").map((x) => x.l.expiresOn!).sort();
    expect(new Date(palm[0]).getTime() - Date.now()).toBeLessThan(31 * 86_400_000);

    // Customer orders: soap ready to get from the shelf (two boxes set aside), lotion confirmed.
    const sos = await db.select().from(salesOrders).where(eq(salesOrders.organizationId, O)).orderBy(asc(salesOrders.orderNumber));
    expect(sos.map((o) => o.status)).toEqual(["allocated", "confirmed"]);
    const [n] = await db.select({ n: count() }).from(stockAllocations);
    expect(Number(n.n)).toBe(2);

    // Every batch belongs to a production order; nothing waits in the sending-out bay.
    expect(bs.every((b) => !!b.workOrderId)).toBe(true);
    const shp = (await db.select().from(locations).where(eq(locations.code, "SHP")))[0];
    expect(await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.locationId, shp.id), gt(inventoryBalances.qtyBase, "0")))).toHaveLength(0);
    // The equipment is ready for the next batch: clean after its last use, calibration due in the future.
    const eq_ = await db.select().from(equipment).where(eq(equipment.organizationId, O));
    expect(eq_.length).toBeGreaterThan(0);
    for (const e of eq_) {
      expect(e.status, e.code).toBe("in_service");
      expect(e.cleaningStatus, e.code).toBe("clean");
      if (e.calibrationDueDate) expect(new Date(e.calibrationDueDate).getTime(), e.code).toBeGreaterThan(Date.now());
    }

    // The completeness marker carries the profile and the version.
    expect((await marker()).after).toMatchObject({ profile: "lite", seedVersion: DEMO_SEED_VERSION });
  });
});

describe("the demo can go on: order 4 gets its materials and is weighed", () => {
  it("Get materials, the start check and one weighing on the scale work at once (clean, calibrated)", { timeout: 120_000 }, async () => {
    const { registerAppHooks } = await import("@/modules/wiring");
    registerAppHooks();
    const { buildContextForUser } = await import("@/lib/auth/context");
    const prod = await import("@/modules/production");
    const O = (await demoOrg()).id;
    const [site] = await db.select().from(sites).where(eq(sites.organizationId, O));
    const ctx = async (email: string) => (await buildContextForUser((await db.select().from(users).where(eq(users.email, email)))[0].id, site.id))!;
    const operator = await ctx("operator.nfd@bryels-care.test");
    const checker = await ctx("checker.nfd@bryels-care.test");
    const [b] = await db.select().from(batches).where(and(eq(batches.organizationId, O), eq(batches.status, "planned")));
    await prod.confirmPicked(operator, { batchId: b.id, all: true, idempotencyKey: crypto.randomUUID() });
    const steps = [...(b.formulaSnapshot as { steps: { stepNo: number; stepKind: string; checklistItems?: { id: string }[] }[] }).steps].sort((x, y) => x.stepNo - y.stepNo);
    const clean = steps.find((x) => x.stepKind === "line_clearance")!;
    await prod.submitChecklist(operator, { batchId: b.id, stepNo: clean.stepNo, answers: (clean.checklistItems ?? []).map((i) => ({ itemId: i.id, answer: "yes" as const })) }, { checker });
    const v = await prod.getWeighView(operator, b.id);
    const card = v.cards[0];
    const lot = card.lots[0];
    await prod.recordDispense(operator, { batchId: b.id, batchMaterialId: card.batchMaterialId, lotRef: lot.lotId, locationRef: lot.locationId, lotPreselected: true, lotConfirm: lot.last4, qty: card.target, equipmentRef: "SC-01" }, { checker });
    expect((await prod.getWeighView(operator, b.id)).cards.find((c) => c.batchMaterialId === card.batchMaterialId)!.done).toBe(true);
  });
});

describe("start-up: version change wipes and reloads once", () => {
  it("auto does nothing when the version is current", { timeout: 120_000 }, async () => {
    const before = (await demoOrg()).id;
    const r = runScript("src/db/demo.ts", ["auto"], { DEMO_MODE: "true" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("already loaded");
    expect((await demoOrg()).id).toBe(before);
  });

  it("an older stored version is wiped and reloaded, and the next start does nothing", { timeout: 300_000 }, async () => {
    const before = (await demoOrg()).id;
    await db.update(auditEvents).set({ after: { fictional: true, profile: "lite", seedVersion: "2026-01-01.1" } }).where(eq(auditEvents.action, "platform.demo.seeded"));
    const r = runScript("src/db/demo.ts", ["auto"], { DEMO_MODE: "true" });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("New demo data version (2026-01-01.1");
    const mid = (await demoOrg()).id;
    expect(mid).not.toBe(before);
    expect(await db.select().from(products).where(eq(products.organizationId, mid))).toHaveLength(2);
    const again = runScript("src/db/demo.ts", ["auto"], { DEMO_MODE: "true" });
    expect(again.out).toContain("already loaded");
    expect((await demoOrg()).id).toBe(mid);
  });

  it("the old full demo (a marker without a version) is replaced by the lite demo", { timeout: 300_000 }, async () => {
    await db.update(auditEvents).set({ after: { fictional: true } }).where(eq(auditEvents.action, "platform.demo.seeded"));
    const r = runScript("src/db/demo.ts", ["auto"], { DEMO_MODE: "true" });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("holds the full demo data");
    expect((await marker()).after).toMatchObject({ profile: "lite", seedVersion: DEMO_SEED_VERSION });
  });
});

describe("guards: nothing is wiped", () => {
  it("demo mode off or APP_ENV=production: auto does nothing, reset and the seed refuse", { timeout: 120_000 }, async () => {
    const before = (await demoOrg()).id;
    await db.update(auditEvents).set({ after: { fictional: true, profile: "lite", seedVersion: "old" } }).where(eq(auditEvents.action, "platform.demo.seeded"));
    expect(runScript("src/db/demo.ts", ["auto"], {})).toEqual({ code: 0, out: "" });
    expect(runScript("src/db/demo.ts", ["auto"], { DEMO_MODE: "true", APP_ENV: "production" })).toEqual({ code: 0, out: "" });
    expect(runScript("src/db/demo.ts", ["reset"], { DEMO_MODE: "true", APP_ENV: "production" }).code).toBe(2);
    expect(runScript("src/db/seed-demo.ts", [], { DEMO_MODE: "true", APP_ENV: "production" }).code).toBe(1);
    expect((await demoOrg()).id).toBe(before);
  });

  describe("a real account exists", () => {
    const REAL = "maria.santos@bryelscare.ph";
    beforeAll(async () => {
      await db.insert(users).values({ organizationId: (await demoOrg()).id, email: REAL, displayName: "Maria Santos", passwordHash: "!", status: "invited" });
    });
    afterAll(async () => {
      await db.delete(users).where(eq(users.email, REAL));
    });
    it("auto (even with an old version) and reset refuse with exit 2; the data is unchanged", { timeout: 120_000 }, async () => {
      const before = (await demoOrg()).id;
      for (const mode of ["auto", "reset"]) {
        const r = runScript("src/db/demo.ts", [mode], { DEMO_MODE: "true" });
        expect(r.code, mode).toBe(2);
        expect(r.out).toContain("not a demo address");
      }
      expect(runScript("src/db/seed-demo.ts", [], { DEMO_MODE: "true" }).code).toBe(2);
      expect((await demoOrg()).id).toBe(before);
      expect((await db.select().from(users).where(eq(users.email, REAL))).length).toBe(1);
    });
  });
});
