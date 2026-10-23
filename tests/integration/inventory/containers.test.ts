/** US-2-15 containers: create, split, merge, repack with lineage (docs/testing.md container.lineage.*). */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { containerContents, containerLineage, containers, inventorySettings } from "@/db/schema";
import { containerLineageGraph, createBox, getContainer, mergeBoxes, repackBox, splitBox, setBoxStatus } from "@/modules/inventory/containers";
import { describeBoxForScan, describeLocationForScan } from "@/modules/inventory/moves-scan-cards";
import { resetTestDatabase } from "../../support/db";
import { auditCount, expectDomain, key, loadWorld, loc, makeLot, type World } from "./w1c-fixtures";

let w: World;
beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
});

async function boxOf(qty: string, o: { status?: string; sku?: string } = {}) {
  const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "FG-01", productSku: o.sku ?? "ACS-135", qty, status: o.status });
  const box = await createBox(w.wh, { lotId: lot.id, locationId: (await loc(w.nfd.id, "FG-01")).id, qty, idempotencyKey: key() });
  return { lot, box };
}
const contentOf = async (id: string) => (await db.select().from(containerContents).where(eq(containerContents.containerId, id))).map((c) => [c.lotId, String(Number(c.qtyBase))]);

describe("containers", () => {
  it("creates a box with a BX number from loose stock only, idempotently", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "FG-01", productSku: "ACS-135", qty: "50" });
    const fg = await loc(w.nfd.id, "FG-01");
    const k = key();
    const a = await createBox(w.wh, { lotId: lot.id, locationId: fg.id, qty: "30", idempotencyKey: k });
    const b = await createBox(w.wh, { lotId: lot.id, locationId: fg.id, qty: "30", idempotencyKey: k });
    expect(a.containerNumber).toMatch(/^BX-\d{8}$/);
    expect(b.id).toBe(a.id);
    await expectDomain(createBox(w.wh, { lotId: lot.id, locationId: fg.id, qty: "21", idempotencyKey: key() }), "insufficient_stock");
    expect(await auditCount("inventory.container.created", a.id)).toBe(1);
  });

  it("container.lineage.split: 100 → 60 + 40 writes two lineage rows, children inherit the lot, parent emptied", async () => {
    const { lot, box } = await boxOf("100");
    const r = await splitBox(w.wh, { containerId: box.id, children: [{ qty: "60" }, { qty: "40" }], idempotencyKey: key() });
    expect(r.children).toHaveLength(2);
    const edges = await db.select().from(containerLineage).where(eq(containerLineage.parentContainerId, box.id));
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.operation === "split" && e.lotId === lot.id)).toBe(true);
    expect(await contentOf(r.children[0].id)).toEqual([[lot.id, "60"]]);
    expect(await contentOf(r.children[1].id)).toEqual([[lot.id, "40"]]);
    const [p] = await db.select().from(containers).where(eq(containers.id, box.id));
    expect(p.status).toBe("empty");
    const child = await getContainer(w.wh, r.children[0].id);
    expect(child.contents[0].qualityStatus).toBe("released");
    await expectDomain(splitBox(w.wh, { containerId: r.children[1].id, children: [{ qty: "41" }], idempotencyKey: key() }), "validation");
    expect(await auditCount("inventory.container.split", box.id)).toBe(1);
  });

  it("container.lineage.merge_status_mismatch: merging a released and an on_hold box is 409; same status and lot merges", async () => {
    const a = await boxOf("10");
    const held = await boxOf("10", { status: "on_hold" });
    await expectDomain(mergeBoxes(w.wh, { containerIds: [a.box.id, held.box.id], idempotencyKey: key() }), "conflict");
    // Mixed lots are off by default (A-PROC-22).
    const b = await boxOf("5");
    await expectDomain(mergeBoxes(w.wh, { containerIds: [a.box.id, b.box.id], idempotencyKey: key() }), "conflict");
    // Same lot in two boxes merges into a new box; parents emptied.
    const split = await splitBox(w.wh, { containerId: a.box.id, children: [{ qty: "4" }], idempotencyKey: key() });
    const m = await mergeBoxes(w.wh, { containerIds: [a.box.id, split.children[0].id], idempotencyKey: key() });
    expect(await contentOf(m.id)).toEqual([[a.lot.id, "10"]]);
    const parents = await db.select().from(containers).where(eq(containers.id, a.box.id));
    expect(parents[0].status).toBe("empty");
  });

  it("allows mixed lots when the setting is on", async () => {
    await db.insert(inventorySettings).values({ organizationId: w.orgId, key: "inventory.container.allow_mixed_lots", value: true });
    const a = await boxOf("3");
    const b = await boxOf("2");
    const m = await mergeBoxes(w.wh, { containerIds: [a.box.id, b.box.id], idempotencyKey: key() });
    expect((await contentOf(m.id)).length).toBe(2);
    await db.delete(inventorySettings).where(eq(inventorySettings.key, "inventory.container.allow_mixed_lots"));
  });

  it("container.repack_preserves_history: original → intermediate → final box is traceable both ways", async () => {
    const { lot, box } = await boxOf("48");
    const step1 = await repackBox(w.wh, { fromContainerId: box.id, qty: "24", reason: "Customer pack of 24", idempotencyKey: key() });
    const step2 = await repackBox(w.wh, { fromContainerId: step1.id, qty: "12", reason: "Retail pack of 12", idempotencyKey: key() });
    const graph = await containerLineageGraph(db, step2.id);
    const numbers = graph.map((g) => `${g.parent_number}>${g.child_number}`);
    expect(numbers).toContain(`${box.containerNumber}>${step1.containerNumber}`);
    expect(numbers).toContain(`${step1.containerNumber}>${step2.containerNumber}`);
    expect(graph.every((g) => g.operation === "repack" && g.lot_number === lot.lotNumber)).toBe(true);
    const fromOriginal = await containerLineageGraph(db, box.id);
    expect(fromOriginal.some((g) => g.child_id === step2.id && g.direction === "descendant")).toBe(true);
    expect(await auditCount("inventory.container.repacked", step2.id)).toBe(1);
  });

  it("seal and void follow the state machine; a non-empty box cannot be voided", async () => {
    const { box } = await boxOf("6");
    await setBoxStatus(w.wh, box.id, "sealed");
    await expectDomain(setBoxStatus(w.wh, box.id, "void"), "state");
    await setBoxStatus(w.wh, box.id, "open");
  });

  it("authz: cross-site boxes are not found; roles without container rights are refused", async () => {
    const { box } = await boxOf("4");
    await expectDomain(getContainer(w.whRvs, box.id), "not_found");
    await expectDomain(splitBox(w.whRvs, { containerId: box.id, children: [{ qty: "1" }], idempotencyKey: key() }), "not_found");
    await expectDomain(splitBox(w.auditor, { containerId: box.id, children: [{ qty: "1" }], idempotencyKey: key() }), "forbidden");
    await expectDomain(repackBox(w.sales, { fromContainerId: box.id, qty: "1", reason: "nope", idempotencyKey: key() }), "forbidden");
  });

  it("scan cards: a box and a location card list server-decided actions; another site's box is null", async () => {
    const { box } = await boxOf("8");
    const [b] = await db.select().from(containers).where(eq(containers.id, box.id));
    const card = await describeBoxForScan(w.wh, `BC:BOX:${b.containerNumber}`);
    expect(card?.allowedActions.map((a) => a.key)).toEqual(expect.arrayContaining(["move", "split", "repack", "label"]));
    expect(await describeBoxForScan(w.whRvs, `BC:BOX:${b.containerNumber}`)).toBeNull();
    const locCard = await describeLocationForScan(w.wh, "BC:LOC:FG-01");
    expect(locCard?.facts.find((f) => f[0] === "Boxes")?.[1]).not.toBe("0");
  });
});
